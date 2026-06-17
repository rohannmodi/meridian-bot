import { authenticate } from '../src/server/auth.js';

describe('authenticate()', () => {
  const valid = {
    ref: 'ACC-001',
    firstName: 'Sarah',
    lastName: 'Johnson',
    ssn4: '4321',
    zip: '10001',
  };

  test('correct credentials → ok: true with account', () => {
    const result = authenticate(valid);
    expect(result.ok).toBe(true);
    expect(result.account).not.toBeNull();
    expect(result.account.ref).toBe('ACC-001');
  });

  test('wrong SSN4 → ok: false', () => {
    expect(authenticate({ ...valid, ssn4: '9999' }).ok).toBe(false);
  });

  test('wrong ZIP → ok: false', () => {
    expect(authenticate({ ...valid, zip: '00000' }).ok).toBe(false);
  });

  test('wrong lastName → ok: false', () => {
    expect(authenticate({ ...valid, lastName: 'Smith' }).ok).toBe(false);
  });

  test('case-insensitive firstName match', () => {
    expect(authenticate({ ...valid, firstName: 'SARAH' }).ok).toBe(true);
  });

  test('case-insensitive lastName match', () => {
    expect(authenticate({ ...valid, lastName: 'johnson' }).ok).toBe(true);
  });

  test('trims whitespace from all fields', () => {
    expect(authenticate({
      ref: '  ACC-001  ',
      firstName: ' Sarah ',
      lastName: ' Johnson ',
      ssn4: ' 4321 ',
      zip: ' 10001 ',
    }).ok).toBe(true);
  });

  test('non-existent account ref → ok: false', () => {
    expect(authenticate({ ...valid, ref: 'ACC-999' }).ok).toBe(false);
  });

  test('ACC-007 correct credentials → ok: true', () => {
    const result = authenticate({
      ref: 'ACC-007',
      firstName: 'Maria',
      lastName: 'Garcia',
      ssn4: '7777',
      zip: '75201',
    });
    expect(result.ok).toBe(true);
    expect(result.account.ref).toBe('ACC-007');
  });
});
