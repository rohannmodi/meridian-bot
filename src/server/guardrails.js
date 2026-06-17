// Guardrail layers 3–9 from GUARDRAILS.md.
// Layers 1 (system prompt constraints) and 2 (structured output) live in prompts.js / llm.js.
// Every LLM response_text passes through validateResponse() before reaching the consumer.

import { SELF_SERVICE_PAYMENT_CAP } from './limits.js';
import { miniMirandaScript, preLegalScript } from './disclosures.js';

const FALLBACK_TEXT = 'Let me recalculate that for you.';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract all dollar amounts from a string. Returns array of numbers. */
function extractDollarAmounts(text) {
  const matches = text.match(/\$[\d,]+(\.\d+)?/g) ?? [];
  return matches.map(m => parseFloat(m.replace(/[$,]/g, '')));
}

/** Extract all percentage values from a string. Returns array of fractions (e.g. 0.50 for "50%"). */
function extractPercentages(text) {
  const matches = text.match(/(\d+(?:\.\d+)?)\s*%/g) ?? [];
  return matches.map(m => parseFloat(m) / 100);
}

/** Round to cents */
function rc(n) { return Math.round(n * 100) / 100; }

// ─── Layer 3: Dollar amount validator ────────────────────────────────────────

/**
 * Every dollar amount in response_text must be one of:
 *   - account.balance
 *   - a valid settlement (balance × (1 - d), d ≤ maxDiscount)
 *   - a valid monthly payment (balance / n, n ≤ effectiveMaxMonths)
 * @returns {{ valid: boolean, violations: string[] }}
 */
export function validateDollarAmounts(text, account, portfolio) {
  const amounts = extractDollarAmounts(text);
  if (amounts.length === 0) return { valid: true, violations: [] };

  const { balance } = account;
  const violations = [];

  // Build set of permissible amounts
  const permissible = new Set();

  // Balance itself
  permissible.add(rc(balance));

  // All valid settlement amounts (every discount from 1% up to maxDiscount)
  for (let d = 0.01; d <= portfolio.maxDiscount + 0.001; d += 0.01) {
    permissible.add(rc(balance * (1 - d)));
  }
  // Also the exact max-discount settlement
  permissible.add(rc(balance * (1 - portfolio.maxDiscount)));

  // All valid monthly payments (1..maxMonths, both with and without financial profile)
  for (let n = 1; n <= portfolio.maxMonths; n++) {
    permissible.add(rc(balance / n));
  }

  // SIF installment amounts (settlement / 1, 2, or 3)
  for (let d = 0.01; d <= portfolio.maxDiscount + 0.001; d += 0.01) {
    const sifAmount = rc(balance * (1 - d));
    for (let inst = 1; inst <= 3; inst++) {
      permissible.add(rc(sifAmount / inst));
    }
  }

  for (const amt of amounts) {
    const rounded = rc(amt);
    // Allow a tiny rounding tolerance
    const allowed = [...permissible].some(p => Math.abs(p - rounded) < 0.02);
    if (!allowed) {
      violations.push(`$${amt.toFixed(2)} is not a valid amount for this account`);
    }
  }

  return { valid: violations.length === 0, violations };
}

// ─── Layer 3: Percentage validator ───────────────────────────────────────────

/**
 * Every percentage in response_text must be ≤ portfolio.maxDiscount.
 * @returns {{ valid: boolean, violations: string[] }}
 */
export function validatePercentages(text, portfolio) {
  const pcts = extractPercentages(text);
  const violations = [];
  for (const p of pcts) {
    if (p > portfolio.maxDiscount + 0.001) {
      violations.push(`${(p * 100).toFixed(1)}% exceeds portfolio max of ${(portfolio.maxDiscount * 100).toFixed(0)}%`);
    }
  }
  return { valid: violations.length === 0, violations };
}

// ─── Layer 4: Intent gating ───────────────────────────────────────────────────

