/**
 * Audit log implementation — AUDIT.md schema.
 *
 * Entry shape:
 * {
 *   ts:           ISO timestamp,
 *   sessionId:    string,
 *   event:        string  (see EVENT_TYPES),
 *   source:       'code' | 'llm',
 *   data:         object  (event-specific payload),
 *   state_before: string,
 *   state_after:  string,
 * }
 *
 * The audit array lives on session.audit and is mutated in place
 * (same pattern as session.history — the Map holds the object reference).
 *
 * GET /api/audit/:sessionId returns the full audit array.
 */

import { getSession } from './sessions.js';

// Inline constant avoids circular import of stateMachine.js
const STATES_ESCALATED = 'ESCALATED';

// ─── Event type constants ─────────────────────────────────────────────────────

export const EVENT = {
  STATE_CHANGE:                    'STATE_CHANGE',
  AUTH_ATTEMPT:                    'AUTH_ATTEMPT',
  DISCLOSURE_DELIVERED:            'DISCLOSURE_DELIVERED',
  OFFER_MADE:                      'OFFER_MADE',
  OFFER_REJECTED_BY_GUARDRAIL:     'OFFER_REJECTED_BY_GUARDRAIL',
  CONSUMER_MESSAGE:                'CONSUMER_MESSAGE',
  BOT_MESSAGE:                     'BOT_MESSAGE',
  ESCALATION:                      'ESCALATION',
  REGION_BLOCKED:                  'REGION_BLOCKED',
  HIERARCHY_STEP:                  'HIERARCHY_STEP',
  PAYMENT_AUTHORIZATION:           'PAYMENT_AUTHORIZATION',
  FUNDS_VERIFICATION_ATTEMPTED:    'FUNDS_VERIFICATION_ATTEMPTED',
  FUNDS_VERIFICATION_RESULT:       'FUNDS_VERIFICATION_RESULT',
  RENEGOTIATION_TRIGGERED:         'RENEGOTIATION_TRIGGERED',
  PRE_LEGAL_SUPPRESSED:            'PRE_LEGAL_SUPPRESSED',
  PREFERRED_LANGUAGE_REQUIRED:     'PREFERRED_LANGUAGE_REQUIRED',
  GUARDRAIL_RETRY:                 'GUARDRAIL_RETRY',
  RETRY_EXHAUSTED:                 'RETRY_EXHAUSTED',
  // Handoff lifecycle
  HANDOFF_REQUESTED:               'HANDOFF_REQUESTED',
  HANDOFF_ACCEPTED:                'HANDOFF_ACCEPTED',
  ADMIN_MESSAGE:                   'ADMIN_MESSAGE',
  HANDOFF_ENDED:                   'HANDOFF_ENDED',
};

// ─── Core logger ─────────────────────────────────────────────────────────────

/**
 * Append one audit event to session.audit.
 * Mutates the array in place — the Map<sessionId, session> holds the reference.
 *
 * @param {object} session       – the live session object (not a copy)
 * @param {string} event         – one of EVENT.*
 * @param {'code'|'llm'} source
 * @param {object} data          – event-specific payload (see AUDIT.md examples)
 * @param {string} stateBefore
 * @param {string} stateAfter
 */
export function logAuditEvent(session, event, source, data, stateBefore, stateAfter) {
  session.audit.push({
    ts:           new Date().toISOString(),
    sessionId:    session.sessionId,
    event,
    source,
    data,
    state_before: stateBefore,
    state_after:  stateAfter,
  });
}

// ─── Typed helpers ────────────────────────────────────────────────────────────
// Callers import these so the shape of each event's `data` is consistent.

export function auditAuthAttempt(session, attempt, success, fieldsProvided, stateBefore) {
  // Never log raw SSN/ZIP — only which fields were present.
  logAuditEvent(session, EVENT.AUTH_ATTEMPT, 'code', {
    attempt,
    success,
    fields_provided: fieldsProvided,
  }, stateBefore, session.state);
}

export function auditDisclosureDelivered(session, which, stateBefore) {
  const VERBATIM = {
    MINI_MIRANDA: true,
    COLLECTOR_STATEMENT: true,
    PRE_LEGAL: true,
  };
  logAuditEvent(session, EVENT.DISCLOSURE_DELIVERED, 'code', {
    which,
    verbatim_match: VERBATIM[which] ?? false,
  }, stateBefore, session.state);
}

export function auditStateChange(session, stateBefore, stateAfter, reason = null) {
  logAuditEvent(session, EVENT.STATE_CHANGE, 'code', { reason }, stateBefore, stateAfter);
}

export function auditOfferMade(session, offer, stateBefore) {
  // Build a sanitized offer summary — amounts come from the offer object, never literals here.
  const data = {
    rung:  offer.rung,
    type:  offer.type,
  };
  if (offer.amount         != null) data.amount          = offer.amount;
  if (offer.discount       != null) data.discount        = offer.discount;
  if (offer.portfolioMax   != null) data.portfolio_max   = offer.portfolioMax;
  if (offer.monthlyPayment != null) data.monthly_payment = offer.monthlyPayment;
  if (offer.months         != null) data.months          = offer.months;
  if (offer.installmentAmount != null) data.installment_amount = offer.installmentAmount;
  if (offer.installments   != null) data.installments    = offer.installments;
  if (offer.totalPayment   != null) data.total_payment   = offer.totalPayment;
  if (offer.exceedsCap     != null) data.exceeds_cap     = offer.exceedsCap;

  logAuditEvent(session, EVENT.OFFER_MADE, 'code', data, stateBefore, session.state);
  logAuditEvent(session, EVENT.HIERARCHY_STEP, 'code', {
    offered: offer.rung,
    accepted: null, // null = awaiting response
  }, stateBefore, session.state);
}

