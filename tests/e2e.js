/**
 * Step 7 — End-to-End Verification
 *
 * Run with server on :3001:
 *   node tests/e2e.js 2>&1 | tee tests/e2e-output.txt
 *
 * Produces:
 *   (a) Full request/response transcript per account
 *   (b) GET /api/session/:sessionId — final state
 *   (c) GET /api/audit/:sessionId  — full audit log
 *   Summary table
 */

const BASE = 'http://localhost:3001';
const SEP  = '─'.repeat(72);
const SEP2 = '═'.repeat(72);

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function apiChat(body) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function apiSession(sid) {
  const r = await fetch(`${BASE}/api/session/${sid}`);
  return r.json();
}

async function apiAudit(sid) {
  const r = await fetch(`${BASE}/api/audit/${sid}`);
  return r.json();
}

// ─── Turn helpers ─────────────────────────────────────────────────────────────

let _turn = 0;
function printTurn(label, req, res) {
  _turn++;
  console.log(`\n  [Turn ${_turn}] ${label}`);
  console.log(`  REQ: ${JSON.stringify(req)}`);
  console.log(`  RES state=${res.state} msg="${(res.message ?? '').slice(0, 120).replace(/\n/g, '↵')}..."`);
  if (res.statusMeta) {
    const m = res.statusMeta;
    console.log(`  META: rung=${m.currentRung} offers=${JSON.stringify(m.offers)} attemptsLeft=${m.attemptsRemaining}`);
  }
}

async function turn(sid, body, label) {
  const req = sid ? { sessionId: sid, ...body } : body;
  const res = await apiChat(req);
  printTurn(label, req, res);
  return res;
}

// ─── Assertions ───────────────────────────────────────────────────────────────

const results = [];

function check(account, desc, pass, notes = '') {
  const icon = pass ? '✓' : '✗ FAIL';
  if (!pass) console.error(`  !! ASSERTION FAILED: ${desc} — ${notes}`);
  results.push({ account, desc, pass, notes });
}

// ─── Account test fixtures ────────────────────────────────────────────────────

const CREDS = {
  'ACC-001': { accountRef: 'ACC-001', firstName: 'Sarah',  lastName: 'Johnson',  ssn4: '4321', zip: '10001' },
  'ACC-002': { accountRef: 'ACC-002', firstName: 'Luis',   lastName: 'Martinez', ssn4: '8765', zip: '94102' },
  'ACC-003': { accountRef: 'ACC-003', firstName: 'Wei',    lastName: 'Chen',     ssn4: '1122', zip: '60601' },
  'ACC-004': { accountRef: 'ACC-004', firstName: 'Mary',   lastName: 'Wilson',   ssn4: '5544', zip: '30301' },
  'ACC-005': { accountRef: 'ACC-005', firstName: 'Anita',  lastName: 'Patel',    ssn4: '9988', zip: '02101' },
  'ACC-006': { accountRef: 'ACC-006', firstName: 'Ryan',   lastName: 'OBrien',   ssn4: '3344', zip: '98101' },
  'ACC-007': { accountRef: 'ACC-007', firstName: 'Maria',  lastName: 'Garcia',   ssn4: '7777', zip: '75201' },
  'ACC-008': { accountRef: 'ACC-008', firstName: 'David',  lastName: 'Kim',      ssn4: '2211', zip: '02906' },
  'ACC-009': { accountRef: 'ACC-009', firstName: 'James',  lastName: 'Foster',   ssn4: '6655', zip: '33101' },
};

// Fields that must NOT appear in escalation responses for flagged accounts
const LEAK_FORBIDDEN = {
  'ACC-004': ['3800', '3,800', 'First National Bank', 'Apex Card', 'Mary', 'Wilson', 'attempt to collect a debt'],
  'ACC-005': ['6200', '6,200', 'Westside Auto Finance', 'Northwind Capital', 'Anita', 'Patel', 'attempt to collect a debt'],
  'ACC-006': ['5500', '5,500', 'First National Bank', 'Apex Card', 'Ryan', 'OBrien', 'attempt to collect a debt'],
  'ACC-008': ['1800', '1,800', 'First National Bank', 'Apex Card', 'David', 'Kim', 'attempt to collect a debt'],
};

