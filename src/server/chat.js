/**
 * POST /api/chat
 *
 * Request body: { sessionId?: string, message?: string, auth?: AuthFields }
 * AuthFields:   { accountRef, firstName, lastName, ssn4, zip }
 * Response:     { sessionId, state, message, statusMeta }
 *
 * LLM is called ONLY in NEGOTIATION_OPEN, NEGOTIATION, AWAITING_CONFIRMATION.
 * All other states are deterministic (no LLM).
 *
 * Ground rules:
 *  - All script strings come from disclosures.js — none hardcoded here.
 *  - Every state change calls assertTransition() first.
 *  - Region + flag checks run BEFORE building any disclosure.
 *  - Auth failure responses are byte-identical regardless of account existence.
 *  - LLM output passes through validateResponse() before reaching the consumer.
 *  - Dollar amounts / limits never appear as literals in prompt strings.
 */

import { createSession, getSession, updateSession, appendHistory, persistSessionLog } from './sessions.js';
import { authenticate } from './auth.js';
import { checkFlags, checkRegion, needsPreferredLanguageLog } from './flags.js';
import { getPortfolio } from './portfolios.js';
import {
  calculateSettlement,
  calculatePlan,
  calculateSifInstallments,
  SELF_SERVICE_PAYMENT_CAP,
  NO_PROFILE_MAX_MONTHS,
  MAX_SIF_INSTALLMENTS,
} from './limits.js';
import {
  greetingScript,
  authPromptScript,
  authFailedScript,
  authRetryScript,
  buildDisclosureBlock,
  escalationScript,
  pifAskScript,
  closingScript,
  settlementConfirmationScript,
  planConfirmationScript,
  verifyingFundsScript,
  fundsVerifiedScript,
  fundsFailedScript,
} from './disclosures.js';
import { verifyFunds, bankLast4 } from './bank.js';
import { STATES, assertTransition } from './stateMachine.js';
import { handoffManager } from './handoff.js';
import { callLLM } from './llm.js';
import {
  negotiationOpenPrompt,
  negotiationPrompt,
  awaitingConfirmationPrompt,
} from './prompts.js';
import { validateResponse, gateIntent } from './guardrails.js';
import {
  auditAuthAttempt,
  auditDisclosureDelivered,
  auditStateChange,
  auditOfferMade,
  auditHierarchyStep,
  auditGuardrailRejection,
  auditGuardrailRetry,
  auditRetryExhausted,
  auditEscalation,
  auditPaymentAuthorization,
  auditFundsVerificationAttempted,
  auditFundsVerificationResult,
  auditRenegotiationTriggered,
  auditPreferredLanguage,
  auditConsumerMessage,
  auditBotMessage,
} from './audit.js';

// ─── Guardrail retry ──────────────────────────────────────────────────────────

const MAX_LLM_ATTEMPTS = 3;

const RETRY_SOFT_PHRASES = [
  'One moment — let me confirm the exact figures for you.',
  'Let me pull up the precise numbers for your account.',
  'Give me one second to double-check that for you.',
];

function randomRetryPhrase() {
  return RETRY_SOFT_PHRASES[Math.floor(Math.random() * RETRY_SOFT_PHRASES.length)];
}

/**
 * Build a human-readable list of valid dollar/percentage values for this account,
 * used in the corrective re-prompt when the LLM produces out-of-range values.
 */
function buildValidValuesDescription(account, portfolio) {
  const fmt = n => '$' + Number(n).toFixed(2);

  const sif = calculateSettlement(account, portfolio, portfolio.maxDiscount);
  const sifInstAmounts = [];
  for (let i = 1; i <= MAX_SIF_INSTALLMENTS; i++) {
    const inst = calculateSifInstallments(sif.amount, i);
    if (inst.valid) sifInstAmounts.push(fmt(inst.installmentAmount));
  }

  const monthlyAmounts = [];
  for (let m = 2; m <= NO_PROFILE_MAX_MONTHS; m++) {
    const plan = calculatePlan(account, portfolio, m, false);
    if (plan.withinLimit) monthlyAmounts.push(fmt(plan.monthlyPayment));
  }

  return [
    `balance=${fmt(account.balance)}`,
    `valid_settlement_lump=${fmt(sif.amount)}`,
    `valid_settlement_installments=[${sifInstAmounts.join(', ')}]`,
    `valid_monthly_amounts=[${monthlyAmounts.join(', ')}]`,
    `max_discount=${(portfolio.maxDiscount * 100).toFixed(0)}%`,
  ].join(', ');
}

