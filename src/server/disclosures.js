// Verbatim disclosure scripts from COMPLIANCE.md.
// The LLM NEVER generates these strings. Code inserts them directly.
// Variables in [BRACKETS] are filled from account objects by code, never by the LLM.

import { needsPreLegalDisclosure } from './flags.js';

// ─── Verbatim scripts ────────────────────────────────────────────────────────

export function greetingScript() {
  return (
    'Thank you for contacting Meridian Recovery Services. My name is ' +
    'Meridian Assistant. This conversation may be monitored and recorded; ' +
    'by continuing you are providing your consent. How may I help you?'
  );
}

export function authPromptScript() {
  return (
    'To access your account, please provide:\n' +
    '1. Your account reference number\n' +
    '2. Your first and last name\n' +
    '3. The last 4 digits of your SSN\n' +
    '4. Your ZIP code'
  );
}

export function authFailedScript() {
  return (
    "I'm unable to verify your identity. For your security, I can't " +
    'share any account details — including whether an account exists. ' +
    "I'll connect you with a representative who can help, or you can " +
    'reach us through our published contact channels.'
  );
}

export function miniMirandaScript() {
  return (
    'This is a communication from a debt collector. This is an attempt ' +
    'to collect a debt, and any information obtained, including this ' +
    'call recording, will be used for that purpose.'
  );
}

/**
 * Collector statement — requires account fields.
 * @param {object} account
 */
export function collectorStatementScript(account) {
  const balance = formatDollars(account.balance);
  const date = formatDate(account.receiveDate);
  return (
    `I am with Meridian Recovery Services on behalf of ${account.client} in ` +
    `regard to your ${account.originalCreditor} account. Your account was ` +
    `placed with our office as of ${date} and reflects a balance of ${balance}. ` +
    'It is my goal to resolve this with you in a courteous and professional ' +
    'manner. How can I help you resolve your balance today?'
  );
}

export function preLegalScript() {
  return (
    'Please be advised that your account has been placed with our office ' +
    'in a pre-legal status. Failure to resolve this matter may result in ' +
    'your account being reviewed by an attorney in your state for possible ' +
    'legal action to collect the balance due.'
  );
}

export function escalationScript() {
  return (
    'I need to transfer you to a specialist who can assist with your ' +
    'account. Please hold while I connect you, or you can reach us ' +
    'through our published contact channels.'
  );
}

export function handoffPendingScript() {
  return 'Connecting you with a specialist now — please hold.';
}

/**
 * Settlement confirmation (Reg E / NACHA) — COMPLIANCE.md §8
 * @param {number} amount
 * @param {string} date  – ISO date string
 */
export function settlementConfirmationScript(amount, date) {
  return (
    'To confirm the arrangement:\n' +
    `- Settlement amount: ${formatDollars(amount)}\n` +
    `- Payment date: ${formatDate(date)}\n` +
    '- Payment method: ACH from your bank account\n\n' +
    'By confirming, you authorize Meridian Recovery Services to debit ' +
    'your account for this amount on the date shown. Changes must be ' +
    'requested by 11 AM the day before the scheduled post.\n\n' +
    'Reply YES to authorize, or NO to discuss other options.'
  );
}

/**
 * Plan confirmation (Reg E / NACHA) — COMPLIANCE.md §9
 * @param {number} monthlyPayment
 * @param {number} months
 * @param {string} firstDate  – ISO date string
 * @param {number} totalPayment
 */
export function planConfirmationScript(monthlyPayment, months, firstDate, totalPayment) {
  return (
    'To confirm the arrangement:\n' +
    `- ${formatDollars(monthlyPayment)} per month for ${months} months\n` +
    `- First payment: ${formatDate(firstDate)}\n` +
    `- Total: ${formatDollars(totalPayment)}\n` +
    '- Payment method: ACH from your bank account\n\n' +
    'By confirming, you authorize Meridian Recovery Services to debit ' +
    'your account on each scheduled date. Changes must be requested ' +
    'by 11 AM the day before any scheduled post.\n\n' +
    'Reply YES to authorize, or NO to discuss other options.'
  );
}

/**
 * Generic auth retry (COMPLIANCE.md — byte-identical regardless of whether
 * the account exists; must never reveal account details).
 */
export function authRetryScript() {
  return "I wasn't able to verify those details. Please try again.";
}

/**
 * PIF ask — top of the resolution hierarchy (PORTFOLIOS.md).
 * Hard-coded phrasing so the LLM never generates this opening line.
 * @param {object} account
 */
export function pifAskScript(account) {
  return `Are you able to pay the balance of ${formatDollars(account.balance)} today?`;
}

/**
 * Closing script (COMPLIANCE.md §10)
 */
export function closingScript() {
  return (
    'Is there anything else I can help you with today? If you have ' +
    'further questions, you can reach us through the agency\'s published ' +
    'contact channels.'
  );
}

/**
 * Sent to consumer while verification is in progress.
 * Must be immediately followed by fundsVerifiedScript() or fundsFailedScript()
 * in the same response — the consumer never waits in VERIFYING_FUNDS.
 */
export function verifyingFundsScript() {
  return 'One moment while I verify funds availability for this arrangement…';
}

/**
 * Sent when bank verification passes.
 * @param {number} amount – the verified per-payment amount
 */
export function fundsVerifiedScript(amount) {
  return `Funds verified. Your arrangement of ${formatDollars(amount)} is confirmed.`;
}

/**
 * Sent when bank verification fails.
 * Never reveals balance, account status, or specific failure reason.
 */
export function fundsFailedScript() {
  return (
    'We were unable to verify funds for that arrangement. ' +
    'Would you like to discuss a smaller arrangement?'
  );
}

// ─── Combined post-auth disclosure block ─────────────────────────────────────

/**
 * Build the combined disclosure message (one message, separate paragraphs):
 *   Mini-Miranda + Collector Statement + Pre-Legal (if applicable)
 * Each is logged as its own DISCLOSURE_DELIVERED audit event by the caller.
 *
 * @param {object} account
 * @returns {{ text: string, disclosuresDelivered: string[] }}
 */
export function buildDisclosureBlock(account) {
  const paragraphs = [];
  const delivered = [];

  paragraphs.push(miniMirandaScript());
  delivered.push('MINI_MIRANDA');

  paragraphs.push(collectorStatementScript(account));
  delivered.push('COLLECTOR_STATEMENT');

  if (needsPreLegalDisclosure(account)) {
    paragraphs.push(preLegalScript());
    delivered.push('PRE_LEGAL');
  }

  return {
    text: paragraphs.join('\n\n'),
    disclosuresDelivered: delivered,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDollars(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(isoDate) {
  // Return placeholders unchanged (e.g. '[DATE]' used before a real date is set)
  if (!isoDate || !String(isoDate).match(/^\d{4}-\d{2}-\d{2}$/)) return isoDate ?? '[DATE]';
  // e.g. "2025-08-15" → "August 15, 2025"
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  return `${months[m - 1]} ${d}, ${y}`;
}
