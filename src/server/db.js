/**
 * SQLite database — single connection for the whole process.
 * Tables: accounts, portfolios, session_logs.
 * Seeded from the original in-memory data on first run.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const DB_PATH = join(__dirname, '../../meridian.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    ref               TEXT PRIMARY KEY,
    firstName         TEXT NOT NULL,
    lastName          TEXT NOT NULL,
    ssn4              TEXT NOT NULL,
    zip               TEXT NOT NULL,
    state             TEXT NOT NULL,
    portfolioId       TEXT NOT NULL,
    originalCreditor  TEXT NOT NULL,
    client            TEXT NOT NULL,
    balance           REAL NOT NULL,
    receiveDate       TEXT NOT NULL,
    flags             TEXT NOT NULL DEFAULT '[]',
    bankAccountNumber TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS bank_balances (
    accountNumber TEXT PRIMARY KEY,
    balance       REAL NOT NULL,
    status        TEXT NOT NULL DEFAULT 'OPEN'
  );

  CREATE TABLE IF NOT EXISTS portfolios (
    id           TEXT PRIMARY KEY,
    client       TEXT NOT NULL,
    type         TEXT NOT NULL,
    maxDiscount  REAL NOT NULL,
    maxMonths    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_logs (
    sessionId        TEXT PRIMARY KEY,
    accountRef       TEXT,
    finalState       TEXT NOT NULL,
    escalationReason TEXT,
    authAttempts     INTEGER NOT NULL DEFAULT 0,
    createdAt        TEXT NOT NULL,
    completedAt      TEXT NOT NULL,
    auditJson        TEXT NOT NULL DEFAULT '[]'
  );
`);

// ─── Migration: add bankAccountNumber if schema is from an older run ──────────

try {
  db.exec("ALTER TABLE accounts ADD COLUMN bankAccountNumber TEXT NOT NULL DEFAULT ''");
  console.log('[db] Migration: added bankAccountNumber column.');
} catch { /* column already exists */ }

// ─── Seed accounts ────────────────────────────────────────────────────────────

const accountCount = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;

// Bank account number assignments (10 digits, mock)
const BANK_ACCOUNT_NUMBERS = {
  'ACC-001': '1234567890',
  'ACC-002': '2345678901',
  'ACC-003': '3456789012',
  'ACC-004': '4567890123',
  'ACC-005': '5678901234',
  'ACC-006': '6789012345',
  'ACC-007': '7890123456',
  'ACC-008': '8901234567',
  'ACC-009': '9012345678',
};