// ─── Offer hierarchy ──────────────────────────────────────────────────────────

const RUNG_ORDER = ['PIF', 'BIF_PAYMENTS', 'SIF', 'SIF_PAYMENTS', 'PPA'];

/** Returns the next rung that hasn't been offered yet, or null if ladder is exhausted. */
function getNextRung(offers) {
  return RUNG_ORDER.find(r => !offers[r]) ?? null;
}

/**
 * Build a concrete offer object for the given rung using limits.js calculations.
 * All dollar amounts come from account/portfolio — never literals here.
 */
function buildRungOffer(rung, account, portfolio) {
  switch (rung) {
    case 'PIF':
      return {
        rung,
        type: 'paid_in_full',
        amount: account.balance,
        exceedsCap: account.balance > SELF_SERVICE_PAYMENT_CAP,
      };

    case 'BIF_PAYMENTS': {
      // Find minimum months (2 → NO_PROFILE_MAX_MONTHS) that keeps monthly ≤ cap
      let chosen = null;
      for (let m = 2; m <= NO_PROFILE_MAX_MONTHS; m++) {
        const plan = calculatePlan(account, portfolio, m, false);
        if (plan.withinLimit) {
          chosen = plan;
          if (!plan.exceedsCap) break;
        }
      }
      if (!chosen) chosen = calculatePlan(account, portfolio, 2, false);
      return { rung, type: 'balance_in_payments', ...chosen };
    }

    case 'SIF': {
      const sif = calculateSettlement(account, portfolio, portfolio.maxDiscount);
      return {
        rung,
        type: 'settled_in_full_lump',
        ...sif,
        exceedsCap: sif.amount > SELF_SERVICE_PAYMENT_CAP,
      };
    }

    case 'SIF_PAYMENTS': {
      const sif = calculateSettlement(account, portfolio, portfolio.maxDiscount);
      const inst = calculateSifInstallments(sif.amount, MAX_SIF_INSTALLMENTS);
      return {
        rung,
        type: 'settled_in_full_installments',
        settlementAmount: sif.amount,
        discount: sif.discount,
        portfolioMax: sif.portfolioMax,
        ...inst,
      };
    }

    case 'PPA': {
      const ppa = calculatePlan(account, portfolio, NO_PROFILE_MAX_MONTHS, false);
      return { rung, type: 'payment_plan_arrangement', ...ppa };
    }

    default:
      throw new Error(`Unknown rung: ${rung}`);
  }
}

