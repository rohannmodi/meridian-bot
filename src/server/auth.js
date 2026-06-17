import { lookupAccount } from './accounts.js';

/**
 * Authenticate a consumer using the digital self-service standard from ACCOUNTS.md:
 * match ALL of: ref + firstName + lastName + ssn4 + zip.
 * Names are case-insensitive. All fields are trimmed before comparison.
 *
 * @param {{ ref, firstName, lastName, ssn4, zip }} fields
 * @returns {{ ok: boolean, account: object|null }}
 */
export function authenticate(fields) {
  const norm = (s) => String(s ?? '').trim();
  const normName = (s) => norm(s).toLowerCase();

  const ref      = norm(fields.ref);
  const firstName = normName(fields.firstName);
  const lastName  = normName(fields.lastName);
  const ssn4     = norm(fields.ssn4);
  const zip      = norm(fields.zip);

  const account = lookupAccount(ref);
  if (!account) return { ok: false, account: null };

  const match =
    normName(account.firstName) === firstName &&
    normName(account.lastName)  === lastName  &&
    norm(account.ssn4)          === ssn4      &&
    norm(account.zip)           === zip;

  return match
    ? { ok: true, account }
    : { ok: false, account: null };
}