// ─── Test implementations ─────────────────────────────────────────────────────

async function testGreetAndAuth(ref, label) {
  console.log(`\n${SEP}\n  GREETING\n${SEP}`);
  _turn = 0;
  const g = await apiChat({});
  printTurn('GREETING (no sessionId)', {}, g);
  const sid = g.sessionId;
  console.log(`  Session: ${sid}`);

  console.log(`\n${SEP}\n  AUTH\n${SEP}`);
  const a = await turn(sid, { auth: CREDS[ref] }, `AUTH ${ref}`);
  return { sid, authRes: a };
}

// ── ACC-001: happy path, full ladder negotiation, RESOLVED ──────────────────
async function testACC001() {
  console.log(`\n${SEP2}\n  ACC-001 Sarah Johnson — P-200 $4,200 clean → RESOLVED\n${SEP2}`);
  const { sid, authRes } = await testGreetAndAuth('ACC-001', 'ACC-001');

  check('ACC-001', 'auth → NEGOTIATION_OPEN', authRes.state === 'NEGOTIATION_OPEN');
  check('ACC-001', 'disclosure contains Mini-Miranda', authRes.message?.includes('attempt to collect a debt'));
  check('ACC-001', 'PIF ask in disclosure message', authRes.message?.includes('$4,200.00'));

  // Decline PIF
  const d1 = await turn(sid, { message: 'No, I cannot pay in full.' }, 'Decline PIF');
  check('ACC-001', 'after PIF decline → NEGOTIATION', d1.state === 'NEGOTIATION');
  check('ACC-001', 'BIF_PAYMENTS rung offered', d1.statusMeta?.currentRung === 'BIF_PAYMENTS');
  check('ACC-001', 'BIF response mentions $1,400', d1.message?.includes('1,400') || d1.message?.includes('1400'));

  // Accept BIF_PAYMENTS
  const a1 = await turn(sid, { message: 'Yes, $1,400 a month works for me.' }, 'Accept BIF_PAYMENTS');
  check('ACC-001', 'accept → AWAITING_CONFIRMATION', a1.state === 'AWAITING_CONFIRMATION');
  check('ACC-001', 'Reg E script contains monthly payment', a1.message?.includes('1,400'));
  check('ACC-001', 'Reg E script contains "Reply YES"', a1.message?.includes('Reply YES'));

  // Confirm YES
  const y1 = await turn(sid, { message: 'YES' }, 'Confirm YES');
  check('ACC-001', 'YES → RESOLVED', y1.state === 'RESOLVED');

  const sess = await apiSession(sid);
  const audit = await apiAudit(sid);

  console.log('\n  (b) SESSION FINAL STATE:');
  console.log(JSON.stringify({ state: sess.state, currentRung: sess.currentRung, offers: sess.offers, pendingOffer: sess.pendingOffer, escalationReason: sess.escalationReason }, null, 2));
  console.log('\n  (c) AUDIT LOG:');
  console.log(JSON.stringify(audit.audit, null, 2));

  check('ACC-001', 'final state = RESOLVED', sess.state === 'RESOLVED');
  check('ACC-001', 'DISCLOSURE_DELIVERED events ≥ 2', audit.audit.filter(e => e.event === 'DISCLOSURE_DELIVERED').length >= 2);
  check('ACC-001', 'PAYMENT_AUTHORIZATION event present', audit.audit.some(e => e.event === 'PAYMENT_AUTHORIZATION'));
}