/** Return the last N history entries from negotiation phase (skip auth/disclosure turns). */
function recentNegotiationHistory(session, n = 8) {
  return session.history
    .filter(h => ['NEGOTIATION_OPEN', 'NEGOTIATION', 'AWAITING_CONFIRMATION'].includes(h.state_before))
    .slice(-n);
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function respond(res, session, message) {
  const { sessionId, state, account, authAttempts, currentRung, offers } = session;
  return res.json({
    sessionId,
    state,
    message,
    statusMeta: {
      state,
      accountRef:        account?.ref          ?? null,
      portfolioId:       account?.portfolioId  ?? null,
      balance:           account?.balance      ?? null,
      attemptsRemaining: state === STATES.AUTH_PENDING ? 3 - authAttempts : null,
      currentRung,
      offers,
    },
  });
}

function logBot(sessionId, content, stateBefore, stateAfter, extra = {}) {
  appendHistory(sessionId, {
    role: 'bot',
    content,
    state_before: stateBefore,
    state_after:  stateAfter,
    ...extra,
  });
}

function doEscalate(res, session, fromState, reason) {
  assertTransition(fromState, STATES.ESCALATED);
  // Append "please hold" so the consumer knows a handoff is coming.
  // The WS push from handoffManager will follow immediately after.
  const msg = escalationScript();
  const updated = updateSession(session.sessionId, {
    state: STATES.ESCALATED,
    escalationReason: reason,
  });
  auditEscalation(updated, reason, fromState);
  auditStateChange(updated, fromState, STATES.ESCALATED, reason);
  auditBotMessage(updated, msg, fromState, STATES.ESCALATED);
  logBot(session.sessionId, msg, fromState, STATES.ESCALATED, { escalationReason: reason });
  persistSessionLog(updated);

  // Send HTTP response first, then trigger handoff via WebSocket (non-blocking)
  const httpResult = respond(res, updated, msg);
  setImmediate(() => {
    try {
      handoffManager.triggerHandoff(updated, reason);
    } catch (e) {
      console.error('[doEscalate] handoff trigger failed:', e.message);
    }
  });
  return httpResult;
}

/**
 * Verify funds for a payment that exceeds SELF_SERVICE_PAYMENT_CAP.
 * Returns the final HTTP response.
 *
 * On success:  VERIFYING_FUNDS → RESOLVED
 * On failure:  VERIFYING_FUNDS → NEGOTIATION (renegotiate via advanceAndPresent)
 */
async function doVerifyFunds(res, session, fromState, offer) {
  const paymentAmount = offer.installmentAmount ?? offer.monthlyPayment ?? offer.amount;
  const { sessionId, account } = session;
  const last4 = bankLast4(account.bankAccountNumber);

  // Transition to transient VERIFYING_FUNDS
  assertTransition(fromState, STATES.VERIFYING_FUNDS);
  const vfSession = updateSession(sessionId, { state: STATES.VERIFYING_FUNDS });

  auditFundsVerificationAttempted(vfSession, paymentAmount, last4, fromState);

  const result = verifyFunds({ bankAccountNumber: account.bankAccountNumber, amount: paymentAmount });

  auditFundsVerificationResult(vfSession, result.verified, result.reason, STATES.VERIFYING_FUNDS);

  if (result.verified) {
    // VERIFYING_FUNDS → RESOLVED
    assertTransition(STATES.VERIFYING_FUNDS, STATES.RESOLVED);
    const closeMsg =
      verifyingFundsScript() + '\n\n' +
      fundsVerifiedScript(paymentAmount) + ' ' + closingScript();
    const resolved = updateSession(sessionId, { state: STATES.RESOLVED });
    auditPaymentAuthorization(resolved, offer, true, STATES.VERIFYING_FUNDS);
    auditHierarchyStep(resolved, offer.rung, true, STATES.VERIFYING_FUNDS);
    auditStateChange(resolved, STATES.VERIFYING_FUNDS, STATES.RESOLVED, 'funds_verified');
    auditBotMessage(resolved, closeMsg, STATES.VERIFYING_FUNDS, STATES.RESOLVED, { arrangement: offer });
    logBot(sessionId, closeMsg, STATES.VERIFYING_FUNDS, STATES.RESOLVED);
    persistSessionLog(resolved);
    return respond(res, resolved, closeMsg);
  } else {
    // Funds not available — renegotiate to next rung
    const nextRungForAudit = getNextRung(vfSession.offers);
    auditRenegotiationTriggered(vfSession, offer.rung, nextRungForAudit, STATES.VERIFYING_FUNDS);
    const failPrefix = verifyingFundsScript() + '\n\n' + fundsFailedScript();
    // Pass a natural consumer-side continuation so the LLM frames the next offer
    // correctly, rather than seeing the raw "YES" confirmation in history and
    // generating a "thank you for confirming" response.
    const renegotiationContext = 'I understand. What other options do you have?';
    // advanceAndPresent transitions VERIFYING_FUNDS → NEGOTIATION (or ESCALATED if ladder exhausted)
    return advanceAndPresent(res, vfSession, STATES.VERIFYING_FUNDS, renegotiationContext, failPrefix);
  }
}

/**
 * Run LLM + guardrails for the current turn, with up to MAX_LLM_ATTEMPTS retries.
 *
 * On guardrail failure:
 *   - Log GUARDRAIL_RETRY and send a corrective re-prompt (violations + valid values).
 *   - Repeat up to MAX_LLM_ATTEMPTS total.
 *   - If all attempts fail, log RETRY_EXHAUSTED and return escalate: true.
 *
 * On successful retry: prepend a random soft phrase to the response text.
 *
 * Returns { intent, extracted, responseText, guardrailPass, escalate }.
 */
async function runLLM(systemPrompt, session, userMessage, account, portfolio) {
  const history = recentNegotiationHistory(session);
  const correctionMessages = [];

  let raw;
  let validation;

  for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
    raw = await callLLM(systemPrompt, history, userMessage, correctionMessages);

    // Layer 4: intent gating (not subject to retry — it's a structural issue)
    const gate = gateIntent(raw.intent, session.state);
    if (!gate.allowed) {
      console.warn(`[GUARDRAIL-L4] Intent "${raw.intent}" not allowed in ${session.state}`);
      return {
        intent: 'UNCLEAR',
        extracted: {},
        responseText: gate.deflect,
        guardrailPass: true,
        escalate: false,
        rawLlmOutput: raw,
      };
    }

    // Layers 3, 6 (verbatim disclosures)
    validation = validateResponse(raw.response_text, account, portfolio, session.state, session);

    if (validation.verbatimWarnings.length > 0) {
      console.warn('[GUARDRAIL-L6] LLM produced verbatim disclosure text:', validation.verbatimWarnings);
      auditGuardrailRejection(
        session,
        validation.verbatimWarnings.map(w => `VERBATIM_DISCLOSURE:${w}`),
        JSON.stringify(raw),
        session.state,
        attempt,
      );
    }

    if (validation.pass) {
      // Guardrails passed — prepend soft phrase if this was a retry
      const responseText = attempt > 1
        ? randomRetryPhrase() + ' ' + validation.responseText
        : validation.responseText;
      return {
        intent:        raw.intent,
        extracted:     raw.extracted,
        responseText,
        guardrailPass: true,
        escalate:      false,
        rawLlmOutput:  raw,
      };
    }

    // Guardrail failed this attempt
    console.warn(`[GUARDRAIL-L3/7] Validation failed (attempt ${attempt}/${MAX_LLM_ATTEMPTS}):`, validation.violations);
    auditGuardrailRejection(session, validation.violations, JSON.stringify(raw), session.state, attempt);

    if (attempt < MAX_LLM_ATTEMPTS) {
      // Build corrective re-prompt and queue for next attempt
      auditGuardrailRetry(session, attempt + 1, validation.violations, session.state);
      const validValues = buildValidValuesDescription(account, portfolio);
      const correctionText =
        `Your previous response contained values not present in the account data: ` +
        `${validation.violations.join('; ')}. ` +
        `Respond again using ONLY these exact values: ${validValues}. ` +
        `Do not invent new values.`;
      correctionMessages.push({ role: 'assistant', content: JSON.stringify(raw) });
      correctionMessages.push({ role: 'user',      content: correctionText });
    }
  }

  // All attempts exhausted — escalate
  console.warn('[GUARDRAIL] RETRY_EXHAUSTED — escalating after', MAX_LLM_ATTEMPTS, 'attempts');
  auditRetryExhausted(session, session.state);
  return {
    intent:        'ESCALATE',
    extracted:     {},
    responseText:  'Let me connect you with a specialist who can finalize the numbers with you.',
    guardrailPass: false,
    escalate:      true,
    rawLlmOutput:  raw,
  };
}

