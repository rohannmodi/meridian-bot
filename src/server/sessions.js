import { randomUUID } from 'crypto';
import { getInitialState } from './stateMachine.js';
import db from './db.js';

/** In-memory session store. Keyed by UUID sessionId. */
const sessions = new Map();

/**
 * Create a new session, store it, and return it.
 * @returns {object} session
 */
export function createSession() {
  const id = randomUUID();
  const session = getInitialState(id);
  sessions.set(id, session);
  return session;
}

/**
 * Retrieve a session by ID.
 * @param {string} id
 * @returns {object|null}
 */
export function getSession(id) {
  return sessions.get(id) ?? null;
}

/**
 * Shallow-merge updates into the session and return the updated object.
 * Does NOT deep-merge nested objects like `offers` or `disclosures` —
 * callers must spread those explicitly:
 *   updateSession(id, { offers: { ...session.offers, PIF: true } })
 * @param {string} id
 * @param {object} updates
 * @returns {object} updated session
 */
export function updateSession(id, updates) {
  const session = sessions.get(id);
  if (!session) throw new Error(`updateSession: session not found: ${id}`);
  const updated = { ...session, ...updates };
  sessions.set(id, updated);
  return updated;
}

/**
 * Return a safe summary of all active (in-memory) sessions.
 */
export function getAllSessions() {
  return [...sessions.values()].map(s => ({
    sessionId:       s.sessionId,
    state:           s.state,
    accountRef:      s.account?.ref ?? null,
    authAttempts:    s.authAttempts,
    currentRung:     s.currentRung,
    escalationReason: s.escalationReason,
    createdAt:       s.createdAt,
    auditCount:      s.audit.length,
  }));
}

/**
 * Write a completed session's summary and audit trail to SQLite.
 * Safe to call multiple times for the same sessionId (INSERT OR REPLACE).
 */
export function persistSessionLog(session) {
  try {
    db.prepare(`
      INSERT OR REPLACE INTO session_logs
        (sessionId, accountRef, finalState, escalationReason, authAttempts, createdAt, completedAt, auditJson)
      VALUES
        (@sessionId, @accountRef, @finalState, @escalationReason, @authAttempts, @createdAt, @completedAt, @auditJson)
    `).run({
      sessionId:        session.sessionId,
      accountRef:       session.account?.ref ?? null,
      finalState:       session.state,
      escalationReason: session.escalationReason ?? null,
      authAttempts:     session.authAttempts,
      createdAt:        session.createdAt,
      completedAt:      new Date().toISOString(),
      auditJson:        JSON.stringify(session.audit ?? []),
    });
  } catch (err) {
    console.error('[persistSessionLog]', err.message);
  }
}

/**
 * Push a history entry (with a server-side timestamp) onto session.history.
 * Does not replace the session reference — mutates in place since history
 * is an array and we hold the reference.
 * @param {string} id
 * @param {{ role: 'user'|'bot', content: string, [key: string]: any }} entry
 */
export function appendHistory(id, entry) {
  const session = sessions.get(id);
  if (!session) throw new Error(`appendHistory: session not found: ${id}`);
  session.history.push({ ...entry, ts: new Date().toISOString() });
}
