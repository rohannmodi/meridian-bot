// All limit calculations from PORTFOLIOS.md.
// Dollar amounts always come from account/portfolio objects — never hardcoded
// in prompt strings. The only magic number here is the $1,500 self-service cap.

export const SELF_SERVICE_PAYMENT_CAP = 1500;
export const NO_PROFILE_MAX_MONTHS = 6;          // PORTFOLIOS.md §Plan length rules
export const MAX_SIF_INSTALLMENTS = 3;            // PORTFOLIOS.md §Settlement rules

/**
 * Round a number to cents (2 decimal places).
 */
function roundCents(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Calculate a settlement offer.
 * @param {object} account     – must have .balance
 * @param {object} portfolio   – must have .maxDiscount
 * @param {number} discountFraction  – e.g. 0.40 for 40%
 * @returns {{ amount, discount, withinLimit, portfolioMax }}
 */
export function calculateSettlement(account, portfolio, discountFraction) {
  const withinLimit = discountFraction <= portfolio.maxDiscount;
  const amount = roundCents(account.balance * (1 - discountFraction));
  return {
    amount,
    discount: discountFraction,
    withinLimit,
    portfolioMax: portfolio.maxDiscount,
  };
}

/**
 * Calculate a payment plan (full balance, no discount).
 * @param {object} account
 * @param {object} portfolio
 * @param {number} months
 * @param {boolean} hasFinancialProfile
 * @returns {{ monthlyPayment, totalPayment, months, withinLimit, exceedsCap }}
 */
export function calculatePlan(account, portfolio, months, hasFinancialProfile = false) {
  const effectiveMax = hasFinancialProfile
    ? portfolio.maxMonths
    : NO_PROFILE_MAX_MONTHS;

  const withinLimit = months <= effectiveMax && months >= 1;
  const monthlyPayment = roundCents(account.balance / months);
  const totalPayment = roundCents(monthlyPayment * months);
  const exceedsCap = monthlyPayment > SELF_SERVICE_PAYMENT_CAP;

  return {
    monthlyPayment,
    totalPayment,
    months,
    withinLimit,
    exceedsCap,
    effectiveMaxMonths: effectiveMax,
  };
}

/**
 * Calculate SIF split into installments (≤ 3).
 * @param {number} settlementAmount  – already-calculated settlement total
 * @param {number} installments      – 1, 2, or 3
 * @returns {{ installmentAmount, totalPayment, installments, valid, exceedsCap }}
 */
export function calculateSifInstallments(settlementAmount, installments) {
  const valid = Number.isInteger(installments) && installments >= 1 && installments <= MAX_SIF_INSTALLMENTS;
  if (!valid) {
    return { installmentAmount: null, totalPayment: null, installments, valid: false, exceedsCap: false };
  }
  const installmentAmount = roundCents(settlementAmount / installments);
  const totalPayment = roundCents(installmentAmount * installments);
  const exceedsCap = installmentAmount > SELF_SERVICE_PAYMENT_CAP;
  return { installmentAmount, totalPayment, installments, valid: true, exceedsCap };
}

/**
 * Build the full resolution ladder for an account.
 * Returns every rung annotated with whether it's self-serviceable
 * (i.e., no single payment exceeds the $1,500 cap).
 *
 * Ladder order (PORTFOLIOS.md):
 *   PIF → BIF_payments → SIF → SIF_payments → PPA
 *
 * @param {object} account
 * @param {object} portfolio
 * @param {boolean} hasFinancialProfile
 * @returns {Array<{ rung, ...details, selfServiceable }>}
 */
export function getValidArrangements(account, portfolio, hasFinancialProfile = false) {
  const { balance } = account;
  const ladder = [];

  // 1. PIF — paid in full, single payment
  ladder.push({
    rung: 'PIF',
    amount: balance,
    exceedsCap: balance > SELF_SERVICE_PAYMENT_CAP,
    selfServiceable: balance <= SELF_SERVICE_PAYMENT_CAP,
  });

  // 2. BIF_payments — full balance split into 2–4 payments over plan period
  //    Use shortest valid plan that keeps installments ≤ cap
  const bifPlan = calculatePlan(account, portfolio, 2, hasFinancialProfile);
  ladder.push({
    rung: 'BIF_payments',
    ...bifPlan,
    selfServiceable: bifPlan.withinLimit && !bifPlan.exceedsCap,
  });

  // 3. SIF — max discount, lump sum
  const sif = calculateSettlement(account, portfolio, portfolio.maxDiscount);
  ladder.push({
    rung: 'SIF',
    ...sif,
    exceedsCap: sif.amount > SELF_SERVICE_PAYMENT_CAP,
    selfServiceable: sif.withinLimit && sif.amount <= SELF_SERVICE_PAYMENT_CAP,
  });

  // 4. SIF_payments — max discount, split into 3 installments
  const sifInstall = calculateSifInstallments(sif.amount, MAX_SIF_INSTALLMENTS);
  ladder.push({
    rung: 'SIF_payments',
    settlementAmount: sif.amount,
    ...sifInstall,
    selfServiceable: sifInstall.valid && !sifInstall.exceedsCap,
  });

  // 5. PPA — temporary payment plan, re-evaluate; use 6-month max (no profile)
  const ppa = calculatePlan(account, portfolio, NO_PROFILE_MAX_MONTHS, hasFinancialProfile);
  ladder.push({
    rung: 'PPA',
    ...ppa,
    selfServiceable: ppa.withinLimit && !ppa.exceedsCap,
  });

  return ladder;
}
