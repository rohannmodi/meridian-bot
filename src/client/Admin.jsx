/**
 * Admin.jsx — Meridian Live Handoff Console
 *
 * Connects to the server WebSocket as role=admin.
 * Shows incoming handoff requests, allows accepting sessions,
 * chatting directly with consumers, and ending sessions.
 *
 * Password gate: hardcoded to process.env.ADMIN_PASSWORD value
 * ("meridian-admin-2026" for the prototype).
 * Known gap: no real auth — see README.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const ADMIN_PASSWORD = 'meridian-admin-2026';

const STATE_COLOR = {
  HANDOFF_PENDING: '#f59e0b',
  IN_HANDOFF:      '#7c3aed',
  RESOLVED:        '#16a34a',
  ESCALATED:       '#ef4444',
};

// ─── Admin beep (Web Audio API) ───────────────────────────────────────────────

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch { /* ignore if AudioContext blocked */ }
}

// ─── Notification ─────────────────────────────────────────────────────────────

async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

function showNotification(handoff, onClickOpen) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const name   = handoff.authFailed
      ? `Session ${handoff.sessionId?.slice(0, 8)}`
      : `${handoff.firstName ?? ''} ${handoff.lastName ?? ''}`.trim() || handoff.accountRef;
    const n = new Notification('Incoming Handoff — Meridian', {
      body:              `${name} · ${handoff.escalationReason ?? 'ESCALATED'}`,
      icon:              '/favicon.ico',
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      onClickOpen(handoff);
      n.close();
    };
  } catch { /* notification permissions may not be available */ }
}

// ─── Password gate ────────────────────────────────────────────────────────────

function LoginScreen({ onAuthed }) {
  const [pw, setPw]  = useState('');
  const [err, setErr] = useState('');

  function submit(e) {
    e.preventDefault();
    if (pw === ADMIN_PASSWORD) {
      onAuthed();
    } else {
      setErr('Incorrect password.');
      setPw('');
    }
  }

  return (
    <div className="admin-login">
      <div className="admin-login-box">
        <div className="admin-login-logo">M</div>
        <h1 className="admin-login-title">Meridian Admin Console</h1>
        <p className="admin-login-sub">Live Handoff — Internal Use Only</p>
        <form onSubmit={submit} className="admin-login-form">
          <input
            type="password"
            value={pw}
            onChange={e => { setPw(e.target.value); setErr(''); }}
            placeholder="Admin password"
            autoFocus
            className="admin-login-input"
          />
          {err && <p className="admin-login-error">{err}</p>}
          <button type="submit" className="admin-login-btn">Enter</button>
        </form>
      </div>
    </div>
  );
}

// ─── Left panel — handoff list ────────────────────────────────────────────────