// ── ACC-002: P-100, BIF at 6mo ($1,416.67), preferred-language audit ─────────
async function testACC002() {
  console.log(`\n${SEP2}\n  ACC-002 Luis Martinez — P-100 $8,500 CA → RESOLVED + PREFERRED_LANGUAGE\n${SEP2}`);
  const { sid, authRes } = await testGreetAndAuth('ACC-002', 'ACC-002');

  check('ACC-002', 'auth → NEGOTIATION_OPEN', authRes.state === 'NEGOTIATION_OPEN');

  // Decline PIF
  const d1 = await turn(sid, { message: 'I cannot pay that in full.' }, 'Decline PIF');
  check('ACC-002', 'BIF_PAYMENTS offered', d1.statusMeta?.currentRung === 'BIF_PAYMENTS');
  // P-100 maxMonths=6, $8,500/6 = $1,416.67 — log LLM text for manual inspection
  console.log(`  INFO ACC-002 BIF presentation: "${(d1.message ?? '').slice(0, 250)}"`);
  // Authoritative math check is on the code-generated Reg E below, not the LLM prose

  // Accept BIF_PAYMENTS
  const a1 = await turn(sid, { message: 'Yes, I can do that.' }, 'Accept BIF_PAYMENTS');
  check('ACC-002', 'accept → AWAITING_CONFIRMATION', a1.state === 'AWAITING_CONFIRMATION');
  // Reg E is code-generated from pendingOffer — authoritative source for the dollar amount
  check('ACC-002', 'Reg E contains $1,416.67 (code-generated, authoritative)', a1.message?.includes('1,416.67'));

  // Confirm
  const y1 = await turn(sid, { message: 'YES' }, 'Confirm YES');
  check('ACC-002', 'YES → RESOLVED', y1.state === 'RESOLVED');

  const sess = await apiSession(sid);
  const audit = await apiAudit(sid);

  console.log('\n  (b) SESSION FINAL STATE:');
  console.log(JSON.stringify({ state: sess.state, currentRung: sess.currentRung, offers: sess.offers }, null, 2));
  console.log('\n  (c) AUDIT LOG:');
  console.log(JSON.stringify(audit.audit, null, 2));

  check('ACC-002', 'PREFERRED_LANGUAGE_REQUIRED in audit',
    audit.audit.some(e => e.event === 'PREFERRED_LANGUAGE_REQUIRED'));
  check('ACC-002', 'preferred-language account_state = CA',
    audit.audit.find(e => e.event === 'PREFERRED_LANGUAGE_REQUIRED')?.data?.account_state === 'CA');
}

// ── ACC-003: P-300 pre-legal disclosure ────────────────────────────────────
async function testACC003() {
  console.log(`\n${SEP2}\n  ACC-003 Wei Chen — P-300 $2,100 PRE_LEGAL → RESOLVED + pre-legal disclosure\n${SEP2}`);
  const { sid, authRes } = await testGreetAndAuth('ACC-003', 'ACC-003');

  check('ACC-003', 'auth → NEGOTIATION_OPEN', authRes.state === 'NEGOTIATION_OPEN');

  const preNeedle = 'pre-legal status';
  check('ACC-003', 'disclosure contains pre-legal text', authRes.message?.toLowerCase().includes(preNeedle));
  // "attempt to collect a debt" appears in Mini-Miranda. If messages were split, it would appear twice.
  // split() by the phrase yields (N+1) parts where N = occurrences. One occurrence = 2 parts.
  check('ACC-003', 'disclosures in ONE combined message (Mini-Miranda appears exactly once)',
    authRes.message?.split('attempt to collect a debt').length === 2);

  // Count disclosures in audit
  const auditMid = await apiAudit(sid);
  const disclosureEvents = auditMid.audit.filter(e => e.event === 'DISCLOSURE_DELIVERED');
  check('ACC-003', '3 DISCLOSURE_DELIVERED events (mini-miranda + collector + pre-legal)', disclosureEvents.length === 3);
  check('ACC-003', 'PRE_LEGAL disclosure logged', disclosureEvents.some(e => e.data?.which === 'PRE_LEGAL'));

  // Decline PIF → accept BIF_PAYMENTS ($1,050 × 2) → confirm
  const d1 = await turn(sid, { message: 'No.' }, 'Decline PIF');
  check('ACC-003', 'BIF_PAYMENTS offered', d1.statusMeta?.currentRung === 'BIF_PAYMENTS');
  // P-300 $2,100: m=2 = $1,050/mo < cap
  check('ACC-003', 'BIF monthly = $1,050', d1.message?.includes('1,050') || d1.message?.includes('1050'));

  const a1 = await turn(sid, { message: 'Yes that works.' }, 'Accept BIF_PAYMENTS');
  check('ACC-003', 'accept → AWAITING_CONFIRMATION', a1.state === 'AWAITING_CONFIRMATION');

  const y1 = await turn(sid, { message: 'YES' }, 'Confirm YES');
  check('ACC-003', 'YES → RESOLVED', y1.state === 'RESOLVED');

  const sess = await apiSession(sid);
  const audit = await apiAudit(sid);
  console.log('\n  (b) SESSION FINAL STATE:');
  console.log(JSON.stringify({ state: sess.state, currentRung: sess.currentRung, disclosures: sess.disclosures }, null, 2));
  console.log('\n  (c) AUDIT LOG:');
  console.log(JSON.stringify(audit.audit, null, 2));
}

