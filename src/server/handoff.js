/**
 * HandoffManager — WebSocket-based live human handoff.
 *
 * Architecture:
 *   Consumer  ──HTTP──▶  /api/chat          (normal flow)
 *             ──WS──▶    /ws?role=consumer  (receives push: HANDOFF_ACCEPTED, ADMIN_MESSAGE, SESSION_ENDED)
 *   Admin     ──WS──▶    /ws?role=admin     (bidirectional: receives HANDOFF_REQUESTED, sends ACCEPT/SEND/END)
 *
 * States managed here:
 *   ESCALATED → HANDOFF_PENDING  (triggerHandoff, called from chat.js after HTTP response)
 *   HANDOFF_PENDING → IN_HANDOFF (acceptHandoff, triggered by admin WS message)
 *   IN_HANDOFF      → RESOLVED   (endHandoff,    triggered by admin WS message)
 *   HANDOFF_PENDING → ESCALATED  (60s timeout — admin never connected)
 *
 * Compliance:
 *   Admin messages are scanned for dollar amounts and rejected if any amount
 *   represents a deeper discount than the portfolio's hard ceiling.
 *   All messages (admin + consumer) are logged to session.audit.
 */

import { WebSocketServer } from 'ws';
import { getSession, updateSession } from './sessions.js';
import { STATES, assertTransition } from './stateMachine.js';
import { logAuditEvent, EVENT } from './audit.js';
import { getPortfolio } from './portfolios.js';

export class HandoffManager {
  constructor() {
    // sessionId → { consumerSocket: WebSocket|null, adminSockets: Set<WebSocket> }
    this.sessionSockets = new Map();
    // adminId → WebSocket
    this.adminSockets = new Map();
    // sessionId → handoff context payload (stored when triggerHandoff is called)
    this.handoffContexts = new Map();
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  /**
   * Attach a WebSocketServer to the HTTP server on path /ws.
   * Call this after http.createServer() but before server.listen().
   * @param {http.Server} server
   */
  init(server) {
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      let pathname;
      try {
        pathname = new URL(req.url, 'http://localhost').pathname;
      } catch {
        socket.destroy();
        return;
      }
      if (pathname === '/ws') {
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
      } else {
        socket.destroy();
      }
    });

