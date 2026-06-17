import {
  validateDollarAmounts,
  validatePercentages,
  checkPaymentCap,
  gateIntent,
  detectVerbatimDisclosures,
  validateResponse,
} from '../src/server/guardrails.js';
import { getPortfolio } from '../src/server/portfolios.js';

const P200 = getPortfolio('P-200'); // maxDiscount 50%
const P100 = getPortfolio('P-100'); // maxDiscount 35%

const acc001 = { balance: 4200 };  // P-200
const acc002 = { balance: 8500 };  // P-100

describe('validateDollarAmounts()', () => {
  test('account balance is always valid', () => {
    const r = validateDollarAmounts('Your balance is $4,200.00', acc001, P200);
    expect(r.valid).toBe(true);
  });

  test('valid 50% settlement is valid', () => {
    // $4200 × 0.50 = $2,100
    const r = validateDollarAmounts('We can settle for $2,100.00 today.', acc001, P200);
    expect(r.valid).toBe(true);
  });

  test('invented amount → invalid', () => {
    const r = validateDollarAmounts('How about $999.99?', acc001, P200);
    expect(r.valid).toBe(false);
    expect(r.violations.length).toBeGreaterThan(0);
  });

  test('no dollar amounts in text → valid', () => {
    const r = validateDollarAmounts('Let me look into that for you.', acc001, P200);
    expect(r.valid).toBe(true);
  });

  test('valid monthly payment is valid ($4200/4 = $1050)', () => {
    const r = validateDollarAmounts('That would be $1,050.00 per month.', acc001, P200);
    expect(r.valid).toBe(true);
  });
});

describe('validatePercentages()', () => {
  test('50% on P-200 (at max) → valid', () => {
    expect(validatePercentages('50% settlement', P200).valid).toBe(true);
  });

  test('49% on P-200 → valid', () => {
    expect(validatePercentages('a 49% discount', P200).valid).toBe(true);
  });

  test('51% on P-200 → invalid', () => {
    const r = validatePercentages('51% off your balance', P200);
    expect(r.valid).toBe(false);
    expect(r.violations.length).toBeGreaterThan(0);
  });

  test('35% on P-100 (at max) → valid', () => {
    expect(validatePercentages('35% reduction', P100).valid).toBe(true);
  });

  test('36% on P-100 → invalid', () => {
    expect(validatePercentages('36% off', P100).valid).toBe(false);
  });

  test('no percentages in text → valid', () => {
    expect(validatePercentages('Let me help you today.', P100).valid).toBe(true);
  });
});

describe('checkPaymentCap()', () => {
  test('$1,500 → not exceeded (at limit)', () => {
    const r = checkPaymentCap('Payment of $1,500.00');
    expect(r.exceeds).toBe(false);
  });

  test('$1,501 → exceeds cap', () => {
    const r = checkPaymentCap('Payment of $1,501.00');
    expect(r.exceeds).toBe(true);
    expect(r.amounts).toContain(1501);
  });

  test('$999 → not exceeded', () => {
    expect(checkPaymentCap('$999.00 today').exceeds).toBe(false);
  });

  test('$2,000 → exceeds', () => {
    expect(checkPaymentCap('$2,000.00 per month').exceeds).toBe(true);
  });

  test('no amounts → not exceeded', () => {
    expect(checkPaymentCap('sounds good').exceeds).toBe(false);
  });
});

describe('gateIntent()', () => {
  test('PAY_FULL allowed in NEGOTIATION', () => {
    expect(gateIntent('PAY_FULL', 'NEGOTIATION').allowed).toBe(true);
  });

  test('CONFIRM_YES allowed in AWAITING_CONFIRMATION', () => {
    expect(gateIntent('CONFIRM_YES', 'AWAITING_CONFIRMATION').allowed).toBe(true);
  });

  test('CONFIRM_YES not allowed in NEGOTIATION → deflect', () => {
    const r = gateIntent('CONFIRM_YES', 'NEGOTIATION');
    expect(r.allowed).toBe(false);
    expect(r.deflect).toBeTruthy();
  });

  test('REQUEST_HUMAN allowed in any negotiation state', () => {
    expect(gateIntent('REQUEST_HUMAN', 'NEGOTIATION').allowed).toBe(true);
    expect(gateIntent('REQUEST_HUMAN', 'NEGOTIATION_OPEN').allowed).toBe(true);
  });
});

describe('detectVerbatimDisclosures()', () => {
  test('Mini-Miranda in LLM output → detected', () => {
    const text = 'This is a communication from a debt collector. This is an attempt to collect a debt';
    const r = detectVerbatimDisclosures(text);
    expect(r.containsVerbatim).toBe(true);
    expect(r.which).toContain('MINI_MIRANDA');
  });

  test('normal negotiation text → not detected', () => {
    const r = detectVerbatimDisclosures('We can offer you a settlement of $2,100.');
    expect(r.containsVerbatim).toBe(false);
  });
});

describe('validateResponse() integration', () => {
  test('valid offer text with correct balance → pass', () => {
    const r = validateResponse(
      'Your current balance is $4,200.00. Are you able to pay this in full today?',
      acc001,
      P200,
      'NEGOTIATION_OPEN',
      { offered: {} }
    );
    expect(r.pass).toBe(true);
    expect(r.responseText).not.toBe('Let me recalculate that for you.');
  });

  test('hallucinated dollar amount → fail, fallback text', () => {
    const r = validateResponse(
      'I can offer you a special deal of $123.45 today.',
      acc001,
      P200,
      'NEGOTIATION',
      { offered: {} }
    );
    expect(r.pass).toBe(false);
    expect(r.responseText).toBe('Let me recalculate that for you.');
    expect(r.violations.length).toBeGreaterThan(0);
  });

  test('payment over $1,500 mentioned in any LLM state → not escalated by guardrail (cap enforced in code)', () => {
    // The cap is enforced in chat.js against offer.installmentAmount/monthlyPayment/amount,
    // not against LLM text (which legitimately mentions totals like "$2,100 across 3 payments").
    const states = ['NEGOTIATION', 'NEGOTIATION_OPEN', 'AWAITING_CONFIRMATION'];
    for (const s of states) {
      const r = validateResponse(
        'Your total settlement of $2,100 spread across 3 payments of $700 each.',
        { balance: 12000 },
        P100,
        s,
        { offered: {} }
      );
      expect(r.escalate).toBe(false);
    }
  });
});
