import { checkFlags, checkRegion, needsPreLegalDisclosure } from '../src/server/flags.js';

describe('checkFlags()', () => {
  test('BKY flag → escalate with reason BKY', () => {
    const r = checkFlags({ flags: ['BKY'] });
    expect(r.escalate).toBe(true);
    expect(r.reason).toBe('BKY');
  });

  test('DSP flag → escalate', () => {
    expect(checkFlags({ flags: ['DSP'] }).escalate).toBe(true);
  });

  test('CNA flag → escalate', () => {
    expect(checkFlags({ flags: ['CNA'] }).escalate).toBe(true);
  });

  test('VOD flag → escalate', () => {
    expect(checkFlags({ flags: ['VOD'] }).escalate).toBe(true);
  });

  test('FRA flag → escalate', () => {
    expect(checkFlags({ flags: ['FRA'] }).escalate).toBe(true);
  });

  test('MIL flag → escalate', () => {
    expect(checkFlags({ flags: ['MIL'] }).escalate).toBe(true);
  });

  test('LIT flag → escalate', () => {
    expect(checkFlags({ flags: ['LIT'] }).escalate).toBe(true);
  });

  test('PRE_LEGAL only → no escalation', () => {
    const r = checkFlags({ flags: ['PRE_LEGAL'] });
    expect(r.escalate).toBe(false);
    expect(r.reason).toBeNull();
  });

  test('no flags → no escalation', () => {
    const r = checkFlags({ flags: [] });
    expect(r.escalate).toBe(false);
  });

  test('multiple flags → escalates on first escalation flag', () => {
    const r = checkFlags({ flags: ['PRE_LEGAL', 'BKY', 'DSP'] });
    expect(r.escalate).toBe(true);
    // BKY is the first escalation flag (PRE_LEGAL is skipped)
    expect(r.reason).toBe('BKY');
  });
});

describe('checkRegion()', () => {
  test('PR → REGION_NOT_SERVICED', () => {
    const r = checkRegion({ state: 'PR' });
    expect(r.escalate).toBe(true);
    expect(r.reason).toBe('REGION_NOT_SERVICED');
  });

  test('GU → REGION_NOT_SERVICED', () => {
    expect(checkRegion({ state: 'GU' }).escalate).toBe(true);
  });

  test('VI → REGION_NOT_SERVICED', () => {
    expect(checkRegion({ state: 'VI' }).escalate).toBe(true);
  });

  test('NY → not blocked', () => {
    expect(checkRegion({ state: 'NY' }).escalate).toBe(false);
  });

  test('CA → not blocked', () => {
    expect(checkRegion({ state: 'CA' }).escalate).toBe(false);
  });

  test('TX → not blocked', () => {
    expect(checkRegion({ state: 'TX' }).escalate).toBe(false);
  });
});

describe('needsPreLegalDisclosure()', () => {
  test('P-300 with PRE_LEGAL flag → true', () => {
    expect(needsPreLegalDisclosure({ portfolioId: 'P-300', flags: ['PRE_LEGAL'] })).toBe(true);
  });

  test('P-300 with no flags → true (PRE_LEGAL not required for check)', () => {
    // Pre-legal disclosure is based on portfolioId, not on the flag
    expect(needsPreLegalDisclosure({ portfolioId: 'P-300', flags: [] })).toBe(true);
  });

  test('P-300 with BREACHED_ARRANGEMENT → suppressed (false)', () => {
    expect(needsPreLegalDisclosure({ portfolioId: 'P-300', flags: ['BREACHED_ARRANGEMENT'] })).toBe(false);
  });

  test('P-300 with NSF_RECENT → suppressed (false)', () => {
    expect(needsPreLegalDisclosure({ portfolioId: 'P-300', flags: ['NSF_RECENT'] })).toBe(false);
  });

  test('P-200 → false (not P-300)', () => {
    expect(needsPreLegalDisclosure({ portfolioId: 'P-200', flags: [] })).toBe(false);
  });

  test('P-100 → false', () => {
    expect(needsPreLegalDisclosure({ portfolioId: 'P-100', flags: [] })).toBe(false);
  });
});
