import { describe, it, expect } from 'vitest';
import { computeVariables, SAMPLE_DATA } from '../server/learn/variables.js';
import calc from '../server/money/calc.js';
import { computeRunway } from '../server/money/runway.js';

// Dynamic, run-date-safe fixture helpers. computeBudgetStatus (calc.js) and
// the default `today` in computeVariables both key off the REAL current
// date, so fixtures must be built relative to `new Date()` rather than a
// hardcoded date, or these tests would only pass on the day they were written.
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}
function firstOfThisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

const FULL_ACCOUNTS = [
  { id: 'a1', name: 'Checking', type: 'checking', balance: 5000 },
  { id: 'a2', name: 'Savings', type: 'savings', balance: 3000 },
  { id: 'a3', name: 'Chase Credit Card', type: 'credit', balance: -1200 },
  { id: 'a4', name: 'Auto Loan', type: 'loan', balance: -8000 },
];
const FULL_CATEGORIES = [
  { id: 'fod', name: 'Food', group: 'Variable' },
  { id: 'hou', name: 'Housing', group: 'Fixed' },
  { id: 'transfer', name: 'Transfers', group: 'Transfers' },
];
const FULL_TRANSACTIONS = [
  { id: 't1', account_id: 'a1', date: daysAgo(40), amount: 2500, payee: 'Employer', category_id: null },
  { id: 't2', account_id: 'a1', date: daysAgo(10), amount: 2500, payee: 'Employer', category_id: null },
  { id: 't3', account_id: 'a1', date: daysAgo(35), amount: -1500, payee: 'Landlord LLC', category_id: 'hou' },
  { id: 't4', account_id: 'a1', date: daysAgo(5), amount: -1500, payee: 'Landlord LLC', category_id: 'hou' },
  { id: 't5', account_id: 'a1', date: daysAgo(3), amount: -500, payee: 'Internal Transfer', category_id: 'transfer' },
  { id: 't6', account_id: 'a1', date: firstOfThisMonth(), amount: -640, payee: 'Grocery Store', category_id: 'fod' },
];
const FULL_RECURRING = [{ id: 'r1', kind: 'bill', amount: 200, cadence: 'weekly', category_id: 'sub' }];
const FULL_BUDGETS = [{ id: 'b1', category_id: 'fod', period: 'monthly', limit: 500 }];

