import {
  calculateSettlement,
  calculatePlan,
  calculateSifInstallments,
  getValidArrangements,
  SELF_SERVICE_PAYMENT_CAP,
  NO_PROFILE_MAX_MONTHS,
} from '../src/server/limits.js';
import { getPortfolio } from '../src/server/portfolios.js';

const P100 = getPortfolio('P-100'); // maxDiscount 35%, maxMonths 6
const P200 = getPortfolio('P-200'); // maxDiscount 50%, maxMonths 12
const P300 = getPortfolio('P-300'); // maxDiscount 25%, maxMonths 18

const acc001 = { balance: 4200 };   // Sarah Johnson, P-200
const acc002 = { balance: 8500 };   // Luis Martinez, P-100
const acc009 = { balance: 12000 };  // James Foster, P-100

describe('calculateSettlement()', () => {
  test('40% discount on P-200 → within limit', () => {
    const r = calculateSettlement(acc001, P200, 0.40);
    expect(r.withinLimit).toBe(true);
    expect(r.amount).toBe(2520.00);   // 4200 × 0.60
    expect(r.discount).toBe(0.40);
  });

  test('50% discount on P-200 (at max) → within limit', () => {
    const r = calculateSettlement(acc001, P200, 0.50);
    expect(r.withinLimit).toBe(true);
    expect(r.amount).toBe(2100.00);
  });

  test('51% discount on P-200 → exceeds limit', () => {
    const r = calculateSettlement(acc001, P200, 0.51);
    expect(r.withinLimit).toBe(false);
  });

  test('35% discount on P-100 (at max) → within limit', () => {
    const r = calculateSettlement(acc002, P100, 0.35);
    expect(r.withinLimit).toBe(true);
    expect(r.amount).toBe(5525.00);   // 8500 × 0.65
  });

  test('36% discount on P-100 → exceeds limit', () => {
    expect(calculateSettlement(acc002, P100, 0.36).withinLimit).toBe(false);
  });

  test('rounds amount to cents', () => {
    // $4200 × (1 - 0.33) = $2814.00 exactly — use an amount that produces cents
    const r = calculateSettlement({ balance: 100 }, P200, 0.33);
    expect(r.amount).toBe(67.00);
    const r2 = calculateSettlement({ balance: 101 }, P200, 0.33);
    // 101 × 0.67 = 67.67
    expect(r2.amount).toBe(67.67);
  });
});

describe('calculatePlan()', () => {
  test('2-month plan on P-200, no profile → within cap', () => {
    // $4200 / 2 = $2100/mo > $1,500 → exceedsCap
    const r = calculatePlan(acc001, P200, 2, false);
    expect(r.withinLimit).toBe(true);
    expect(r.monthlyPayment).toBe(2100.00);
    expect(r.exceedsCap).toBe(true);
  });

  test('4-month plan on P-200, no profile → within limit', () => {
    // $4200 / 4 = $1050 ≤ $1500 → ok
    const r = calculatePlan(acc001, P200, 4, false);
    expect(r.withinLimit).toBe(true);
    expect(r.exceedsCap).toBe(false);
    expect(r.monthlyPayment).toBe(1050.00);
  });

  test('7-month plan without financial profile → exceeds month cap', () => {
    const r = calculatePlan(acc001, P200, 7, false);
    expect(r.withinLimit).toBe(false);
  });

  test('7-month plan with financial profile on P-200 (max 12) → within limit', () => {
    const r = calculatePlan(acc001, P200, 7, true);
    expect(r.withinLimit).toBe(true);
  });

  test('ACC-009: $12k / 6 months = $2,000/mo → exceedsCap', () => {
    const r = calculatePlan(acc009, P100, 6, false);
    expect(r.monthlyPayment).toBe(2000.00);
    expect(r.exceedsCap).toBe(true);
  });

  test('plan of 0 months → invalid', () => {
    expect(calculatePlan(acc001, P200, 0).withinLimit).toBe(false);
  });
});

describe('calculateSifInstallments()', () => {
  test('$3,000 SIF / 3 installments = $1,000 each, no cap exceeded', () => {
    const r = calculateSifInstallments(3000, 3);
    expect(r.valid).toBe(true);
    expect(r.installmentAmount).toBe(1000.00);
    expect(r.exceedsCap).toBe(false);
  });

  test('$6,000 SIF / 3 installments = $2,000 each → exceedsCap', () => {
    const r = calculateSifInstallments(6000, 3);
    expect(r.exceedsCap).toBe(true);
  });

  test('4 installments → invalid (> 3 max)', () => {
    const r = calculateSifInstallments(3000, 4);
    expect(r.valid).toBe(false);
  });

  test('0 installments → invalid', () => {
    expect(calculateSifInstallments(3000, 0).valid).toBe(false);
  });

  test('1 installment (lump sum) → valid', () => {
    const r = calculateSifInstallments(1000, 1);
    expect(r.valid).toBe(true);
    expect(r.installmentAmount).toBe(1000.00);
  });
});

describe('getValidArrangements()', () => {
  test('ACC-009 ($12k, P-100): no self-serviceable arrangement exists', () => {
    const ladder = getValidArrangements(
      { balance: 12000 },
      P100,
      false
    );
    // Every rung should have selfServiceable: false because payments exceed $1,500
    const selfServiceable = ladder.filter(r => r.selfServiceable);
    expect(selfServiceable).toHaveLength(0);
  });

  test('ACC-001 ($4,200, P-200): SIF at 50% = $2,100 lump → exceedsCap', () => {
    const ladder = getValidArrangements({ balance: 4200 }, P200, false);
    const sif = ladder.find(r => r.rung === 'SIF');
    // $2,100 > $1,500 → not self-serviceable as lump
    expect(sif.exceedsCap).toBe(true);
  });

  test('ACC-001: SIF_payments ($2,100 / 3 = $700) → self-serviceable', () => {
    const ladder = getValidArrangements({ balance: 4200 }, P200, false);
    const sifP = ladder.find(r => r.rung === 'SIF_payments');
    expect(sifP.selfServiceable).toBe(true);
    expect(sifP.installmentAmount).toBe(700.00);
  });
});

describe('constants', () => {
  test('SELF_SERVICE_PAYMENT_CAP is 1500', () => {
    expect(SELF_SERVICE_PAYMENT_CAP).toBe(1500);
  });

  test('NO_PROFILE_MAX_MONTHS is 6', () => {
    expect(NO_PROFILE_MAX_MONTHS).toBe(6);
  });
});