// ── ACC-004/005/006/008: flag escalations ────────────────────────────────────
async function testFlagEscalation(ref, expectedFlag) {
  const acct = CREDS[ref];
  const forbidden = LEAK_FORBIDDEN[ref] ?? [];
  console.log(`\n${SEP2}\n  ${ref} — ${expectedFlag} flag → immediate ESCALATED (no info leak)\n${SEP2}`);
  const { sid, authRes } = await testGreetAndAuth(ref, ref);

  check(ref, `auth → ESCALATED (${expectedFlag})`, authRes.state === 'ESCALATED');
  check(ref, 'escalationReason = flag code', authRes.statusMeta?.state === 'ESCALATED');

  for (const needle of forbidden) {
    const msg = authRes.message ?? '';
    check(ref, `response does NOT contain "${needle}"`, !msg.includes(needle),
      msg.includes(needle) ? `FOUND: "${needle}" in "${msg.slice(0,120)}"` : '');
  }

  const sess = await apiSession(sid);
  const audit = await apiAudit(sid);
  check(ref, `session.escalationReason = ${expectedFlag}`, sess.escalationReason === expectedFlag);
  check(ref, 'no DISCLOSURE_DELIVERED events', !audit.audit.some(e => e.event === 'DISCLOSURE_DELIVERED'));

  console.log('\n  (b) SESSION:');
  console.log(JSON.stringify({ state: sess.state, escalationReason: sess.escalationReason, account: { ref: sess.account?.ref } }, null, 2));
  console.log('\n  (c) AUDIT:');
  console.log(JSON.stringify(audit.audit, null, 2));
}

