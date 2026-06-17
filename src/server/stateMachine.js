// Full state machine from STATE_MACHINE.md + Step 1 decisions.
// Transient states (resolved within the same request cycle — consumer never waits):
//   MINI_MIRANDA_PENDING: AUTH_PENDING → MINI_MIRANDA_PENDING → NEGOTIATION_OPEN
//   VERIFYING_FUNDS:      AWAITING_CONFIRMATION → VERIFYING_FUNDS → RESOLVED | NEGOTIATION
//
// Handoff states (driven by WebSocket, not HTTP):
//   ESCALATED → HANDOFF_PENDING → IN_HANDOFF → RESOLVED
//   ESCALATED is the HTTP terminal state; handoff transitions happen post-response via WS.

export const STATES = {
  GREETING:              'GREETING',
  AUTH_PENDING:          'AUTH_PENDING',
  AUTH_FAILED:           'AUTH_FAILED',
  MINI_MIRANDA_PENDING:  'MINI_MIRANDA_PENDING',   // transient
  NEGOTIATION_OPEN:      'NEGOTIATION_OPEN',
  NEGOTIATION:           'NEGOTIATION',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  VERIFYING_FUNDS:       'VERIFYING_FUNDS',        // transient
  RESOLVED:              'RESOLVED',
  ESCALATED:             'ESCALATED',
  HANDOFF_PENDING:       'HANDOFF_PENDING',        // awaiting admin acceptance (≤60s)
  IN_HANDOFF:            'IN_HANDOFF',             // admin connected; LLM disabled
};

// Pure data: allowed next states for each current state.
// Code MUST call assertTransition() before every state change.
export const TRANSITIONS = {
  [STATES.GREETING]:              [STATES.AUTH_PENDING],
  [STATES.AUTH_PENDING]:          [STATES.MINI_MIRANDA_PENDING, STATES.AUTH_FAILED, STATES.ESCALATED],
  [STATES.AUTH_FAILED]:           [STATES.ESCALATED],
  [STATES.MINI_MIRANDA_PENDING]:  [STATES.NEGOTIATION_OPEN, STATES.ESCALATED],
  [STATES.NEGOTIATION_OPEN]:      [STATES.NEGOTIATION, STATES.AWAITING_CONFIRMATION, STATES.ESCALATED],
  // NEGOTIATION → NEGOTIATION: allowed when advancing a ladder rung within same state
  [STATES.NEGOTIATION]:           [STATES.NEGOTIATION, STATES.AWAITING_CONFIRMATION, STATES.ESCALATED],
  [STATES.AWAITING_CONFIRMATION]: [STATES.RESOLVED, STATES.NEGOTIATION, STATES.ESCALATED, STATES.VERIFYING_FUNDS],
  [STATES.VERIFYING_FUNDS]:       [STATES.RESOLVED, STATES.NEGOTIATION, STATES.ESCALATED],
  [STATES.ESCALATED]:             [STATES.HANDOFF_PENDING],
  [STATES.HANDOFF_PENDING]:       [STATES.IN_HANDOFF, STATES.ESCALATED],
  [STATES.IN_HANDOFF]:            [STATES.RESOLVED],
  [STATES.RESOLVED]:              [],
};

/** Returns true if the transition from → to is in the allowed table. */
export function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  if (allowed === undefined) throw new Error(`canTransition: unknown state "${from}"`);
  return allowed.includes(to);
}

/** Throws if the transition is not allowed. Call before every updateSession(state). */
export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal state transition: ${from} → ${to}`);
  }
}

/**
 * True for HTTP-terminal states: the chat API returns a final message and
 * stops processing new messages through the normal LLM pipeline.
 * HANDOFF_PENDING and IN_HANDOFF are NOT HTTP-terminal — they are handled
 * specially in chatHandler (hold message / relay to admin).
 */
export function isTerminal(state) {
  return (
    state === STATES.RESOLVED  ||
    state === STATES.ESCALATED ||
    state === STATES.AUTH_FAILED
  );
}

/** True for transient states that are resolved within one request cycle. */
export function isTransient(state) {
  return (
    state === STATES.MINI_MIRANDA_PENDING ||
    state === STATES.VERIFYING_FUNDS
  );
}

/** True when a live human specialist is handling the session. */
export function isHandoffActive(state) {
  return state === STATES.HANDOFF_PENDING || state === STATES.IN_HANDOFF;
}

/**
 * Returns a fresh session state object.
 * Shape is the single source of truth — sessions.js calls this on createSession().
 */
export function getInitialState(sessionId) {
  return {
    sessionId,
    state: STATES.GREETING,
    account: null,
    authAttempts: 0,          // failed attempts only; max 3 before AUTH_FAILED
    disclosures: {
      miniMiranda:       null, // ISO timestamp when delivered, or null
      collectorStatement: null,
      preLegal:          null,
    },
    offers: {                  // Layer 9: resolution hierarchy tracking
      PIF:          false,
      BIF_PAYMENTS: false,
      SIF:          false,
      SIF_PAYMENTS: false,
      PPA:          false,
    },
    currentRung:    null,      // 'PIF' | 'BIF_PAYMENTS' | 'SIF' | 'SIF_PAYMENTS' | 'PPA'
    pendingOffer:   null,      // offer awaiting Reg E confirmation
    history:        [],        // { role, content, state_before, state_after, ts }[]
    audit:          [],        // compliance audit log — see AUDIT.md for schema
    createdAt:      new Date().toISOString(),
    escalationReason: null,    // flag code, 'AUTH_FAILED', 'REGION_NOT_SERVICED', etc.
  };
}
