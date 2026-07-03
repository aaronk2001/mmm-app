// Characterization tests for the money math in server/money/store.js.
// These lock CURRENT behavior before the Phase-2 data-layer rewrite — if a
// rewrite changes any of these numbers, that's a regression, not a test bug.
import { describe, it, expect, beforeAll } from 'vitest';
import store from '../server/money/store.js';

const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};
// A date safely inside the current month. NOT the 1st: computeBudgetStatus
// parses 'YYYY-MM-DD' as UTC midnight but builds its month window in local
// time, so first-of-month transactions fall OUT of the budget in UTC-negative
// timezones. Known bug — scheduled for the Phase-2 date-normalization fix.
const thisMonth = () => {
  const d = new Date();
  return iso(new Date(Date.UTC(d.getFullYear(), d.getMonth(), 15)));
};

beforeAll(() => {
  store.reset(); // clean slate in the vitest temp DB
});

describe('computeNetWorth', () => {
  it('splits assets and liabilities by account type', () => {
    const nw = store.computeNetWorth([
      { type: 'checking', balance: 1000 },
      { type: 'savings', balance: 2500.5 },
      { type: 'credit', balance: -800 },
      { type: 'loan', balance: -12000 },
    ]);
    expect(nw).toEqual({ assets: 3500.5, liabilities: 12800, net: -9299.5 });
  });

  it('ignores negative balances on asset accounts', () => {
    const nw = store.computeNetWorth([{ type: 'checking', balance: -50 }]);
    expect(nw).toEqual({ assets: 0, liabilities: 0, net: 0 });
  });

  it('converts currencies through fxRates relative to base', () => {
    const fx = { USD: 1, EUR: 1.1 };
    const nw = store.computeNetWorth(
      [{ type: 'checking', balance: 100, currency: 'EUR' }],
      'USD',
      fx
    );
    expect(nw.assets).toBeCloseTo(110, 2);
  });
});

describe('computeBudgetStatus', () => {
  it('sums current-month expenses per category against the limit', () => {
    const budgets = [{ id: 'b1', category_id: 'fod', period: 'monthly', limit: 500 }];
    const txns = [
      { category_id: 'fod', amount: -100, date: thisMonth() },
      { category_id: 'fod', amount: -150, date: thisMonth() },
      { category_id: 'fod', amount: 999, date: thisMonth() },   // income ignored
      { category_id: 'tra', amount: -50, date: thisMonth() },   // other category ignored
      { category_id: 'fod', amount: -75, date: '2020-01-15' },  // old month ignored
    ];
    const [status] = store.computeBudgetStatus(budgets, txns);
    expect(status).toEqual({ budget_id: 'b1', category_id: 'fod', limit: 500, spent: 250, pct: 50 });
  });

  it('skips non-monthly budgets and handles zero limits', () => {
    const budgets = [
      { id: 'b1', category_id: 'fod', period: 'weekly', limit: 100 },
      { id: 'b2', category_id: 'tra', period: 'monthly', limit: 0 },
    ];
    const out = store.computeBudgetStatus(budgets, [{ category_id: 'tra', amount: -10, date: thisMonth() }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ budget_id: 'b2', pct: 0, spent: 10 });
  });
});

describe('detectRecurring', () => {
  it('detects a monthly bill from evenly spaced same-amount transactions', () => {
    const txns = [
      { payee: 'Rent Co', amount: -1200, date: daysAgo(75) },
      { payee: 'Rent Co', amount: -1200, date: daysAgo(45) },
      { payee: 'Rent Co', amount: -1200, date: daysAgo(15) },
    ];
    const out = store.detectRecurring(txns);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ payee: 'rent co', amount: 1200, cadence: 'monthly', kind: 'bill' });
  });

  it('rejects groups whose amounts vary more than 10%', () => {
    const txns = [
      { payee: 'Groceries', amount: -100, date: daysAgo(60) },
      { payee: 'Groceries', amount: -200, date: daysAgo(30) },
    ];
    expect(store.detectRecurring(txns)).toHaveLength(0);
  });

  it('declared recurring wins over detected for the same payee', () => {
    const txns = [
      { payee: 'Gym', amount: -40, date: daysAgo(60) },
      { payee: 'Gym', amount: -40, date: daysAgo(30) },
    ];
    const declared = [{ payee: 'gym', amount: 45, cadence: 'monthly', kind: 'bill', next_date: daysAgo(-10) }];
    const out = store.detectRecurring(txns, declared);
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(45);
  });

  it('classifies positive amounts as income', () => {
    const txns = [
      { payee: 'Employer', amount: 2000, date: daysAgo(28) },
      { payee: 'Employer', amount: 2000, date: daysAgo(14) },
      { payee: 'Employer', amount: 2000, date: daysAgo(0) },
    ];
    const out = store.detectRecurring(txns);
    expect(out[0]).toMatchObject({ kind: 'income', cadence: 'biweekly' });
  });
});

describe('projectCashflow', () => {
  it('projects liquid-account balances over N days with recurring flows', () => {
    // Empty DB (reset in beforeAll) → avg daily discretionary spend is 0.
    const accounts = [
      { type: 'checking', balance: 1000 },
      { type: 'loan', balance: -5000 }, // not liquid — excluded from start balance
    ];
    const nextWeek = daysAgo(-7);
    const recurring = [{ payee: 'Paycheck', amount: 500, cadence: 'monthly', kind: 'income', next_date: nextWeek }];
    const out = store.projectCashflow(accounts, recurring, 30);

    expect(out.startBalance).toBe(1000);
    expect(out.projection).toHaveLength(31);
    expect(out.summary.endBalance).toBe(1500); // one paycheck lands inside the window
    expect(out.lowBalanceWarnings).toHaveLength(0);
  });

  it('flags low-balance days under $500', () => {
    const out = store.projectCashflow([{ type: 'checking', balance: 400 }], [], 5);
    expect(out.lowBalanceWarnings.length).toBe(6); // every projected day is under 500
    expect(out.summary.lowestBalance).toBe(400);
  });
});