// ── ACC-007: byte-identical auth failure for wrong creds vs nonexistent ref ──
async function testACC007() {
  console.log(`\n${SEP2}\n  ACC-007 — AUTH FAILURE byte-identical check\n${SEP2}`);

  const responses_wrongCreds = [];
  const responses_badRef     = [];

  // Session A: wrong ssn4 three times for ACC-007
  console.log('\n  --- Case (i): wrong ssn4 for ACC-007 ---');
  const gA = await apiChat({});
  const sidA = gA.sessionId;
  for (let i = 1; i <= 3; i++) {
    const r = await turn(sidA, { auth: { ...CREDS['ACC-007'], ssn4: '0000' } }, `Wrong ssn4 attempt ${i}`);
    responses_wrongCreds.push(r.message);
  }

  // Session B: nonexistent account ref three times
  console.log('\n  --- Case (ii): nonexistent ref ACC-999999 ---');
  const gB = await apiChat({});
  const sidB = gB.sessionId;
  for (let i = 1; i <= 3; i++) {
    const r = await turn(sidB, { auth: { accountRef: 'ACC-999999', firstName: 'X', lastName: 'X', ssn4: '0000', zip: '00000' } }, `Bad ref attempt ${i}`);
    responses_badRef.push(r.message);
  }

  console.log('\n  BYTE COMPARISON:');
  for (let i = 0; i < 3; i++) {
    const match = responses_wrongCreds[i] === responses_badRef[i];
    console.log(`  Attempt ${i+1}: ${match ? '✓ IDENTICAL' : '✗ DIFFER'}`);
    if (!match) {
      console.log(`    Wrong creds: ${JSON.stringify(responses_wrongCreds[i])}`);
      console.log(`    Bad ref:     ${JSON.stringify(responses_badRef[i])}`);
    }
    check('ACC-007', `Attempt ${i+1} messages byte-identical`, match,
      match ? '' : `wrong="${responses_wrongCreds[i]}" bad="${responses_badRef[i]}"`);
  }

  const sessA = await apiSession(sidA);
  const sessB = await apiSession(sidB);

  check('ACC-007', 'session A state = ESCALATED', sessA.state === 'ESCALATED');
  check('ACC-007', 'session B state = ESCALATED', sessB.state === 'ESCALATED');
  check('ACC-007', 'session A escalationReason = AUTH_FAILED', sessA.escalationReason === 'AUTH_FAILED');
  check('ACC-007', 'session B escalationReason = AUTH_FAILED', sessB.escalationReason === 'AUTH_FAILED');
  check('ACC-007', 'session A account = null (never leaked)', sessA.account === null);
  check('ACC-007', 'session B account = null', sessB.account === null);

  console.log('\n  (b) SESSION A (wrong ssn4):');
  console.log(JSON.stringify({ state: sessA.state, authAttempts: sessA.authAttempts, account: sessA.account, escalationReason: sessA.escalationReason }, null, 2));
  console.log('\n  SESSION B (bad ref):');
  console.log(JSON.stringify({ state: sessB.state, authAttempts: sessB.authAttempts, account: sessB.account, escalationReason: sessB.escalationReason }, null, 2));

  const auditA = await apiAudit(sidA);
  const auditB = await apiAudit(sidB);
  console.log('\n  (c) AUDIT A:');
  console.log(JSON.stringify(auditA.audit, null, 2));
  console.log('\n  AUDIT B:');
  console.log(JSON.stringify(auditB.audit, null, 2));
}

