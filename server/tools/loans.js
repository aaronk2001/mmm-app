// Loan calculators — pure math, no I/O. Rates are PERCENTS on the public API
// (7 means 7%); calcMonthlyPayment takes a fraction. Dollars in, dollars out.

/**
 * @param {number} principal
 * @param {number} annualRate  fraction, e.g. 0.07
 * @param {number} termMonths
 * @returns {number} level monthly payment
 */
function calcMonthlyPayment(principal, annualRate, termMonths) {
  if (principal <= 0 || termMonths <= 0) return 0;
  if (annualRate === 0) return principal / termMonths;
  const r = annualRate / 12;
  return principal * (r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
}

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} params
 * @param {number} params.purchase_price
 * @param {number} [params.down_payment_pct=20]  percent, e.g. 20 means 20%
 * @param {number} params.annual_rate  percent, e.g. 7 means 7%
 * @param {number} [params.term_years=30]
 * @returns {{monthly_payment: number, monthly_pi: number, pmi_estimate: number|null, loan_amount: number, down_payment: number, total_cost: number, total_interest: number, amortization: Array<{year: number, principal_paid: number, interest_paid: number, balance: number}>}}
 */
function calcMortgage({ purchase_price, down_payment_pct = 20, annual_rate, term_years = 30 }) {
  const dp       = Math.max(0, Math.min(100, Number(down_payment_pct)));
  const rate     = Math.max(0, Number(annual_rate)) / 100;
  const downPmt  = purchase_price * (dp / 100);
  const principal = Math.max(0, purchase_price - downPmt);
  const termMonths = term_years * 12;
  const monthly   = calcMonthlyPayment(principal, rate, termMonths);
  const pmi       = dp < 20 ? r2((principal * 0.007) / 12) : 0;

  // Yearly amortization summary
  const amortization = [];
  let balance = principal;
  const mr = rate / 12;
  let yrPrincipal = 0, yrInterest = 0;
  for (let m = 1; m <= termMonths; m++) {
    const intPmt  = balance * mr;
    const priPmt  = Math.min(monthly - intPmt, balance);
    balance       = Math.max(0, balance - priPmt);
    yrPrincipal  += priPmt;
    yrInterest   += intPmt;
    if (m % 12 === 0 || m === termMonths) {
      amortization.push({
        year:           Math.ceil(m / 12),
        principal_paid: Math.round(yrPrincipal),
        interest_paid:  Math.round(yrInterest),
        balance:        Math.round(balance),
      });
      yrPrincipal = 0; yrInterest = 0;
    }
  }

  return {
    monthly_payment:  r2(monthly + pmi),   // what components expect
    monthly_pi:       r2(monthly),
    pmi_estimate:     pmi || null,
    loan_amount:      Math.round(principal),
    down_payment:     Math.round(downPmt),
    total_cost:       Math.round(monthly * termMonths + downPmt),
    total_interest:   Math.round(monthly * termMonths - principal),
    amortization,
  };
}

/**
 * @param {object} params
 * @param {number} params.vehicle_price
 * @param {number} [params.down_payment=0]
 * @param {number} [params.trade_in=0]
 * @param {number} params.annual_rate  percent, e.g. 6 means 6%
 * @param {number} [params.term_months=60]
 * @returns {{monthly_payment: number, loan_amount: number, total_interest: number, total_cost: number}}
 */
function calcAutoLoan({ vehicle_price, down_payment = 0, trade_in = 0, annual_rate, term_months = 60 }) {
  const principal = Math.max(0, vehicle_price - down_payment - trade_in);
  const rate      = Math.max(0, Number(annual_rate)) / 100;
  const monthly   = calcMonthlyPayment(principal, rate, term_months);
  return {
    monthly_payment: r2(monthly),
    loan_amount:     Math.round(principal),
    total_interest:  Math.round(r2(monthly * term_months - principal)),
    total_cost:      Math.round(monthly * term_months + down_payment + trade_in),
  };
}

/**
 * @param {object} params
 * @param {number} params.current_rate  percent
 * @param {number} params.new_rate  percent
 * @param {number} params.balance
 * @param {number} params.years_remaining
 * @param {number} params.closing_costs
 * @returns {{current_monthly_payment: number, new_monthly_payment: number, monthly_savings: number, breakeven_months: number|null, breakeven_years?: number, total_savings: number|null, verdict: string}}
 */
function calcRefiBreakeven({ current_rate, new_rate, balance, years_remaining, closing_costs }) {
  // Clamp negatives like calcMortgage/calcAutoLoan do — an unclamped negative
  // rate produces a nonsense payment instead of the 0%-rate straight-line path.
  const curRate = Math.max(0, Number(current_rate)) / 100;
  const newRate = Math.max(0, Number(new_rate)) / 100;
  const currentMonthly = calcMonthlyPayment(balance, curRate, years_remaining * 12);
  const newMonthly     = calcMonthlyPayment(balance, newRate, years_remaining * 12);
  const monthlySavings = currentMonthly - newMonthly;

  if (monthlySavings <= 0) {
    return {
      current_monthly_payment: r2(currentMonthly),
      new_monthly_payment:     r2(newMonthly),
      monthly_savings:         r2(monthlySavings),
      breakeven_months:        null,
      total_savings:           null,
      verdict: 'No benefit — new rate is not lower than current rate',
    };
  }

  const breakeven_months = Math.ceil(closing_costs / monthlySavings);
  return {
    current_monthly_payment: r2(currentMonthly),
    new_monthly_payment:     r2(newMonthly),
    monthly_savings:         r2(monthlySavings),
    breakeven_months,
    breakeven_years:         r2(breakeven_months / 12),
    total_savings:           r2(monthlySavings * years_remaining * 12 - closing_costs),
    verdict: breakeven_months <= 24 ? 'STRONG YES — breaks even in under 2 years'
           : breakeven_months <= 48 ? 'YES — breaks even in under 4 years'
           : 'CONSIDER — long breakeven, only if you plan to stay',
  };
}

/**
 * @param {object} params
 * @param {number} params.monthly_debts
 * @param {number} params.gross_monthly_income
 * @returns {{dti: number, mortgage_readiness: string, max_mortgage_payment: number, notes: string[]}|{error: string}}
 */
function calcDti({ monthly_debts, gross_monthly_income }) {
  if (!gross_monthly_income || gross_monthly_income <= 0) {
    return { error: 'gross_monthly_income must be greater than 0' };
  }
  const dti = (monthly_debts / gross_monthly_income) * 100;
  const maxDebtAt43 = gross_monthly_income * 0.43;
  const max_mortgage_payment = Math.max(0, Math.round(maxDebtAt43 - monthly_debts));

  const mortgage_readiness = dti < 20 ? 'excellent' : dti < 36 ? 'good' : dti < 43 ? 'fair' : 'poor';

  const notes = [];
  if      (dti < 20) notes.push('Excellent DTI — you qualify for the best mortgage rates available.');
  else if (dti < 36) notes.push('Good DTI — qualifies for most conventional loan products.');
  else if (dti < 43) notes.push('Fair DTI — may qualify for FHA loans; expect higher rates.');
  else               notes.push('High DTI — most lenders will decline. Reduce debt before applying.');
  if (max_mortgage_payment > 0)
    notes.push(`At the 43% DTI limit, you can support up to $${max_mortgage_payment.toLocaleString()}/mo in new debt (e.g. mortgage P&I).`);

  return { dti: r2(dti), mortgage_readiness, max_mortgage_payment, notes };
}

module.exports = { calcMonthlyPayment, calcMortgage, calcAutoLoan, calcRefiBreakeven, calcDti };