describe('learn/variables — full data', () => {
  const ctx = {
    accounts: FULL_ACCOUNTS,
    transactions: FULL_TRANSACTIONS,
    categories: FULL_CATEGORIES,
    recurring: FULL_RECURRING,
    budgets: FULL_BUDGETS,
  };
  const vars = computeVariables(ctx);

  it('every provider from the spec is present', () => {
    for (const key of [
      'runway_days', 'runway_date', 'liquid', 'savings_rate', 'monthly_surplus',
      'ef_months_covered', 'ef_target', 'budget_variance_top3', 'recurring_monthly',
      'largest_outflow', 'debt_ledger',
    ]) {
      expect(vars[key], `missing provider ${key}`).toBeDefined();
      expect(vars[key]).toHaveProperty('value');
      expect(vars[key]).toHaveProperty('formatted');
      expect(vars[key]).toHaveProperty('grade');
      expect(vars[key]).toHaveProperty('sample');
    }
  });

  it('runway_days / runway_date delegate to the real runway.js computation', () => {
    const runway = computeRunway({
      accounts: FULL_ACCOUNTS, transactions: FULL_TRANSACTIONS,
      recurring: FULL_RECURRING, categories: FULL_CATEGORIES,
    });
    expect(runway.band).not.toBe('unknown'); // sanity: fixture has enough history to be real
    expect(vars.runway_days.sample).toBe(false);
    expect(vars.runway_days.value).toBe(runway.daysLeft);
    expect(vars.runway_days.formatted).toBe(`${runway.daysLeft} days`);
    expect(vars.runway_days.grade).toBe(runway.grade);

    expect(vars.runway_date.sample).toBe(false);
    expect(vars.runway_date.value).toBe(runway.dateMoneyRunsOut);
    expect(vars.runway_date.formatted).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  });

  it('liquid sums checking+savings+cash accounts', () => {
    expect(vars.liquid.sample).toBe(false);
    expect(vars.liquid.value).toBe(8000);
    expect(vars.liquid.formatted).toBe('$8,000');
    expect(vars.liquid.grade).toBe('A');
  });

  it('monthly_surplus and savings_rate mirror the trailing-60-day income/expense formula', () => {
    // income: (2500+2500)/2 = 2500; expenses: (1500+1500+500+640)/2 = 2070
    // surplus = 430; savings_rate = 430/2500 = 17.2%
    expect(vars.monthly_surplus.sample).toBe(false);
    expect(vars.monthly_surplus.value).toBe(430);
    expect(vars.monthly_surplus.formatted).toBe('$430');
    expect(vars.monthly_surplus.grade).toBe('B'); // 41 days of history: >=14, <60

    expect(vars.savings_rate.sample).toBe(false);
    expect(vars.savings_rate.value).toBeCloseTo(0.172, 5);
    expect(vars.savings_rate.formatted).toBe('17.2%');
  });

  it('ef_months_covered / ef_target delegate to calc.computeGoalInsights', () => {
    const gi = calc.computeGoalInsights(FULL_ACCOUNTS, FULL_TRANSACTIONS, FULL_RECURRING);
    expect(gi.emergencyFund.monthlyExpenses).toBeGreaterThan(0); // sanity
    expect(vars.ef_months_covered.sample).toBe(false);
    expect(vars.ef_months_covered.value).toBe(gi.emergencyFund.monthsCovered);
    expect(vars.ef_target.sample).toBe(false);
    expect(vars.ef_target.value).toBe(gi.emergencyFund.targetAmount);
  });

  it('budget_variance_top3 rows carry {name, formatted} for template iteration', () => {
    expect(vars.budget_variance_top3.sample).toBe(false);
    expect(vars.budget_variance_top3.grade).toBe('A');
    expect(vars.budget_variance_top3.value).toEqual([
      { category_id: 'fod', name: 'Food', limit: 500, spent: 640, variance: 140, formatted: '$140 over' },
    ]);
  });

  it('recurring_monthly normalizes cadence to a monthly figure', () => {
    // $200/week * 52/12 = 866.6666..
    expect(vars.recurring_monthly.sample).toBe(false);
    expect(vars.recurring_monthly.value).toBeCloseTo(866.67, 2);
    expect(vars.recurring_monthly.formatted).toBe('$867');
    // grade is grounded in the same trailing-60-day history depth as
    // monthly_surplus/savings_rate (41 days: >=14, <60) rather than a flat 'A'.
    expect(vars.recurring_monthly.grade).toBe('B');
  });

  it('largest_outflow picks the biggest payee, excluding transfers, and states its 90-day window', () => {
    expect(vars.largest_outflow.sample).toBe(false);
    expect(vars.largest_outflow.value).toEqual({ payee: 'Landlord LLC', amount: 3000 });
    expect(vars.largest_outflow.formatted).toBe('Landlord LLC — $3,000 over the last 90 days');
    // grade is grounded in runway.js's own historyDays for this window (36
    // days of spend history here: >=14, <90 => 'B'), not a flat 'A'.
    expect(vars.largest_outflow.grade).toBe('B');
  });

  it('debt_ledger lists loan/credit accounts as positive balances', () => {
    expect(vars.debt_ledger.sample).toBe(false);
    expect(vars.debt_ledger.value).toEqual([
      { name: 'Chase Credit Card', balance: 1200, type: 'credit' },
      { name: 'Auto Loan', balance: 8000, type: 'loan' },
    ]);
  });
});

