/**
 * Admin REST API — no auth (dev/internal use only).
 * Mounted at /api/admin in index.js.
 *
 * Accounts:       GET/POST /accounts   PUT/DELETE /accounts/:ref
 * Portfolios:     GET /portfolios       PUT /portfolios/:id
 * Active sessions: GET /sessions        GET /sessions/:id/audit
 * Session logs:   GET /session-logs     GET /session-logs/:id
 */

import { Router } from 'express';
import {
  getAllAccounts,
  lookupAccount,
  createAccount,
  updateAccount,
  deleteAccount,
} from './accounts.js';
import { getAllPortfolios, getPortfolio, updatePortfolio } from './portfolios.js';
import { getAllSessions } from './sessions.js';
import db from './db.js';

export const adminRouter = Router();

// ─── Accounts ─────────────────────────────────────────────────────────────────

adminRouter.get('/accounts', (_req, res) => {
  res.json(getAllAccounts());
});

adminRouter.get('/accounts/:ref', (req, res) => {
  const account = lookupAccount(req.params.ref);
  if (!account) return res.status(404).json({ error: 'Not found' });
  res.json(account);
});

adminRouter.post('/accounts', (req, res) => {
  const { ref, firstName, lastName, ssn4, zip, state, portfolioId,
          originalCreditor, client, balance, receiveDate, flags } = req.body ?? {};

  const missing = ['ref','firstName','lastName','ssn4','zip','state',
    'portfolioId','originalCreditor','client','balance','receiveDate']
    .filter(f => req.body[f] === undefined || req.body[f] === '');

  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }
  if (lookupAccount(ref)) {
    return res.status(409).json({ error: `Account ${ref} already exists` });
  }

  try {
    const account = createAccount({
      ref, firstName, lastName, ssn4, zip, state, portfolioId,
      originalCreditor, client,
      balance: Number(balance),
      receiveDate,
      flags: Array.isArray(flags) ? flags : [],
    });
    res.status(201).json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.put('/accounts/:ref', (req, res) => {
  const account = updateAccount(req.params.ref, {
    ...req.body,
    balance: req.body.balance !== undefined ? Number(req.body.balance) : undefined,
    flags: Array.isArray(req.body.flags) ? req.body.flags : undefined,
  });
  if (!account) return res.status(404).json({ error: 'Not found' });
  res.json(account);
});

adminRouter.delete('/accounts/:ref', (req, res) => {
  const deleted = deleteAccount(req.params.ref);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true, ref: req.params.ref });
});

// ─── Portfolios ───────────────────────────────────────────────────────────────

adminRouter.get('/portfolios', (_req, res) => {
  res.json(getAllPortfolios());
});

adminRouter.put('/portfolios/:id', (req, res) => {
  const updated = updatePortfolio(req.params.id, {
    ...req.body,
    maxDiscount: req.body.maxDiscount !== undefined ? Number(req.body.maxDiscount) : undefined,
    maxMonths:   req.body.maxMonths   !== undefined ? Number(req.body.maxMonths)   : undefined,
  });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

// ─── Active sessions (in-memory) ─────────────────────────────────────────────

adminRouter.get('/sessions', (_req, res) => {
  res.json(getAllSessions());
});

adminRouter.get('/sessions/:sessionId/audit', (req, res) => {
  // Pull from in-memory session store via the same sessions module
  // (importing getSession here to avoid circular dep issues)
  import('./sessions.js').then(({ getSession }) => {
    const session = getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ sessionId: req.params.sessionId, state: session.state, audit: session.audit });
  });
});

// ─── Bank balances ────────────────────────────────────────────────────────────

adminRouter.get('/bank-balances', (_req, res) => {
  // Join with accounts to show human-readable context alongside the balance
  const rows = db.prepare(`
    SELECT
      bb.accountNumber,
      bb.balance,
      bb.status,
      a.ref          AS accountRef,
      a.firstName    AS firstName,
      a.lastName     AS lastName,
      a.bankAccountNumber
    FROM bank_balances bb
    LEFT JOIN accounts a ON a.bankAccountNumber = bb.accountNumber
    ORDER BY bb.accountNumber
  `).all();
  res.json(rows);
});

adminRouter.put('/bank-balances/:accountNumber', (req, res) => {
  const { balance, status } = req.body ?? {};
  const existing = db.prepare('SELECT * FROM bank_balances WHERE accountNumber = ?').get(req.params.accountNumber);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE bank_balances SET balance = ?, status = ? WHERE accountNumber = ?')
    .run(
      balance !== undefined ? Number(balance) : existing.balance,
      status  !== undefined ? status          : existing.status,
      req.params.accountNumber,
    );
  res.json(db.prepare('SELECT * FROM bank_balances WHERE accountNumber = ?').get(req.params.accountNumber));
});

// ─── Completed session logs (SQLite) ─────────────────────────────────────────

adminRouter.get('/session-logs', (_req, res) => {
  const rows = db.prepare(
    'SELECT sessionId,accountRef,finalState,escalationReason,authAttempts,createdAt,completedAt FROM session_logs ORDER BY completedAt DESC'
  ).all();
  res.json(rows);
});

adminRouter.get('/session-logs/:sessionId', (req, res) => {
  const row = db.prepare('SELECT * FROM session_logs WHERE sessionId = ?').get(req.params.sessionId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ...row, audit: JSON.parse(row.auditJson ?? '[]') });
});