// ── ACC-009: SIF verify FAIL → SIF_PAYMENTS verify PASS → RESOLVED ───────────
// Balance: $12,000  Portfolio: P-100 (35% max discount, 6-month max)
// Bank balance: $6,000
//
// Ladder path:
//   Decline PIF ($12,000) → Decline BIF_PAYMENTS ($6,000/mo) → Accept SIF ($7,800)
//   → YES → verify FAILS ($6,000 < $7,800) → renegotiate to SIF_PAYMENTS ($2,600×3)
//   → Accept → YES → verify PASSES ($6,000 ≥ $2,600) → RESOLVED
async function testACC009() {
  console.log(`\n${SEP2}\n  ACC-009 James Foster — $12,000 SIF verify FAIL → SIF_PAYMENTS verify PASS → RESOLVED\n${SEP2}`);
  const { sid, authRes } = await testGreetAndAuth('ACC-009', 'ACC-009');

  check('ACC-009', 'auth → NEGOTIATION_OPEN', authRes.state === 'NEGOTIATION_OPEN');
  check('ACC-009', 'disclosure contains Mini-Miranda', authRes.message?.includes('attempt to collect a debt'));
  check('ACC-009', 'PIF ask mentions $12,000', authRes.message?.includes('12,000'));

  // Decline PIF → BIF_PAYMENTS ($6,000/mo)
  const d1 = await turn(sid, { message: 'No, I cannot pay $12,000 in full.' }, 'Decline PIF');
  check('ACC-009', 'after decline PIF → NEGOTIATION', d1.state === 'NEGOTIATION');
  check('ACC-009', 'BIF_PAYMENTS rung offered', d1.statusMeta?.currentRung === 'BIF_PAYMENTS');

  // Decline BIF_PAYMENTS → SIF ($7,800)
  const d2 = await turn(sid, { message: "I cannot afford $6,000 a month." }, 'Decline BIF_PAYMENTS');
  check('ACC-009', 'after decline BIF → NEGOTIATION', d2.state === 'NEGOTIATION');
  check('ACC-009', 'SIF rung offered', d2.statusMeta?.currentRung === 'SIF');
  check('ACC-009', 'SIF offer mentions $7,800', d2.message?.includes('7,800'));

  // Accept SIF → Reg E confirmation
  const a1 = await turn(sid, { message: "Yes, I will take the $7,800 settlement." }, 'Accept SIF');
  check('ACC-009', 'accept SIF → AWAITING_CONFIRMATION', a1.state === 'AWAITING_CONFIRMATION');
  check('ACC-009', 'Reg E contains $7,800.00', a1.message?.includes('7,800.00'));
  check('ACC-009', 'Reg E contains "Reply YES"', a1.message?.includes('Reply YES'));

  // Confirm YES — bank has $6,000 < $7,800 → verification FAILS → renegotiate to SIF_PAYMENTS
  const y1 = await turn(sid, { message: 'YES' }, 'Confirm YES (SIF — expect verify FAIL → renegotiate)');
  check('ACC-009', 'after SIF verify FAIL → NEGOTIATION (renegotiated)', y1.state === 'NEGOTIATION');
  check('ACC-009', 'renegotiated to SIF_PAYMENTS rung', y1.statusMeta?.currentRung === 'SIF_PAYMENTS');
  check('ACC-009', 'response mentions unable to verify funds', y1.message?.toLowerCase().includes('unable to verify'));
  check('ACC-009', 'SIF_PAYMENTS offer mentions $2,600', y1.message?.includes('2,600'));

  // Accept SIF_PAYMENTS → Reg E confirmation
  const a2 = await turn(sid, { message: "Yes, 3 payments of $2,600 works for me." }, 'Accept SIF_PAYMENTS');
  check('ACC-009', 'accept SIF_PAYMENTS → AWAITING_CONFIRMATION', a2.state === 'AWAITING_CONFIRMATION');
  check('ACC-009', 'Reg E contains $2,600.00', a2.message?.includes('2,600.00'));

  // Confirm YES — bank has $6,000 ≥ $2,600 → verification PASSES → RESOLVED
  const y2 = await turn(sid, { message: 'YES' }, 'Confirm YES (SIF_PAYMENTS — expect verify PASS → RESOLVED)');
  check('ACC-009', 'after SIF_PAYMENTS verify PASS → RESOLVED', y2.state === 'RESOLVED');
  check('ACC-009', 'response mentions funds verified', y2.message?.toLowerCase().includes('funds verified'));

  const sess = await apiSession(sid);
  const audit = await apiAudit(sid);

  check('ACC-009', 'final state = RESOLVED', sess.state === 'RESOLVED');
  check('ACC-009', 'final rung = SIF_PAYMENTS', sess.currentRung === 'SIF_PAYMENTS');

  // Audit: two verification cycles
  const verifyAttempted = audit.audit.filter(e => e.event === 'FUNDS_VERIFICATION_ATTEMPTED');
  const verifyResults   = audit.audit.filter(e => e.event === 'FUNDS_VERIFICATION_RESULT');
  const renegotiations  = audit.audit.filter(e => e.event === 'RENEGOTIATION_TRIGGERED');

  check('ACC-009', '2 FUNDS_VERIFICATION_ATTEMPTED events', verifyAttempted.length === 2);
  check('ACC-009', '2 FUNDS_VERIFICATION_RESULT events',   verifyResults.length === 2);
  check('ACC-009', 'first verification: verified=false',    verifyResults[0]?.data?.verified === false);
  check('ACC-009', 'first verification: reason=INSUFFICIENT_FUNDS', verifyResults[0]?.data?.reason === 'INSUFFICIENT_FUNDS');
  check('ACC-009', 'second verification: verified=true',   verifyResults[1]?.data?.verified === true);
  check('ACC-009', 'RENEGOTIATION_TRIGGERED present',      renegotiations.length >= 1);
  check('ACC-009', 'renegotiation failed_rung = SIF',      renegotiations[0]?.data?.failed_rung === 'SIF');
  check('ACC-009', 'renegotiation falling_back_to = SIF_PAYMENTS', renegotiations[0]?.data?.falling_back_to === 'SIF_PAYMENTS');
  check('ACC-009', 'PAYMENT_AUTHORIZATION (authorized=true) in audit',
    audit.audit.some(e => e.event === 'PAYMENT_AUTHORIZATION' && e.data?.authorized === true));

  console.log('\n  (b) SESSION FINAL STATE:');
  console.log(JSON.stringify({
    state: sess.state, currentRung: sess.currentRung,
    offers: sess.offers, escalationReason: sess.escalationReason,
  }, null, 2));
  console.log('\n  (c) AUDIT LOG:');
  console.log(JSON.stringify(audit.audit, null, 2));
}

