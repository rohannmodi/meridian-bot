/**
 * Portfolio store — SQLite backed via db.js.
 * All functions are synchronous (better-sqlite3 is sync).
 */

import db from './db.js';

const stmts = {
  getOne: db.prepare('SELECT * FROM portfolios WHERE id = ?'),
  getAll: db.prepare('SELECT * FROM portfolios ORDER BY id'),
  update: db.prepare(`
    UPDATE portfolios
    SET client=@client, type=@type, maxDiscount=@maxDiscount, maxMonths=@maxMonths
    WHERE id=@id
  `),
};

/**
 * Returns portfolio object or throws if id is unknown.
 * @param {string} id
 * @returns {{ id, client, type, maxDiscount, maxMonths }}
 */
export function getPortfolio(id) {
  const p = stmts.getOne.get(id);
  if (!p) throw new Error(`Unknown portfolio: ${id}`);
  return p;
}

/** Return all portfolios as an array. */
export function getAllPortfolios() {
  return stmts.getAll.all();
}

/**
 * Update portfolio fields. Returns updated portfolio or null if not found.
 * @param {string} id
 * @param {{ client?, type?, maxDiscount?, maxMonths? }} fields
 */
export function updatePortfolio(id, fields) {
  const existing = stmts.getOne.get(id);
  if (!existing) return null;
  const merged = { ...existing, ...fields, id };
  stmts.update.run(merged);
  return stmts.getOne.get(id);
}