if (accountCount === 0) {
  const ins = db.prepare(`
    INSERT INTO accounts (ref,firstName,lastName,ssn4,zip,state,portfolioId,originalCreditor,client,balance,receiveDate,flags,bankAccountNumber)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const seed = db.transaction(() => {
    ins.run('ACC-001','Sarah','Johnson','4321','10001','NY','P-200','First National Bank','Apex Card',4200.00,'2025-08-15','[]',BANK_ACCOUNT_NUMBERS['ACC-001']);
    ins.run('ACC-002','Luis','Martinez','8765','94102','CA','P-100','Westside Auto Finance','Northwind Capital',8500.00,'2025-09-02','[]',BANK_ACCOUNT_NUMBERS['ACC-002']);
    ins.run('ACC-003','Wei','Chen','1122','60601','IL','P-300','Lakeside Lending','Harbor Recovery',2100.00,'2025-10-10','["PRE_LEGAL"]',BANK_ACCOUNT_NUMBERS['ACC-003']);
    ins.run('ACC-004','Mary','Wilson','5544','30301','GA','P-200','First National Bank','Apex Card',3800.00,'2025-07-20','["BKY"]',BANK_ACCOUNT_NUMBERS['ACC-004']);
    ins.run('ACC-005','Anita','Patel','9988','02101','MA','P-100','Westside Auto Finance','Northwind Capital',6200.00,'2025-08-30','["DSP"]',BANK_ACCOUNT_NUMBERS['ACC-005']);
    ins.run('ACC-006','Ryan','OBrien','3344','98101','WA','P-200','First National Bank','Apex Card',5500.00,'2025-09-12','["CNA"]',BANK_ACCOUNT_NUMBERS['ACC-006']);
    ins.run('ACC-007','Maria','Garcia','7777','75201','TX','P-200','First National Bank','Apex Card',3200.00,'2025-10-01','[]',BANK_ACCOUNT_NUMBERS['ACC-007']);
    ins.run('ACC-008','David','Kim','2211','02906','RI','P-200','First National Bank','Apex Card',1800.00,'2025-09-20','["VOD"]',BANK_ACCOUNT_NUMBERS['ACC-008']);
    ins.run('ACC-009','James','Foster','6655','33101','FL','P-100','Westside Auto Finance','Northwind Capital',12000.00,'2025-08-05','[]',BANK_ACCOUNT_NUMBERS['ACC-009']);
  });
  seed();
  console.log('[db] Seeded 9 accounts.');
} else {
  // Idempotently backfill bankAccountNumbers for accounts seeded without them
  const backfill = db.prepare("UPDATE accounts SET bankAccountNumber=? WHERE ref=? AND (bankAccountNumber IS NULL OR bankAccountNumber='')");
  const backfillTx = db.transaction(() => {
    for (const [ref, num] of Object.entries(BANK_ACCOUNT_NUMBERS)) {
      backfill.run(num, ref);
    }
  });
  backfillTx();
}

// ─── Seed portfolios ──────────────────────────────────────────────────────────

const portfolioCount = db.prepare('SELECT COUNT(*) AS n FROM portfolios').get().n;

if (portfolioCount === 0) {
  const ins = db.prepare(`
    INSERT INTO portfolios (id,client,type,maxDiscount,maxMonths)
    VALUES (?,?,?,?,?)
  `);
  const seed = db.transaction(() => {
    ins.run('P-100','Northwind Capital','Auto/secured',0.35,6);
    ins.run('P-200','Apex Card','Credit card',0.50,12);
    ins.run('P-300','Harbor Recovery','Personal pre-legal',0.25,18);
  });
  seed();
  console.log('[db] Seeded 3 portfolios.');
}

// ─── Seed bank balances ───────────────────────────────────────────────────────
// Keyed by bankAccountNumber. Balances chosen to produce a mix of pass/fail
// outcomes across the 9 accounts (see BANK_BALANCES design notes in README).
//
//  ACC-001 ($4,200, P-200): bank $5,500 → PIF $4,200 ✓ PASSES
//  ACC-002 ($8,500, P-100): bank $6,000 → PIF $8,500 ✗ FAILS; SIF $5,525 ✓ PASSES
//  ACC-003 ($2,100, P-300): bank $400   → PIF/SIF fail but BIF $1,050/mo < cap → no verify
//  ACC-004–006, ACC-008   : escalated by flag — bank balance irrelevant
//  ACC-007 ($3,200, P-200): bank $4,500 → PIF $3,200 ✓ PASSES
//  ACC-009 ($12,000,P-100): bank $6,000 → SIF $7,800 ✗ FAILS; SIF_PAYMENTS $2,600 ✓ PASSES

const bankCount = db.prepare('SELECT COUNT(*) AS n FROM bank_balances').get().n;
if (bankCount === 0) {
  const insBankBal = db.prepare('INSERT INTO bank_balances (accountNumber,balance,status) VALUES (?,?,?)');
  const seedBank = db.transaction(() => {
    insBankBal.run('1234567890', 5500,  'OPEN');   // ACC-001
    insBankBal.run('2345678901', 6000,  'OPEN');   // ACC-002
    insBankBal.run('3456789012',  400,  'OPEN');   // ACC-003
    insBankBal.run('4567890123', 2000,  'OPEN');   // ACC-004
    insBankBal.run('5678901234', 3500,  'OPEN');   // ACC-005
    insBankBal.run('6789012345', 2500,  'OPEN');   // ACC-006
    insBankBal.run('7890123456', 4500,  'OPEN');   // ACC-007
    insBankBal.run('8901234567', 1000,  'OPEN');   // ACC-008
    insBankBal.run('9012345678', 6000,  'OPEN');   // ACC-009
  });
  seedBank();
  console.log('[db] Seeded 9 bank balances.');
}

export default db;