// Must stay in sync with the intent lists in prompts.js.
const ALLOWED_INTENTS = {
  NEGOTIATION_OPEN:     ['DECLINE', 'ACCEPT', 'PAY_FULL', 'ASK_QUESTION', 'REQUEST_HUMAN', 'UNCLEAR', 'OTHER'],
  NEGOTIATION:          ['DECLINE', 'ACCEPT', 'PAY_FULL', 'ASK_QUESTION', 'REQUEST_HUMAN', 'UNCLEAR', 'OTHER'],
  AWAITING_CONFIRMATION:['CONFIRM_YES', 'CONFIRM_NO', 'ASK_QUESTION', 'REQUEST_HUMAN', 'UNCLEAR', 'OTHER'],
};

/**
 * @returns {{ allowed: boolean, deflect: string|null }}
 */
export function gateIntent(intent, state) {
  const allowed = ALLOWED_INTENTS[state] ?? [];
  if (allowed.includes(intent)) return { allowed: true, deflect: null };
  return {
    allowed: false,
    deflect: "I want to make sure I understand. Are you looking to make a payment arrangement today, or is there something specific I can help you with?",
  };
}

// ─── Layer 6: Verbatim disclosure detection ───────────────────────────────────

const VERBATIM_DISCLOSURES = [
  { key: 'MINI_MIRANDA',  text: miniMirandaScript() },
  { key: 'PRE_LEGAL',     text: preLegalScript() },
];

/**
 * Detect if LLM tried to generate a verbatim compliance disclosure.
 * (We log this; code-inserted version is what the consumer sees.)
 * @returns {{ containsVerbatim: boolean, which: string[] }}
 */
export function detectVerbatimDisclosures(text) {
  const which = [];
  for (const { key, text: script } of VERBATIM_DISCLOSURES) {
    // Check for substantial overlap (first 40 chars)
    if (text.includes(script.slice(0, 40))) {
      which.push(key);
    }
  }
  return { containsVerbatim: which.length > 0, which };
}

// ─── Layer 7: Payment cap ─────────────────────────────────────────────────────

/**
 * Any single dollar amount > $1,500 in the response triggers escalation.
 * @returns {{ exceeds: boolean, amounts: number[] }}
 */
export function checkPaymentCap(text) {
  const amounts = extractDollarAmounts(text);
  const over = amounts.filter(a => a > SELF_SERVICE_PAYMENT_CAP);
  return { exceeds: over.length > 0, amounts: over };
}

// ─── Layer 9: Hierarchy enforcement (called from chat.js, not here) ───────────
// Tracked on session.offered; chat.js overrides when LLM tries to skip rungs.

// ─── Master validator ────────────────────────────────────────────────────────

/**
 * Run all applicable guardrail layers on an LLM response_text.
 *
 * @param {string} responseText  – LLM-generated text
 * @param {object} account
 * @param {object} portfolio
 * @param {string} state         – current conversation state
 * @param {object} session       – for hierarchy tracking
 * @returns {{ pass: boolean, responseText: string, violations: string[], escalate: boolean, verbatimWarnings: string[] }}
 */
export function validateResponse(responseText, account, portfolio, state, session) {
  const violations = [];
  let escalate = false;

  // Layer 6: verbatim disclosure detection (log only, don't fail)
  const { containsVerbatim, which: verbatimWarnings } = detectVerbatimDisclosures(responseText);

  // Layer 7: payment cap.
  // Not checked on LLM response_text here — the LLM legitimately mentions total
  // settlement amounts (e.g. "$2,100 total across 3 installments") which would
  // falsely trip the cap. The authoritative cap check is done in chat.js against
  // offer.installmentAmount / offer.monthlyPayment / offer.amount BEFORE and AFTER
  // the consumer confirms. If an offer is presented to the LLM it has already
  // passed the code-level cap gate.

  // Layer 3: dollar amounts (only validate if account is present)
  if (account && portfolio) {
    const dollarCheck = validateDollarAmounts(responseText, account, portfolio);
    if (!dollarCheck.valid) {
      violations.push(...dollarCheck.violations);
    }

    // Layer 3: percentages
    const pctCheck = validatePercentages(responseText, portfolio);
    if (!pctCheck.valid) {
      violations.push(...pctCheck.violations);
    }
  }

  const pass = violations.length === 0;

  return {
    pass,
    responseText: pass ? responseText : FALLBACK_TEXT,
    violations,
    escalate,
    verbatimWarnings,
  };
}