/**
 * Advance to the next rung after a DECLINE.
 * - Marks current rung as offered.
 * - Builds offer for next rung.
 * - Transitions session to NEGOTIATION.
 * - Calls LLM to present the new offer.
 * - Returns HTTP response.
 */
async function advanceAndPresent(res, session, fromState, userMessage, messagePrefix = '') {
  const account  = session.account;
  const portfolio = getPortfolio(account.portfolioId);

  const nextRung = getNextRung(session.offers);
  if (!nextRung) {
    // Ladder exhausted
    return doEscalate(res, session, fromState, 'NO_VIABLE_ARRANGEMENT');
  }

  const offer = buildRungOffer(nextRung, account, portfolio);

  // Transition to NEGOTIATION (from wherever we are)
  assertTransition(fromState, STATES.NEGOTIATION);

  const updated = updateSession(session.sessionId, {
    state:        STATES.NEGOTIATION,
    currentRung:  nextRung,
    offers:       { ...session.offers, [nextRung]: true },
    pendingOffer: offer,
  });

  auditStateChange(updated, fromState, STATES.NEGOTIATION, `advance_to_${nextRung}`);
  auditOfferMade(updated, offer, fromState);

  // LLM presents the new offer — pass presentOffer=true so the prompt
  // instructs the model to quote the specific amounts rather than respond to the decline.
  const sysPrompt = negotiationPrompt(account, portfolio, updated, /* presentOffer */ true);
  const llm = await runLLM(sysPrompt, updated, userMessage, account, portfolio);

  if (llm.escalate) {
    return doEscalate(res, updated, STATES.NEGOTIATION, 'GUARDRAIL_ESCALATION');
  }

  const finalMsg = messagePrefix
    ? messagePrefix + '\n\n' + llm.responseText
    : llm.responseText;
  auditBotMessage(updated, finalMsg, fromState, STATES.NEGOTIATION, { rung: nextRung });
  logBot(session.sessionId, finalMsg, fromState, STATES.NEGOTIATION, { rung: nextRung });
  return respond(res, updated, finalMsg);
}

