// Debt payoff simulation (calc.simulateDebtPayoff) and where its inputs come
// from (calc.debtsFromAccounts). The simulation used to live inline in the
// route with no tests, and dropped a paid-off debt's minimum after the month
// it hit zero — so neither avalanche nor snowball actually snowballed.
import { describe, it, expect } from 'vitest';
import calc from '../server/money/calc.js';

const { simulateDebtPayoff, debtsFromAccounts } = calc;

// The sample data's two debts, as /api/money/debt reports them.
const card = { account_id: 'c', name: 'Chase Sapphire', type: 'credit', balance: 2350.75, apr: 0.20, min_payment: 47.02 };
const auto = { account_id: 'a', name: 'Auto Loan', type: 'loan', balance: 18500, apr: 0.07, min_payment: 370 };

describe('simulateDebtPayoff', () => {
  it('rolls a paid-off debt\'s minimum into the next target (the sample data: 64 months, not 97)', () => {
    const out = simulateDebtPayoff([card, auto], { strategy: 'avalanche' });
    expect(out.paysOff).toBe(true);
    expect(out.monthsToFree).toBe(64);
    expect(out.totalInterest).toBe(5506);
    expect(out.payoff).toEqual([
      { account_id: 'c', name: 'Chase Sapphire', month: 64 },
      { account_id: 'a', name: 'Auto Loan', month: 60 },
    ]);
  });

  it('puts extra money on the target and keeps rolling it (extra $200: 39 months)', () => {
    const out = simulateDebtPayoff([card, auto], { strategy: 'avalanche', monthlyExtra: 200 });
    expect(out.monthsToFree).toBe(39);
    expect(out.totalInterest).toBe(2623);
    expect(out.payoff.find((p) => p.name === 'Chase Sapphire').month).toBe(11);
  });

  it('orders avalanche by APR and snowball by balance', () => {
    const small = { account_id: 's', name: 'Store card', type: 'credit', balance: 400, apr: 0.10, min_payment: 25 };
    const big = { account_id: 'b', name: 'Big card', type: 'credit', balance: 5000, apr: 0.29, min_payment: 100 };
    expect(simulateDebtPayoff([small, big], { strategy: 'avalanche' }).order).toEqual(['Big card', 'Store card']);
    expect(simulateDebtPayoff([small, big], { strategy: 'snowball' }).order).toEqual(['Store card', 'Big card']);
  });

  it('pays a 0% debt off in balance / payment months with no interest', () => {
    const out = simulateDebtPayoff([{ name: 'Family loan', balance: 1200, apr: 0, min_payment: 100 }]);
    expect(out).toMatchObject({ paysOff: true, monthsToFree: 12, totalInterest: 0 });
  });

  it('says so when minimum payments never cover the interest, instead of inventing a date', () => {
    const out = simulateDebtPayoff([{ name: 'Underwater', balance: 10000, apr: 0.30, min_payment: 200 }], { maxMonths: 120 });
    expect(out.paysOff).toBe(false);
    expect(out.monthsToFree).toBeNull();
    expect(out.payoff[0].month).toBeNull();
  });

  it('handles no debts', () => {
    expect(simulateDebtPayoff([])).toMatchObject({ monthsToFree: 0, paysOff: true, totalInterest: 0, order: [] });
  });
});

describe('debtsFromAccounts', () => {
  it('uses the APR and minimum payment stored on the account', () => {
    const [d] = debtsFromAccounts([{ id: 'c', name: 'Card', type: 'credit', balance: -1000, apr: 0.2499, min_payment: 35 }]);
    expect(d).toMatchObject({ balance: 1000, apr: 0.2499, apr_is_default: false, min_payment: 35, min_payment_is_default: false });
  });

  it('keeps a real 0% APR instead of replacing it with the default', () => {
    const [d] = debtsFromAccounts([{ id: 'c', name: 'Promo card', type: 'credit', balance: -1000, apr: 0, min_payment: 0 }]);
    expect(d).toMatchObject({ apr: 0, apr_is_default: false, min_payment: 0, min_payment_is_default: false });
  });

  it('labels defaults when nothing is on file, and ignores non-debt accounts', () => {
    const out = debtsFromAccounts([
      { id: 'c', name: 'Card', type: 'credit', balance: -2350.75 },
      { id: 'l', name: 'Loan', type: 'loan', balance: -18500, apr: null },
      { id: 'k', name: 'Checking', type: 'checking', balance: 900 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ apr: 0.20, apr_is_default: true, min_payment: 47.02, min_payment_is_default: true });
    expect(out[1]).toMatchObject({ apr: 0.07, apr_is_default: true });
  });
});