describe('learn/variables — no data (fresh install)', () => {
  const vars = computeVariables({ accounts: [], transactions: [], categories: [], recurring: [], budgets: [] });

  it('every provider falls back to its declared SAMPLE_DATA with sample: true', () => {
    for (const key of [
      'runway_days', 'liquid', 'savings_rate', 'monthly_surplus',
      'ef_months_covered', 'ef_target', 'recurring_monthly',
    ]) {
      expect(vars[key].sample, `${key} should be sample`).toBe(true);
      expect(vars[key].value).toEqual(SAMPLE_DATA[key]);
      expect(vars[key].grade).toBe('C');
    }
    expect(vars.runway_date.sample).toBe(true);
    expect(vars.budget_variance_top3.sample).toBe(true);
    expect(vars.budget_variance_top3.value).toEqual(SAMPLE_DATA.budget_variance_top3);
    expect(vars.largest_outflow.sample).toBe(true);
    expect(vars.largest_outflow.value).toEqual(SAMPLE_DATA.largest_outflow);
    expect(vars.debt_ledger.sample).toBe(true);
    expect(vars.debt_ledger.value).toEqual(SAMPLE_DATA.debt_ledger);
  });

  it('never crashes and never returns null/undefined value for a sample provider', () => {
    for (const key of Object.keys(vars)) {
      expect(vars[key].value, `${key} value should not be null`).not.toBeNull();
      expect(vars[key].formatted, `${key} formatted should not be null`).toBeTruthy();
    }
  });
});

describe('learn/variables — partial data (accounts but no ledger history)', () => {
  // Has accounts (so liquid/debt_ledger are real) but zero transactions,
  // budgets, or recurring — those must independently fall back to sample.
  const vars = computeVariables({
    accounts: FULL_ACCOUNTS, transactions: [], categories: FULL_CATEGORIES, recurring: [], budgets: [],
  });

  it('liquid and debt_ledger are real (accounts exist)', () => {
    expect(vars.liquid.sample).toBe(false);
    expect(vars.liquid.value).toBe(8000);
    expect(vars.debt_ledger.sample).toBe(false);
    expect(vars.debt_ledger.value.length).toBe(2);
  });

  it('runway, savings, budget, and recurring are sample (no transaction/recurring/budget signal)', () => {
    expect(vars.runway_days.sample).toBe(true);
    expect(vars.savings_rate.sample).toBe(true);
    expect(vars.monthly_surplus.sample).toBe(true);
    expect(vars.recurring_monthly.sample).toBe(true);
    expect(vars.budget_variance_top3.sample).toBe(true);
    expect(vars.largest_outflow.sample).toBe(true);
  });

  it('ef_months_covered/ef_target are sample when there is no expense signal', () => {
    expect(vars.ef_months_covered.sample).toBe(true);
    expect(vars.ef_target.sample).toBe(true);
  });
});

describe('learn/variables — budget_variance_top3 edge cases (Minor)', () => {
  it('does not claim grade A when the only budgets are non-monthly (filtered out, not "no variance")', () => {
    // computeBudgetStatus only evaluates period === 'monthly' budgets, so a
    // weekly-only budget set produces zero rows here for a filter reason, not
    // because spend is genuinely on target — that's not gradeable evidence.
    const vars = computeVariables({
      accounts: FULL_ACCOUNTS, transactions: FULL_TRANSACTIONS, categories: FULL_CATEGORIES,
      recurring: FULL_RECURRING, budgets: [{ id: 'b1', category_id: 'fod', period: 'weekly', limit: 100 }],
    });
    expect(vars.budget_variance_top3.sample).toBe(false);
    expect(vars.budget_variance_top3.value).toEqual([]);
    expect(vars.budget_variance_top3.formatted).toBe('No budget activity yet this month');
    expect(vars.budget_variance_top3.grade).toBe('C');
  });

  it('formats an exact-zero variance as "on budget", not "$0 over"', () => {
    const vars = computeVariables({
      accounts: FULL_ACCOUNTS, transactions: FULL_TRANSACTIONS, categories: FULL_CATEGORIES,
      recurring: FULL_RECURRING, budgets: [{ id: 'b1', category_id: 'fod', period: 'monthly', limit: 640 }],
    });
    expect(vars.budget_variance_top3.value).toEqual([
      { category_id: 'fod', name: 'Food', limit: 640, spent: 640, variance: 0, formatted: 'on budget' },
    ]);
    expect(vars.budget_variance_top3.grade).toBe('A');
  });
});