function HandoffList({ handoffs, selected, onSelect }) {
  if (handoffs.length === 0) {
    return (
      <div className="admin-empty">
        <p>No active handoffs.</p>
        <p className="admin-empty-sub">Escalated sessions will appear here.</p>
      </div>
    );
  }

  return (
    <ul className="handoff-list">
      {handoffs.map(h => {
        const name = h.authFailed
          ? `Session ${h.sessionId?.slice(0, 8)}…`
          : `${h.firstName ?? ''} ${h.lastName ?? ''}`.trim() || h.accountRef || h.sessionId?.slice(0, 8);
        const pending  = h.state === 'HANDOFF_PENDING';
        const active   = selected?.sessionId === h.sessionId;
        const waiting  = Date.now() - new Date(h.ts).getTime();
        const mins     = Math.floor(waiting / 60000);
        const secs     = Math.floor((waiting % 60000) / 1000);
        const waitStr  = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        const color    = STATE_COLOR[h.state] ?? '#64748b';
        return (
          <li
            key={h.sessionId}
            className={`handoff-item ${active ? 'handoff-item-active' : ''} ${pending ? 'handoff-item-pending' : ''}`}
            onClick={() => onSelect(h)}
          >
            {pending && <span className="handoff-badge">NEW</span>}
            <span className="handoff-name">{name}</span>
            <span className="handoff-ref">{h.accountRef ?? 'no ref'}</span>
            <div className="handoff-meta">
              <span className="handoff-reason">{h.escalationReason}</span>
              <span className="handoff-state" style={{ color }}>{h.state?.replace('_', ' ')}</span>
              <span className="handoff-wait">{waitStr}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Context panel ─────────────────────────────────────────────────────────────

function ContextPanel({ handoff }) {
  const [open, setOpen] = useState(true);
  if (!handoff) return null;

  const disc = handoff.disclosures ?? {};
  const offers = handoff.offers ?? {};

  return (
    <div className="ctx-panel">
      <button className="ctx-toggle" onClick={() => setOpen(o => !o)}>
        {open ? '▾' : '▸'} Session Context
      </button>
      {open && (
        <div className="ctx-body">
          {handoff.authFailed && (
            <div className="ctx-warn">
              ⚠ Auth failed — do NOT discuss account specifics with this consumer.
            </div>
          )}
          <div className="ctx-grid">
            <div className="ctx-row"><span className="ctx-label">Account</span><span className="ctx-val">{handoff.accountRef ?? '—'}</span></div>
            <div className="ctx-row"><span className="ctx-label">Consumer</span><span className="ctx-val">{handoff.firstName} {handoff.lastName}</span></div>
            <div className="ctx-row"><span className="ctx-label">Portfolio</span><span className="ctx-val">{handoff.portfolioId ?? '—'}</span></div>
            <div className="ctx-row"><span className="ctx-label">Balance</span><span className="ctx-val">{handoff.balance != null ? '$' + Number(handoff.balance).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}</span></div>
            <div className="ctx-row"><span className="ctx-label">Creditor</span><span className="ctx-val">{handoff.originalCreditor ?? '—'}</span></div>
            <div className="ctx-row"><span className="ctx-label">Reason</span><span className="ctx-val ctx-reason">{handoff.escalationReason}</span></div>
          </div>
          <div className="ctx-section-label">Disclosures</div>
          <div className="ctx-grid">
            <div className="ctx-row"><span className="ctx-label">Mini-Miranda</span><span className="ctx-val">{disc.miniMiranda ? '✓' : '✗'}</span></div>
            <div className="ctx-row"><span className="ctx-label">Collector Statement</span><span className="ctx-val">{disc.collectorStatement ? '✓' : '✗'}</span></div>
            <div className="ctx-row"><span className="ctx-label">Pre-Legal</span><span className="ctx-val">{disc.preLegal ? '✓' : '—'}</span></div>
          </div>
          <div className="ctx-section-label">Offers presented</div>
          <div className="ctx-grid">
            {Object.entries(offers).filter(([, v]) => v).map(([k]) => (
              <div key={k} className="ctx-row"><span className="ctx-label">{k}</span><span className="ctx-val">presented</span></div>
            ))}
            {Object.values(offers).every(v => !v) && <div className="ctx-row"><span className="ctx-val ctx-muted">None</span></div>}
          </div>
          <div className="ctx-section-label">Audit events</div>
          <div className="ctx-row"><span className="ctx-val ctx-muted">{handoff.auditCount ?? 0} events logged</span></div>
        </div>
      )}
    </div>
  );
}

// ─── Transcript ───────────────────────────────────────────────────────────────

function Transcript({ transcript }) {
  const bottomRef = useRef(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  return (
    <div className="admin-transcript">
      {transcript.length === 0 && (
        <p className="admin-transcript-empty">No messages yet.</p>
      )}
      {transcript.map((m, i) => {
        const isBot      = m.role === 'bot';
        const isAdmin    = m.role === 'admin';
        const isConsumer = m.role === 'user' || m.role === 'consumer';
        return (
          <div key={i} className={`admin-bubble-row ${isConsumer ? 'abr-consumer' : isAdmin ? 'abr-admin' : 'abr-bot'}`}>
            <span className="admin-bubble-label">
              {isBot ? 'Bot' : isAdmin ? 'Admin' : 'Consumer'}
            </span>
            <div className={`admin-bubble ${isConsumer ? 'ab-consumer' : isAdmin ? 'ab-admin' : 'ab-bot'}`}>
              {m.content}
            </div>
            {m.ts && (
              <span className="admin-bubble-ts">
                {new Date(m.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

// ─── Right panel — selected session ───────────────────────────────────────────

function SessionPanel({ handoff, ws, onHandoffUpdate }) {
  const [adminInput, setAdminInput] = useState('');

  // Compliance error comes from parent via handoff._complianceError
  const complianceError = handoff?._complianceError ?? '';

  // Clear compliance error when user starts typing a new message
  useEffect(() => {
    if (adminInput && handoff?._complianceError) {
      onHandoffUpdate(handoff.sessionId, { _complianceError: null });
    }
  }, [adminInput]); // eslint-disable-line

  if (!handoff) {
    return (
      <div className="session-panel session-panel-empty">
        <p>Select a session from the left panel.</p>
      </div>
    );
  }

  const isPending   = handoff.state === 'HANDOFF_PENDING';
  const isHandoff   = handoff.state === 'IN_HANDOFF';
  const isResolved  = handoff.state === 'RESOLVED';

  function sendToWs(type, payload = {}) {
    if (ws?.readyState === 1) {
      ws.send(JSON.stringify({ type, sessionId: handoff.sessionId, ...payload }));
    }
  }

  function acceptHandoff() {
    sendToWs('ACCEPT_HANDOFF');
  }

  function sendMessage() {
    const text = adminInput.trim();
    if (!text) return;
    setAdminInput('');
    sendToWs('SEND_MESSAGE', { content: text });
  }

  function endSession() {
    if (!window.confirm('End this session and mark it RESOLVED?')) return;
    sendToWs('END_SESSION', { resolution: 'Handled by specialist.' });
  }

  const consumerDisc = handoff.disclosures ?? {};
  const discOk = consumerDisc.miniMiranda && consumerDisc.collectorStatement;

  return (
    <div className="session-panel">
      <div className="session-panel-head">
        <div>
          <span className="sp-name">
            {handoff.authFailed
              ? `Session ${handoff.sessionId?.slice(0, 8)}…`
              : `${handoff.firstName ?? ''} ${handoff.lastName ?? ''}`.trim() || handoff.accountRef}
          </span>
          <span className="sp-ref">{handoff.accountRef}</span>
        </div>
        <div className="sp-actions">
          {isPending && (
            <button className="admin-btn admin-btn-accept" onClick={acceptHandoff}>
              Accept Handoff
            </button>
          )}
          {isHandoff && (
            <button className="admin-btn admin-btn-end" onClick={endSession}>
              End Session
            </button>
          )}
          {isResolved && <span className="sp-resolved">✓ Resolved</span>}
        </div>
      </div>

      {handoff.authFailed && (
        <div className="sp-warn">⚠ Auth failed — do NOT discuss account specifics.</div>
      )}
      {!discOk && !handoff.authFailed && (
        <div className="sp-warn">⚠ Required disclosures not delivered before escalation — proceed with caution.</div>
      )}

      <ContextPanel handoff={handoff} />

      <div className="transcript-label">Conversation</div>
      <Transcript transcript={handoff.transcript ?? []} />

      {isHandoff && (
        <div className="admin-input-zone">
          {complianceError && (
            <div className="compliance-error">⛔ {complianceError}</div>
          )}
          <div className="admin-input-bar">
            <textarea
              className="admin-textarea"
              value={adminInput}
              onChange={e => setAdminInput(e.target.value)}
              placeholder="Type your message to the consumer…"
              rows={2}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              }}
            />
            <button
              className="admin-send-btn"
              onClick={sendMessage}
              disabled={!adminInput.trim()}
            >
              Send
            </button>
          </div>
          <p className="admin-input-hint">Enter to send · Shift+Enter for new line · Portfolio limits enforced</p>
        </div>
      )}
    </div>
  );
}

// ─── Admin root ────────────────────────────────────────────────────────────────

export default function Admin() {
  const [authed,   setAuthed]   = useState(false);
  const [handoffs, setHandoffs] = useState([]);
  const [selected, setSelected] = useState(null);
  const wsRef = useRef(null);

  // Request notification permission once authed
  useEffect(() => {
    if (authed) requestNotificationPermission();
  }, [authed]);

  // WebSocket setup
  useEffect(() => {
    if (!authed) return;

    const adminId = `admin-${Date.now()}`;
    const proto   = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws?role=admin&adminId=${encodeURIComponent(adminId)}`);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWsMessage(msg);
      } catch { /* ignore */ }
    };

    ws.onerror = (e) => console.warn('[WS admin] error:', e);
    ws.onclose = ()  => console.warn('[WS admin] connection closed');

    wsRef.current = ws;
    return () => ws.close();
  }, [authed]); // eslint-disable-line

  const handleWsMessage = useCallback((msg) => {
    switch (msg.type) {

      case 'ACTIVE_HANDOFFS': {
        const hydrated = (msg.handoffs ?? []).map(h => ({
          ...h,
          transcript: h.transcript ?? [],
        }));
        setHandoffs(hydrated);
        break;
      }

      case 'HANDOFF_REQUESTED': {
        const newH = { ...msg, transcript: msg.transcript ?? [] };
        setHandoffs(prev => {
          if (prev.find(h => h.sessionId === msg.sessionId)) return prev;
          return [newH, ...prev];
        });
        playBeep();
        showNotification(newH, h => setSelected(h));
        break;
      }

      case 'SESSION_STATE_UPDATE': {
        setHandoffs(prev => prev.map(h =>
          h.sessionId === msg.sessionId ? { ...h, state: msg.state } : h
        ));
        setSelected(prev =>
          prev?.sessionId === msg.sessionId ? { ...prev, state: msg.state } : prev
        );
        break;
      }

      case 'HANDOFF_ACCEPTED': {
        setHandoffs(prev => prev.map(h =>
          h.sessionId === msg.sessionId ? { ...h, state: 'IN_HANDOFF' } : h
        ));
        setSelected(prev =>
          prev?.sessionId === msg.sessionId ? { ...prev, state: 'IN_HANDOFF' } : prev
        );
        break;
      }

      case 'CONSUMER_MESSAGE': {
        const entry = { role: 'consumer', content: msg.content, ts: msg.ts ?? new Date().toISOString() };
        setHandoffs(prev => prev.map(h =>
          h.sessionId === msg.sessionId
            ? { ...h, transcript: [...(h.transcript ?? []), entry] }
            : h
        ));
        setSelected(prev =>
          prev?.sessionId === msg.sessionId
            ? { ...prev, transcript: [...(prev.transcript ?? []), entry] }
            : prev
        );
        break;
      }

      case 'ADMIN_MESSAGE_SENT': {
        const entry = { role: 'admin', content: msg.content, ts: msg.ts ?? new Date().toISOString() };
        setHandoffs(prev => prev.map(h =>
          h.sessionId === msg.sessionId
            ? { ...h, transcript: [...(h.transcript ?? []), entry] }
            : h
        ));
        setSelected(prev =>
          prev?.sessionId === msg.sessionId
            ? { ...prev, transcript: [...(prev.transcript ?? []), entry] }
            : prev
        );
        break;
      }

      case 'COMPLIANCE_VIOLATION': {
        // Surface the error in the SessionPanel
        setSelected(prev =>
          prev?.sessionId === msg.sessionId
            ? { ...prev, _complianceError: msg.violation }
            : prev
        );
        break;
      }

      case 'CONSUMER_DISCONNECTED': {
        setHandoffs(prev => prev.map(h =>
          h.sessionId === msg.sessionId ? { ...h, consumerDisconnected: true } : h
        ));
        setSelected(prev =>
          prev?.sessionId === msg.sessionId ? { ...prev, consumerDisconnected: true } : prev
        );
        break;
      }

      case 'HANDOFF_ENDED':
      case 'HANDOFF_TIMEOUT': {
        setHandoffs(prev => prev.filter(h => h.sessionId !== msg.sessionId));
        setSelected(prev =>
          prev?.sessionId === msg.sessionId ? null : prev
        );
        break;
      }

      default:
        console.debug('[WS admin] unhandled message type:', msg.type);
    }
  }, []);

  if (!authed) return <LoginScreen onAuthed={() => setAuthed(true)} />;

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <span className="admin-header-brand">Meridian Admin Console</span>
        <span className="admin-header-sub">Live Handoff — Internal Use Only</span>
        <span className="admin-header-count">
          {handoffs.length} active · {handoffs.filter(h => h.state === 'HANDOFF_PENDING').length} pending
        </span>
        <a href="/admin-ops" className="admin-header-link" target="_blank" rel="noreferrer">
          Account Admin →
        </a>
      </header>

      <div className="admin-body">
        {/* Left panel */}
        <aside className="admin-left">
          <div className="admin-left-head">Active Handoffs</div>
          <HandoffList
            handoffs={handoffs}
            selected={selected}
            onSelect={h => setSelected(h)}
          />
        </aside>

        {/* Right panel */}
        <section className="admin-right">
          <SessionPanel
            handoff={selected}
            ws={wsRef.current}
            onHandoffUpdate={(sid, patch) => {
              setHandoffs(prev => prev.map(h => h.sessionId === sid ? { ...h, ...patch } : h));
              setSelected(prev => prev?.sessionId === sid ? { ...prev, ...patch } : prev);
            }}
          />
        </section>
      </div>
    </div>
  );
}
