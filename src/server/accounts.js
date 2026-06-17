/**
 * Account store — SQLite backed via db.js.
 * All functions are synchronous (better-sqlite3 is sync).
 * flags column is stored as JSON string; all reads parse it back to an array.
 */

import db from './db.js';

function parseAccount(row) {
  if (!row) return null;
  return { ...row, flags: JSON.parse(row.flags ?? '[]') };
}

const stmts = {
  getOne:  db.prepare('SELECT * FROM accounts WHERE ref = ?'),
  getAll:  db.prepare('SELECT * FROM accounts ORDER BY ref'),
  insert:  db.prepare(`
    INSERT INTO accounts (ref,firstName,lastName,ssn4,zip,state,portfolioId,originalCreditor,client,balance,receiveDate,flags)
    VALUES (@ref,@firstName,@lastName,@ssn4,@zip,@state,@portfolioId,@originalCreditor,@client,@balance,@receiveDate,@flags)
  `),
  update:  db.prepare(`
    UPDATE accounts
    SET firstName=@firstName, lastName=@lastName, ssn4=@ssn4, zip=@zip,
        state=@state, portfolioId=@portfolioId, originalCreditor=@originalCreditor,
        client=@client, balance=@balance, receiveDate=@receiveDate, flags=@flags
    WHERE ref=@ref
  `),
  remove:  db.prepare('DELETE FROM accounts WHERE ref = ?'),
};

/** Look up one account by reference number. Returns null if not found. */
export function lookupAccount(ref) {
  return parseAccount(stmts.getOne.get(ref));
}

/** Return all accounts as an array. */
export function getAllAccounts() {
  return stmts.getAll.all().map(parseAccount);
}

/**
 * Create a new account. Throws if ref already exists.
 * @param {object} data – must include all required fields; flags is an array
 */
export function createAccount(data) {
  stmts.insert.run({ ...data, flags: JSON.stringify(data.flags ?? []) });
  return lookupAccount(data.ref);
}

/**
 * Update an existing account. Returns the updated account or null if not found.
 * @param {string} ref
 * @param {object} fields – partial; only listed keys are updated
 */
export function updateAccount(ref, fields) {
  const existing = lookupAccount(ref);
  if (!existing) return null;
  const merged = { ...existing, ...fields, ref };
  stmts.update.run({ ...merged, flags: JSON.stringify(merged.flags ?? []) });
  return lookupAccount(ref);
}

/**
 * Delete an account. Returns true if a row was deleted.
 * @param {string} ref
 */
export function deleteAccount(ref) {
  const result = stmts.remove.run(ref);
  return result.changes > 0;
}