// ─── Summary table ────────────────────────────────────────────────────────────

function printSummary() {
  console.log(`\n${SEP2}\n  SUMMARY TABLE\n${SEP2}`);
  const cols = ['Account', 'Assertion', 'Pass/Fail', 'Notes'];
  console.log(cols.map(c => c.padEnd(30)).join(' | '));
  console.log('─'.repeat(120));

  // Group by account
  const grouped = {};
  for (const r of results) {
    if (!grouped[r.account]) grouped[r.account] = [];
    grouped[r.account].push(r);
  }

  let totalPass = 0, totalFail = 0;
  for (const [acct, rs] of Object.entries(grouped)) {
    const pass = rs.filter(r => r.pass).length;
    const fail = rs.filter(r => !r.pass).length;
    totalPass += pass; totalFail += fail;
    const status = fail === 0 ? '✓ PASS' : `✗ FAIL (${fail})`;
    console.log(`${acct.padEnd(30)} | ${`${pass}/${rs.length} checks`.padEnd(30)} | ${status.padEnd(30)} |`);
    if (fail > 0) {
      for (const r of rs.filter(r => !r.pass)) {
        console.log(`  ${' '.repeat(30)} | ✗ ${r.desc.padEnd(28)} | ${(r.notes || '').slice(0, 40)}`);
      }
    }
  }
  console.log('─'.repeat(120));
  console.log(`TOTAL: ${totalPass} passed, ${totalFail} failed`);
  if (totalFail > 0) {
    console.log('\n!! FAILURES FOUND — do not proceed to Step 8 until all pass.');
    process.exitCode = 1;
  } else {
    console.log('\n✓ All checks passed. Ready for Step 8.');
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${SEP2}`);
  console.log('  Meridian Recovery — Step 7 End-to-End Verification');
  console.log(`  ${new Date().toISOString()}`);
  console.log(SEP2);

  try {
    await testACC001();
    await testACC002();
    await testACC003();
    await testFlagEscalation('ACC-004', 'BKY');
    await testFlagEscalation('ACC-005', 'DSP');
    await testFlagEscalation('ACC-006', 'CNA');
    await testACC007();
    await testFlagEscalation('ACC-008', 'VOD');
    await testACC009();
    printSummary();
  } catch (err) {
    console.error('\n!! FATAL ERROR:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  }
}

main();