    wss.on('connection', (ws, req) => {
      let params;
      try {
        params = new URL(req.url, 'http://localhost').searchParams;
      } catch {
        ws.close();
        return;
      }
      const role      = params.get('role');
      const sessionId = params.get('sessionId');
      const adminId   = params.get('adminId') || `admin-${Date.now()}`;

      if (role === 'consumer' && sessionId) {
        this._registerConsumer(sessionId, ws);
      } else if (role === 'admin') {
        this._registerAdmin(adminId, ws);
      } else {
        ws.close();
      }
    });
  }

  // ─── Consumer socket ───────────────────────────────────────────────────────

  _registerConsumer(sessionId, ws) {
    if (!this.sessionSockets.has(sessionId)) {
      this.sessionSockets.set(sessionId, { consumerSocket: null, adminSockets: new Set() });
    }
    const entry = this.sessionSockets.get(sessionId);
    entry.consumerSocket = ws;

    ws.on('close', () => {
      if (entry.consumerSocket === ws) entry.consumerSocket = null;
      // Notify admins monitoring this session
      this._broadcastToSessionAdmins(sessionId, { type: 'CONSUMER_DISCONNECTED', sessionId });
    });

    ws.on('error', err => {
      console.warn(`[WS consumer ${sessionId}]`, err.message);
    });
  }

  // ─── Admin socket ──────────────────────────────────────────────────────────

  _registerAdmin(adminId, ws) {
    this.adminSockets.set(adminId, ws);

    // Send all current active handoffs so admin panel hydrates immediately
    const active = this.getActiveHandoffs();
    this._send(ws, { type: 'ACTIVE_HANDOFFS', handoffs: active });

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw.toString());
        this._handleAdminMessage(adminId, msg, ws);
      } catch (e) {
        console.warn(`[WS admin ${adminId}] invalid message:`, e.message);
      }
    });

    ws.on('close', () => {
      this.adminSockets.delete(adminId);
    });

    ws.on('error', err => {
      console.warn(`[WS admin ${adminId}]`, err.message);
    });
  }

  _handleAdminMessage(adminId, msg, ws) {
    const { type, sessionId, content, resolution } = msg;
    switch (type) {
      case 'ACCEPT_HANDOFF': return this.acceptHandoff(adminId, sessionId);
      case 'SEND_MESSAGE':   return this._relayFromAdmin(adminId, sessionId, content, ws);
      case 'END_SESSION':    return this.endHandoff(adminId, sessionId, resolution);
      default:
        console.warn(`[WS admin ${adminId}] unknown message type: ${type}`);
    }
  }

  // ─── Handoff lifecycle ─────────────────────────────────────────────────────

  /**
   * Called from chat.js (via setImmediate) immediately after the HTTP escalation
   * response is sent. Transitions ESCALATED → HANDOFF_PENDING and broadcasts
   * the full session context to all connected admin sockets.
   *
   * @param {object} session  – the escalated session object
   * @param {string} reason   – escalation reason code
   */
  triggerHandoff(session, reason) {
    const { sessionId, account, history, audit, disclosures, offers } = session;

    // Build context payload for admin panel
    const ctx = {
      accountRef:       account?.ref           ?? null,
      firstName:        account?.firstName      ?? null,
      lastName:         account?.lastName       ?? null,
      portfolioId:      account?.portfolioId    ?? null,
      balance:          account?.balance        ?? null,
      originalCreditor: account?.originalCreditor ?? null,
      escalationReason: reason,
      disclosures:      disclosures ?? {},
      offers:           offers ?? {},
      // Full conversation transcript (role=user|bot only; no auth field dumps)
      transcript: (history ?? [])
        .filter(h => h.role === 'user' || h.role === 'bot')
        .map(h => ({ role: h.role, content: h.content, ts: h.ts })),
      auditCount: (audit ?? []).length,
      // Flag auth-failed handoffs so admin knows not to discuss account specifics
      authFailed: reason === 'AUTH_FAILED',
      state: STATES.HANDOFF_PENDING,
      ts: new Date().toISOString(),
    };

    this.handoffContexts.set(sessionId, ctx);

    // Transition state
    try {
      assertTransition(STATES.ESCALATED, STATES.HANDOFF_PENDING);
      updateSession(sessionId, { state: STATES.HANDOFF_PENDING });

      // Audit
      const updated = getSession(sessionId);
      if (updated) {
        logAuditEvent(updated, EVENT.HANDOFF_REQUESTED, 'code',
          { reason, authFailed: ctx.authFailed },
          STATES.ESCALATED, STATES.HANDOFF_PENDING);
      }
    } catch (e) {
      console.error('[handoff.triggerHandoff] state transition failed:', e.message);
    }

    // Broadcast to all admins
    this._broadcastToAdmins({ type: 'HANDOFF_REQUESTED', sessionId, ...ctx });

    // Push "please hold" to consumer via WS if connected
    const entry = this.sessionSockets.get(sessionId);
    if (entry?.consumerSocket) {
      this._send(entry.consumerSocket, {
        type: 'BOT_MESSAGE',
        state: STATES.HANDOFF_PENDING,
        content: 'Connecting you with a specialist now — please hold.',
      });
    }

    // 60-second timeout: if no admin accepts, fall back to ESCALATED
    setTimeout(() => {
      const s = getSession(sessionId);
      if (s?.state === STATES.HANDOFF_PENDING) {
        console.log(`[handoff] Timeout for session ${sessionId} — no admin accepted`);
        try {
          assertTransition(STATES.HANDOFF_PENDING, STATES.ESCALATED);
          updateSession(sessionId, { state: STATES.ESCALATED });
        } catch (_) { /* ignore */ }
        const e2 = this.sessionSockets.get(sessionId);
        if (e2?.consumerSocket) {
          this._send(e2.consumerSocket, {
            type: 'BOT_MESSAGE',
            state: STATES.ESCALATED,
            content: 'No specialist is available right now. We will follow up through our published contact channels.',
          });
        }
        this._broadcastToAdmins({ type: 'HANDOFF_TIMEOUT', sessionId });
        this.handoffContexts.delete(sessionId);
      }
    }, 60_000);
  }

  /**
   * Admin accepts a pending handoff. Transitions HANDOFF_PENDING → IN_HANDOFF.
   * @param {string} adminId
   * @param {string} sessionId
   */
  acceptHandoff(adminId, sessionId) {
    const session = getSession(sessionId);
    if (!session) {
      console.warn(`[handoff.acceptHandoff] session ${sessionId} not found`);
      return;
    }
    if (session.state !== STATES.HANDOFF_PENDING) {
      console.warn(`[handoff.acceptHandoff] session ${sessionId} is in ${session.state}, not HANDOFF_PENDING`);
      return;
    }

    try {
      assertTransition(STATES.HANDOFF_PENDING, STATES.IN_HANDOFF);
    } catch (e) {
      console.error('[handoff.acceptHandoff]', e.message);
      return;
    }

    const updated = updateSession(sessionId, { state: STATES.IN_HANDOFF, handoffAdminId: adminId });
    logAuditEvent(updated, EVENT.HANDOFF_ACCEPTED, 'code',
      { adminId }, STATES.HANDOFF_PENDING, STATES.IN_HANDOFF);

    // Wire admin socket to session
    if (!this.sessionSockets.has(sessionId)) {
      this.sessionSockets.set(sessionId, { consumerSocket: null, adminSockets: new Set() });
    }
    const entry = this.sessionSockets.get(sessionId);
    const adminWs = this.adminSockets.get(adminId);
    if (adminWs) entry.adminSockets.add(adminWs);

    // Update context
    const ctx = this.handoffContexts.get(sessionId);
    if (ctx) this.handoffContexts.set(sessionId, { ...ctx, state: STATES.IN_HANDOFF });

    // Push to consumer
    this._send(entry.consumerSocket, {
      type: 'HANDOFF_ACCEPTED',
      state: STATES.IN_HANDOFF,
      content: 'A specialist has joined and can assist you directly.',
    });

    // Confirm to admin
    this._send(adminWs, {
      type: 'HANDOFF_ACCEPTED',
      sessionId,
      state: STATES.IN_HANDOFF,
    });

    // Notify all admins of state change
    this._broadcastToAdmins({ type: 'SESSION_STATE_UPDATE', sessionId, state: STATES.IN_HANDOFF });
  }

  /**
   * Called from chat.js POST handler when state === IN_HANDOFF.
   * Consumer sent a message via HTTP → relay to admin sockets.
   * @param {string} sessionId
   * @param {string} content
   */
  relayFromConsumer(sessionId, content) {
    const session = getSession(sessionId);
    if (session) {
      logAuditEvent(session, EVENT.CONSUMER_MESSAGE, 'code',
        { content, via: 'handoff_relay' }, session.state, session.state);
    }

    const msg = { type: 'CONSUMER_MESSAGE', sessionId, content, ts: new Date().toISOString() };
    const entry = this.sessionSockets.get(sessionId);
    if (entry?.adminSockets.size) {
      for (const ws of entry.adminSockets) this._send(ws, msg);
    } else {
      // Admin not yet wired to session socket — broadcast to all admins
      this._broadcastToAdmins(msg);
    }
  }

  /**
   * Admin sends a message to the consumer.
   * Validates against portfolio compliance before relaying.
   */
  _relayFromAdmin(adminId, sessionId, content, adminWs) {
    const session = getSession(sessionId);
    if (!session) {
      this._send(adminWs, { type: 'ERROR', sessionId, error: 'Session not found' });
      return;
    }

    // Compliance check — portfolio hard ceilings still enforced for admin messages
    const violation = this._checkCompliance(content, session);
    if (violation) {
      this._send(adminWs, { type: 'COMPLIANCE_VIOLATION', sessionId, violation });
      return;
    }

    logAuditEvent(session, EVENT.ADMIN_MESSAGE, 'code',
      { content, adminId }, session.state, session.state);

    // Relay to consumer
    const entry = this.sessionSockets.get(sessionId);
    this._send(entry?.consumerSocket, {
      type: 'ADMIN_MESSAGE',
      content,
      ts: new Date().toISOString(),
    });

    // Echo confirmation to sending admin (so their UI can render it)
    this._send(adminWs, {
      type: 'ADMIN_MESSAGE_SENT',
      sessionId,
      content,
      ts: new Date().toISOString(),
    });
  }

  /**
   * Admin ends the handoff session. Transitions IN_HANDOFF → RESOLVED.
   * @param {string} adminId
   * @param {string} sessionId
   * @param {string} resolution
   */
  endHandoff(adminId, sessionId, resolution = 'Handled by specialist') {
    const session = getSession(sessionId);
    if (!session) return;

    try {
      assertTransition(STATES.IN_HANDOFF, STATES.RESOLVED);
    } catch (e) {
      console.error('[handoff.endHandoff]', e.message);
      // Try ending from HANDOFF_PENDING too (admin ends before consumer connects)
    }

    logAuditEvent(session, EVENT.HANDOFF_ENDED, 'code',
      { adminId, resolution }, session.state, STATES.RESOLVED);
    updateSession(sessionId, { state: STATES.RESOLVED, escalationReason: null });

    const entry = this.sessionSockets.get(sessionId);
    this._send(entry?.consumerSocket, {
      type: 'SESSION_ENDED',
      state: STATES.RESOLVED,
      content: `${resolution} Thank you for contacting Meridian Recovery Services.`,
    });

    const adminWs = this.adminSockets.get(adminId);
    this._send(adminWs, { type: 'HANDOFF_ENDED', sessionId, resolution });
    this._broadcastToAdmins({ type: 'SESSION_STATE_UPDATE', sessionId, state: STATES.RESOLVED });

    this.handoffContexts.delete(sessionId);
  }

  // ─── Compliance guard ──────────────────────────────────────────────────────

  /**
   * Scan admin message for dollar amounts that would exceed the portfolio's
   * maximum discount ceiling. Returns a violation string or null if compliant.
   *
   * Rule: admin may offer deeper discounts than the bot (which caps at SELF_SERVICE_PAYMENT_CAP)
   * but cannot offer settlements below the portfolio hard floor:
   *   floor = balance × (1 − maxDiscount)
   */
  _checkCompliance(content, session) {
    if (!session.account) return null;
    const portfolio = getPortfolio(session.account.portfolioId);
    if (!portfolio) return null;

    const balance = session.account.balance;
    const settlementFloor = balance * (1 - portfolio.maxDiscount);

    // Match dollar amounts like $1,234.56 or $1234
    const matches = [...content.matchAll(/\$([\d,]+(?:\.\d{1,2})?)/g)];
    for (const [, raw] of matches) {
      const amount = parseFloat(raw.replace(/,/g, ''));
      if (isNaN(amount)) continue;
      // Only flag sub-balance amounts (i.e., potential settlements) below the floor
      if (amount > 0 && amount < balance && amount < settlementFloor) {
        return (
          `$${amount.toFixed(2)} exceeds the maximum discount for portfolio ${portfolio.id} ` +
          `(${Math.round(portfolio.maxDiscount * 100)}% max). ` +
          `Minimum settlement is $${settlementFloor.toFixed(2)}.`
        );
      }
    }
    return null;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  getActiveHandoffs() {
    return [...this.handoffContexts.entries()].map(([sessionId, ctx]) => {
      const session = getSession(sessionId);
      return { sessionId, state: session?.state ?? ctx.state ?? 'UNKNOWN', ...ctx };
    });
  }

  _send(ws, data) {
    try {
      if (ws?.readyState === 1 /* OPEN */) {
        ws.send(JSON.stringify(data));
      }
    } catch (e) {
      console.warn('[WS._send]', e.message);
    }
  }

  _broadcastToAdmins(msg) {
    for (const ws of this.adminSockets.values()) this._send(ws, msg);
  }

  _broadcastToSessionAdmins(sessionId, msg) {
    const entry = this.sessionSockets.get(sessionId);
    if (entry) for (const ws of entry.adminSockets) this._send(ws, msg);
  }
}

export const handoffManager = new HandoffManager();