export function auditHierarchyStep(session, rung, accepted, stateBefore) {
  logAuditEvent(session, EVENT.HIERARCHY_STEP, 'code', {
    offered: rung,
    accepted,
  }, stateBefore, session.state);
}

export function auditGuardrailRejection(session, violations, rawLlmOutput, stateBefore, attempt = 1) {
  logAuditEvent(session, EVENT.OFFER_REJECTED_BY_GUARDRAIL, 'code', {
    violations,
    attempt,
    raw_llm_output: rawLlmOutput,
  }, stateBefore, session.state);
}

export function auditGuardrailRetry(session, attempt, violations, stateBefore) {
  logAuditEvent(session, EVENT.GUARDRAIL_RETRY, 'code', {
    attempt,
    violations,
  }, stateBefore, session.state);
}

export function auditRetryExhausted(session, stateBefore) {
  logAuditEvent(session, EVENT.RETRY_EXHAUSTED, 'code', {
    note: 'LLM failed guardrails after max retries — escalating',
  }, stateBefore, session.state);
}

export function auditEscalation(session, reason, stateBefore) {
  logAuditEvent(session, EVENT.ESCALATION, 'code', { reason }, stateBefore, STATES_ESCALATED);
}

export function auditPaymentAuthorization(session, arrangement, authorized, stateBefore) {
  logAuditEvent(session, EVENT.PAYMENT_AUTHORIZATION, 'code', {
    type:       arrangement.rung,
    amount:     arrangement.installmentAmount ?? arrangement.monthlyPayment ?? arrangement.amount,
    total:      arrangement.totalPayment ?? arrangement.amount,
    authorized,
  }, stateBefore, session.state);
}

/** @deprecated — superseded by auditFundsVerificationAttempted + auditFundsVerificationResult */
export function auditFundsVerification(session, amount, stateBefore) {
  logAuditEvent(session, EVENT.FUNDS_VERIFICATION_ATTEMPTED, 'code', {
    amount,
    threshold: 1500,
  }, stateBefore, session.state);
}

export function auditFundsVerificationAttempted(session, amount, bankLast4, stateBefore) {
  logAuditEvent(session, EVENT.FUNDS_VERIFICATION_ATTEMPTED, 'code', {
    amount,
    bank_account_last4: bankLast4,
    ts: new Date().toISOString(),
  }, stateBefore, session.state);
}

export function auditFundsVerificationResult(session, verified, reason, stateBefore) {
  // reason is logged for internal audit only — never shown to consumer
  logAuditEvent(session, EVENT.FUNDS_VERIFICATION_RESULT, 'code', {
    verified,
    reason,   // 'INSUFFICIENT_FUNDS' | 'ACCOUNT_CLOSED' | 'ACCOUNT_NOT_FOUND' | null
  }, stateBefore, session.state);
}

export function auditRenegotiationTriggered(session, failedRung, nextRung, stateBefore) {
  logAuditEvent(session, EVENT.RENEGOTIATION_TRIGGERED, 'code', {
    failed_rung:    failedRung,
    falling_back_to: nextRung ?? 'NONE',
  }, stateBefore, session.state);
}

export function auditPreferredLanguage(session, accountState, stateBefore) {
  logAuditEvent(session, EVENT.PREFERRED_LANGUAGE_REQUIRED, 'code', {
    account_state: accountState,
    note: 'Known gap — no output change in v1',
  }, stateBefore, session.state);
}

export function auditConsumerMessage(session, content, stateBefore) {
  logAuditEvent(session, EVENT.CONSUMER_MESSAGE, 'code', { content }, stateBefore, session.state);
}

export function auditBotMessage(session, content, stateBefore, stateAfter, extra = {}) {
  logAuditEvent(session, EVENT.BOT_MESSAGE, 'code', { content, ...extra }, stateBefore, stateAfter);
}

export function auditHandoffRequested(session, reason, stateBefore) {
  logAuditEvent(session, EVENT.HANDOFF_REQUESTED, 'code', { reason }, stateBefore, session.state);
}

export function auditHandoffAccepted(session, adminId, stateBefore) {
  logAuditEvent(session, EVENT.HANDOFF_ACCEPTED, 'code', { adminId }, stateBefore, session.state);
}

export function auditAdminMessage(session, content, adminId) {
  logAuditEvent(session, EVENT.ADMIN_MESSAGE, 'code', { content, adminId }, session.state, session.state);
}

export function auditHandoffEnded(session, adminId, resolution, stateBefore) {
  logAuditEvent(session, EVENT.HANDOFF_ENDED, 'code', { adminId, resolution }, stateBefore, session.state);
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

/**
 * GET /api/audit/:sessionId
 * Returns the full audit log for the session.
 */
export function auditHandler(req, res) {
  const session = getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found', sessionId: req.params.sessionId });
  }
  return res.json({
    sessionId: session.sessionId,
    state:     session.state,
    count:     session.audit.length,
    audit:     session.audit,
  });
}
