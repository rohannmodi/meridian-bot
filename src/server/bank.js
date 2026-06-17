/**
 * Mock bank balance lookup — simulates a real-time funds verification call.
 *
 * In production this would be an ACH / Plaid / bank-API call.
 * Here it reads from the bank_balances SQLite table seeded in db.js.
 *
 * NEVER expose the actual bank balance number in any response_text, audit
 * event visible to the consumer, or LLM prompt. Only the verification
 * RESULT (pass/fail) and the internal reason code are used for branching.
 */

import db from './db.js';

const REASONS = {
  INSUFFICIENT_FUNDS:  'INSUFFICIENT_FUNDS',
  ACCOUNT_CLOSED:      'ACCOUNT_CLOSED',
  ACCOUNT_NOT_FOUND:   'ACCOUNT_NOT_FOUND',
};

/**
 * Verify that the bank account can cover `amount`.
 *
 * @param {{ bankAccountNumber: string, amount: number }} params
 * @returns {{ verified: boolean, reason: string|null }}
 */
export function verifyFunds({ bankAccountNumber, amount }) {
  if (!bankAccountNumber) {
    return { verified: false, reason: REASONS.ACCOUNT_NOT_FOUND };
  }

  const row = db
    .prepare('SELECT balance, status FROM bank_balances WHERE accountNumber = ?')
    .get(bankAccountNumber);

  if (!row) {
    return { verified: false, reason: REASONS.ACCOUNT_NOT_FOUND };
  }

  if (row.status !== 'OPEN') {
    return { verified: false, reason: REASONS.ACCOUNT_CLOSED };
  }

  if (row.balance < amount) {
    return { verified: false, reason: REASONS.INSUFFICIENT_FUNDS };
  }

  return { verified: true, reason: null };
}

/**
 * Return the last 4 digits of a bank account number for audit logging.
 * Never log the full account number.
 */
export function bankLast4(accountNumber) {
  const s = String(accountNumber ?? '');
  return s.length >= 4 ? s.slice(-4) : s.padStart(4, '*');
}
