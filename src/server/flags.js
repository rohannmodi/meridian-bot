// Flag and region checks. Any escalation flag → ESCALATED before any negotiation.
// PRE_LEGAL is not an escalation flag — it triggers an extra disclosure only.

const ESCALATION_FLAGS = new Set(['BKY', 'DSP', 'VOD', 'CNA', 'CDP', 'FRA', 'DEC', 'MIL', 'LIT']);

const NON_SERVICED_REGIONS = new Set([
  'AA', 'AE', 'AP', 'GU', 'MP', 'PR', 'VI', 'FM', 'MH', 'PW',
]);

// States where a preferred-language audit event should be logged (known gap — no output change)
export const PREFERRED_LANGUAGE_STATES = new Set(['CA', 'NY', 'NM']);

/**
 * Check account flags for any that require immediate escalation.
 * @param {object} account
 * @returns {{ escalate: boolean, reason: string|null }}
 */
export function checkFlags(account) {
  for (const flag of (account.flags ?? [])) {
    if (ESCALATION_FLAGS.has(flag)) {
      return { escalate: true, reason: flag };
    }
  }
  return { escalate: false, reason: null };
}

/**
 * Check whether the account's state is in a non-serviced region.
 * @param {object} account
 * @returns {{ escalate: boolean, reason: string|null }}
 */
export function checkRegion(account) {
  if (NON_SERVICED_REGIONS.has(account.state)) {
    return { escalate: true, reason: 'REGION_NOT_SERVICED' };
  }
  return { escalate: false, reason: null };
}

/**
 * Returns true if this account needs the pre-legal disclosure.
 * P-300 portfolio only, and not suppressed by BREACHED_ARRANGEMENT or NSF_RECENT.
 */
export function needsPreLegalDisclosure(account) {
  if (account.portfolioId !== 'P-300') return false;
  const flags = account.flags ?? [];
  if (flags.includes('BREACHED_ARRANGEMENT') || flags.includes('NSF_RECENT')) return false;
  return true;
}

/**
 * Returns true if this account's state requires a preferred-language audit log entry.
 */
export function needsPreferredLanguageLog(account) {
  return PREFERRED_LANGUAGE_STATES.has(account.state);
}