/**
 * Build the Reg E confirmation script for the pendingOffer and transition
 * the session to AWAITING_CONFIRMATION.
 */
function moveToConfirmation(res, session, fromState) {
  assertTransition(fromState, STATES.AWAITING_CONFIRMATION);
  const offer = session.pendingOffer;

  let regEMsg;
  if (offer.rung === 'PIF' || offer.rung === 'SIF') {
    // Single lump payment
    regEMsg = settlementConfirmationScript(offer.amount, '[DATE]');
  } else if (offer.rung === 'SIF_PAYMENTS') {
    // Installments
    regEMsg = planConfirmationScript(
      offer.installmentAmount,
      offer.installments,
      '[DATE]',
      offer.totalPayment
    );
  } else {
    // BIF_PAYMENTS or PPA — monthly plan
    regEMsg = planConfirmationScript(
      offer.monthlyPayment,
      offer.months,
      '[DATE]',
      offer.totalPayment
    );
  }

  const updated = updateSession(session.sessionId, { state: STATES.AWAITING_CONFIRMATION });
  auditStateChange(updated, fromState, STATES.AWAITING_CONFIRMATION, 'consumer_accepted');
  auditBotMessage(updated, regEMsg, fromState, STATES.AWAITING_CONFIRMATION, { rung: offer.rung });
  logBot(session.sessionId, regEMsg, fromState, STATES.AWAITING_CONFIRMATION);
  return respond(res, updated, regEMsg);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function chatHandler(req, res) {
  try {
    const { sessionId: incomingId, message = '', auth } = req.body ?? {};

    // Get or create session
    let session;
    if (!incomingId) {
      session = createSession();
    } else {
      session = getSession(incomingId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found', sessionId: incomingId });
      }
    }

    const { sessionId, state } = session;

    // Log user turn (skip silent first-load)
    if (message && String(message).trim()) {
      const msgContent = typeof message === 'string' ? message : JSON.stringify(message);
      appendHistory(sessionId, {
        role:        'user',
        content:     msgContent,
        state_before: state,
      });
      // Don't log raw auth fields — only log that a message was received in auth states
      if (state !== STATES.AUTH_PENDING) {
        auditConsumerMessage(session, msgContent, state);
      }
    }

    // ── Terminal state guard ──────────────────────────────────────────────────
    if (state === STATES.ESCALATED)   return respond(res, session, escalationScript());
    if (state === STATES.RESOLVED)    return respond(res, session, closingScript());
    if (state === STATES.AUTH_FAILED) return respond(res, session, authFailedScript());

    // ── Handoff states (LLM disabled; WebSocket drives the interaction) ───────
    if (state === STATES.HANDOFF_PENDING) {
      // Consumer sent a message while waiting for admin — acknowledge only
      return respond(res, session, 'A specialist is being connected — please hold.');
    }
    if (state === STATES.IN_HANDOFF) {
      // Relay consumer message to the admin socket; no LLM response
      if (message && String(message).trim()) {
        auditConsumerMessage(session, message, state);
        handoffManager.relayFromConsumer(sessionId, String(message).trim());
      }
      // Return a null message — client should NOT add a bot bubble for this
      return res.json({
        sessionId,
        state: STATES.IN_HANDOFF,
        message: null,
        statusMeta: { state: STATES.IN_HANDOFF, accountRef: session.account?.ref ?? null },
      });
    }

    // ── State dispatch ────────────────────────────────────────────────────────

    switch (state) {

      // ── GREETING ────────────────────────────────────────────────────────────
      case STATES.GREETING: {
        assertTransition(STATES.GREETING, STATES.AUTH_PENDING);
        const msg = greetingScript() + '\n\n' + authPromptScript();
        const updated = updateSession(sessionId, { state: STATES.AUTH_PENDING });
        auditStateChange(updated, STATES.GREETING, STATES.AUTH_PENDING);
        auditBotMessage(updated, msg, STATES.GREETING, STATES.AUTH_PENDING);
        logBot(sessionId, msg, STATES.GREETING, STATES.AUTH_PENDING);
        return respond(res, updated, msg);
      }

      // ── AUTH_PENDING ─────────────────────────────────────────────────────────
      case STATES.AUTH_PENDING: {
        let authFields = auth ?? null;
        if (!authFields && message) {
          try {
            const parsed = typeof message === 'object' ? message : JSON.parse(message);
            if (parsed?.accountRef) authFields = parsed;
          } catch (_) { /* not JSON */ }
        }

        const required = ['accountRef', 'firstName', 'lastName', 'ssn4', 'zip'];
        if (!authFields || required.some(f => !authFields[f]?.toString().trim())) {
          const msg = authPromptScript();
          logBot(sessionId, msg, STATES.AUTH_PENDING, STATES.AUTH_PENDING);
          return respond(res, session, msg);
        }

        const { ok, account } = authenticate({
          ref:       authFields.accountRef,
          firstName: authFields.firstName,
          lastName:  authFields.lastName,
          ssn4:      authFields.ssn4,
          zip:       authFields.zip,
        });

        // Which fields were provided (never log raw values)
        const fieldsProvided = ['accountRef', 'firstName', 'lastName', 'ssn4', 'zip']
          .filter(f => authFields[f]?.toString().trim());

        if (!ok) {
          const newAttempts = session.authAttempts + 1;
          if (newAttempts >= 3) {
            assertTransition(STATES.AUTH_PENDING, STATES.AUTH_FAILED);
            assertTransition(STATES.AUTH_FAILED, STATES.ESCALATED);
            const msg = authFailedScript();
            const updated = updateSession(sessionId, {
              state: STATES.ESCALATED,
              authAttempts: newAttempts,
              escalationReason: 'AUTH_FAILED',
            });
            auditAuthAttempt(updated, newAttempts, false, fieldsProvided, STATES.AUTH_PENDING);
            auditEscalation(updated, 'AUTH_FAILED', STATES.AUTH_PENDING);
            auditStateChange(updated, STATES.AUTH_PENDING, STATES.ESCALATED, 'AUTH_FAILED');
            auditBotMessage(updated, msg, STATES.AUTH_PENDING, STATES.ESCALATED);
            logBot(sessionId, msg, STATES.AUTH_PENDING, STATES.ESCALATED, { authAttempt: newAttempts });
            persistSessionLog(updated);
            return respond(res, updated, msg);
          }
          const msg = authRetryScript();
          const updated = updateSession(sessionId, { authAttempts: newAttempts });
          auditAuthAttempt(updated, newAttempts, false, fieldsProvided, STATES.AUTH_PENDING);
          auditBotMessage(updated, msg, STATES.AUTH_PENDING, STATES.AUTH_PENDING);
          logBot(sessionId, msg, STATES.AUTH_PENDING, STATES.AUTH_PENDING, { authAttempt: newAttempts });
          return respond(res, updated, msg);
        }

        // Auth success — region check then flag check BEFORE any disclosure
        const regionCheck = checkRegion(account);
        if (regionCheck.escalate) {
          const updated = updateSession(sessionId, { account });
          return doEscalate(res, updated, STATES.AUTH_PENDING, regionCheck.reason);
        }

        const flagCheck = checkFlags(account);
        if (flagCheck.escalate) {
          const updated = updateSession(sessionId, { account });
          return doEscalate(res, updated, STATES.AUTH_PENDING, flagCheck.reason);
        }

        // Auth success audit
        auditAuthAttempt(session, session.authAttempts + 1, true,
          ['accountRef', 'firstName', 'lastName', 'ssn4', 'zip'], STATES.AUTH_PENDING);

        // Log preferred-language note (known gap — no output change)
        if (needsPreferredLanguageLog(account)) {
          console.log(`[PREFERRED_LANGUAGE_REQUIRED] sessionId=${sessionId} account=${account.ref} state=${account.state}`);
          auditPreferredLanguage(session, account.state, STATES.AUTH_PENDING);
        }

        // Build combined disclosure block
        assertTransition(STATES.AUTH_PENDING, STATES.MINI_MIRANDA_PENDING);
        const { text: disclosureText, disclosuresDelivered } = buildDisclosureBlock(account);
        const now = new Date().toISOString();
        const disclosures = {
          miniMiranda:        disclosuresDelivered.includes('MINI_MIRANDA')        ? now : null,
          collectorStatement: disclosuresDelivered.includes('COLLECTOR_STATEMENT') ? now : null,
          preLegal:           disclosuresDelivered.includes('PRE_LEGAL')           ? now : null,
        };

        // Immediately advance to NEGOTIATION_OPEN with PIF ask
        // (payments > $1,500 are verified via bank.js when the consumer accepts — no pre-emptive cap gate)
        assertTransition(STATES.MINI_MIRANDA_PENDING, STATES.NEGOTIATION_OPEN);
        const pifAsk = pifAskScript(account);
        const msg = disclosureText + '\n\n' + pifAsk;

        const updated = updateSession(sessionId, {
          state:        STATES.NEGOTIATION_OPEN,
          account,
          disclosures,
          offers:       { ...session.offers, PIF: true },
          currentRung:  'PIF',
          pendingOffer: { rung: 'PIF', amount: account.balance },
        });

        // Audit each disclosure as a separate event
        for (const which of disclosuresDelivered) {
          auditDisclosureDelivered(updated, which, STATES.AUTH_PENDING);
        }
        auditStateChange(updated, STATES.AUTH_PENDING, STATES.NEGOTIATION_OPEN, 'auth_success_disclosures_delivered');
        auditOfferMade(updated, { rung: 'PIF', type: 'paid_in_full', amount: account.balance }, STATES.AUTH_PENDING);
        auditBotMessage(updated, msg, STATES.AUTH_PENDING, STATES.NEGOTIATION_OPEN, { disclosuresDelivered });
        logBot(sessionId, msg, STATES.AUTH_PENDING, STATES.NEGOTIATION_OPEN, { disclosuresDelivered });
        return respond(res, updated, msg);
      }

      // ── NEGOTIATION_OPEN — consumer responding to PIF ask ───────────────────
      case STATES.NEGOTIATION_OPEN: {
        const account  = session.account;
        const portfolio = getPortfolio(account.portfolioId);
        const sysPrompt = negotiationOpenPrompt(account, portfolio, session);
        const llm = await runLLM(sysPrompt, session, message, account, portfolio);

        if (llm.escalate) {
          return doEscalate(res, session, STATES.NEGOTIATION_OPEN, 'GUARDRAIL_ESCALATION');
        }

        switch (llm.intent) {
          case 'ACCEPT':
          case 'PAY_FULL': {
            return moveToConfirmation(res, session, STATES.NEGOTIATION_OPEN);
          }

          case 'DECLINE': {
            return advanceAndPresent(res, session, STATES.NEGOTIATION_OPEN, message);
          }

          case 'REQUEST_HUMAN': {
            return doEscalate(res, session, STATES.NEGOTIATION_OPEN, 'CONSUMER_REQUEST');
          }

          default: {
            // ASK_QUESTION, UNCLEAR — return LLM response, stay in state
            auditBotMessage(session, llm.responseText, STATES.NEGOTIATION_OPEN, STATES.NEGOTIATION_OPEN, { intent: llm.intent });
            logBot(sessionId, llm.responseText, STATES.NEGOTIATION_OPEN, STATES.NEGOTIATION_OPEN);
            return respond(res, session, llm.responseText);
          }
        }
      }

      // ── NEGOTIATION — working down the ladder ────────────────────────────────
      case STATES.NEGOTIATION: {
        const account  = session.account;
        const portfolio = getPortfolio(account.portfolioId);
        const sysPrompt = negotiationPrompt(account, portfolio, session);
        const llm = await runLLM(sysPrompt, session, message, account, portfolio);

        if (llm.escalate) {
          return doEscalate(res, session, STATES.NEGOTIATION, 'GUARDRAIL_ESCALATION');
        }

        switch (llm.intent) {
          case 'ACCEPT': {
            return moveToConfirmation(res, session, STATES.NEGOTIATION);
          }

          case 'DECLINE': {
            return advanceAndPresent(res, session, STATES.NEGOTIATION, message);
          }

          case 'REQUEST_HUMAN': {
            return doEscalate(res, session, STATES.NEGOTIATION, 'CONSUMER_REQUEST');
          }

          default: {
            // ASK_QUESTION, UNCLEAR — return LLM answer, stay in state
            auditBotMessage(session, llm.responseText, STATES.NEGOTIATION, STATES.NEGOTIATION, { intent: llm.intent });
            logBot(sessionId, llm.responseText, STATES.NEGOTIATION, STATES.NEGOTIATION);
            return respond(res, session, llm.responseText);
          }
        }
      }

      // ── AWAITING_CONFIRMATION — consumer responding to Reg E script ──────────
      case STATES.AWAITING_CONFIRMATION: {
        const account  = session.account;
        const portfolio = getPortfolio(account.portfolioId);
        const sysPrompt = awaitingConfirmationPrompt(account, portfolio, session);
        const llm = await runLLM(sysPrompt, session, message, account, portfolio);

        if (llm.escalate) {
          return doEscalate(res, session, STATES.AWAITING_CONFIRMATION, 'GUARDRAIL_ESCALATION');
        }

        switch (llm.intent) {
          case 'CONFIRM_YES': {
            const offer = session.pendingOffer;
            const paymentAmount = offer.installmentAmount ?? offer.monthlyPayment ?? offer.amount;

            if (paymentAmount > SELF_SERVICE_PAYMENT_CAP) {
              // Funds verification required for payments over $1,500
              return doVerifyFunds(res, session, STATES.AWAITING_CONFIRMATION, offer);
            }

            // Payment within self-service cap — resolve directly
            assertTransition(STATES.AWAITING_CONFIRMATION, STATES.RESOLVED);
            const closeMsg = 'Your arrangement has been confirmed. A payment specialist will contact you to complete the payment process. ' + closingScript();
            const updated = updateSession(sessionId, { state: STATES.RESOLVED });
            auditPaymentAuthorization(updated, offer, true, STATES.AWAITING_CONFIRMATION);
            auditHierarchyStep(updated, offer.rung, true, STATES.AWAITING_CONFIRMATION);
            auditStateChange(updated, STATES.AWAITING_CONFIRMATION, STATES.RESOLVED, 'consumer_confirmed');
            auditBotMessage(updated, closeMsg, STATES.AWAITING_CONFIRMATION, STATES.RESOLVED, { arrangement: offer });
            logBot(sessionId, closeMsg, STATES.AWAITING_CONFIRMATION, STATES.RESOLVED, { arrangement: offer });
            persistSessionLog(updated);
            return respond(res, updated, closeMsg);
          }

          case 'CONFIRM_NO': {
            // Consumer changed mind — advance rung from AWAITING_CONFIRMATION
            assertTransition(STATES.AWAITING_CONFIRMATION, STATES.NEGOTIATION);
            // Temporarily set state to NEGOTIATION so advanceAndPresent can transition
            const interim = updateSession(sessionId, { state: STATES.NEGOTIATION });
            return advanceAndPresent(res, interim, STATES.NEGOTIATION, message);
          }

          case 'REQUEST_HUMAN': {
            return doEscalate(res, session, STATES.AWAITING_CONFIRMATION, 'CONSUMER_REQUEST');
          }

          default: {
            // ASK_QUESTION, UNCLEAR — stay in state
            auditBotMessage(session, llm.responseText, STATES.AWAITING_CONFIRMATION, STATES.AWAITING_CONFIRMATION, { intent: llm.intent });
            logBot(sessionId, llm.responseText, STATES.AWAITING_CONFIRMATION, STATES.AWAITING_CONFIRMATION);
            return respond(res, session, llm.responseText);
          }
        }
      }

      default:
        return res.status(500).json({ error: `Unknown state: ${state}`, sessionId });
    }

  } catch (err) {
    console.error('[chatHandler]', err);
    return res.status(500).json({ error: err.message });
  }
}
