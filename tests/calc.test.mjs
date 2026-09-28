// Characterization tests for the money math in server/money/store.js.
// These lock CURRENT behavior before the Phase-2 data-layer rewrite — if a
// rewrite changes any of these numbers, that's a regression, not a test bug.
import { describe, it, expect, beforeAll } from 'vitest';
import store from '../server/money/store.js';
import calc from '../server/money/calc.js';

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
    const ym = thisMonth().slice(0, 7);
    const d = new Date();
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    expect(status).toEqual({
      budget_id: 'b1', category_id: 'fod', period: 'monthly', rollover: false,
      limit: 500, carried: 0, available: 500, spent: 250, remaining: 250, pct: 50, over: false,
      period_start: `${ym}-01`, period_end: `${ym}-${String(last).padStart(2, '0')}`,
    });
  });

  it('counts transactions dated the 1st of the month (UTC/local regression)', () => {
    // Phase-1 characterization caught this: Date-object comparison dropped
    // 1st-of-month transactions in UTC-negative timezones. Phase 2 compares
    // date strings, so the 1st always belongs to its own month.
    const d = new Date();
    const firstOfMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const budgets = [{ id: 'b1', category_id: 'fod', period: 'monthly', limit: 100 }];
    const [status] = store.computeBudgetStatus(budgets, [{ category_id: 'fod', amount: -10, date: firstOfMonth }]);
    expect(status.spent).toBe(10);
  });

  it('handles a zero limit without dividing by zero', () => {
    const budgets = [{ id: 'b2', category_id: 'tra', period: 'monthly', limit: 0 }];
    const [status] = store.computeBudgetStatus(budgets, [{ category_id: 'tra', amount: -10, date: thisMonth() }]);
    expect(status).toMatchObject({ budget_id: 'b2', pct: 0, spent: 10, over: true });
  });

  // Weekly/biweekly/annual budgets used to be filtered out of the status
  // entirely — the validator accepted them and they then vanished.
  it('reports weekly, biweekly and annual budgets over their own local windows', () => {
    const budgets = [
      { id: 'w', category_id: 'fod', period: 'weekly', limit: 100 },
      { id: 'b', category_id: 'fod', period: 'biweekly', limit: 200 },
      { id: 'a', category_id: 'fod', period: 'annual', limit: 5000 },
    ];
    const txns = [
      { category_id: 'fod', amount: -30, date: '2026-09-28' }, // Monday: this week
      { category_id: 'fod', amount: -20, date: '2026-09-30' }, // this week
      { category_id: 'fod', amount: -40, date: '2026-09-27' }, // Sunday: last week
      { category_id: 'fod', amount: -50, date: '2026-01-02' }, // this year only
      { category_id: 'fod', amount: -60, date: '2025-12-31' }, // last year
    ];
    const byId = Object.fromEntries(store.computeBudgetStatus(budgets, txns, '2026-09-30').map((s) => [s.budget_id, s]));
    expect(byId.w).toMatchObject({ period_start: '2026-09-28', period_end: '2026-10-04', spent: 50 });
    // Biweekly windows count from Monday 2024-01-01: 2026-09-21..2026-10-04.
    expect(byId.b).toMatchObject({ period_start: '2026-09-21', period_end: '2026-10-04', spent: 90 });
    expect(byId.a).toMatchObject({ period_start: '2026-01-01', period_end: '2026-12-31', spent: 140 });
  });

  // Rollover was stored and toggled but never read.
  it('rolls last period\'s remainder into this period for rollover budgets', () => {
    const txns = [
      { category_id: 'fod', amount: -300, date: '2026-08-10' }, // August: 200 unspent of 500
      { category_id: 'fod', amount: -600, date: '2026-09-10' },
    ];
    const [under] = store.computeBudgetStatus([{ id: 'r', category_id: 'fod', period: 'monthly', limit: 500, rollover: true }], txns, '2026-09-30');
    expect(under).toMatchObject({ rollover: true, carried: 200, available: 700, spent: 600, remaining: 100, over: false, pct: 86 });

    const [plain] = store.computeBudgetStatus([{ id: 'p', category_id: 'fod', period: 'monthly', limit: 500 }], txns, '2026-09-30');
    expect(plain).toMatchObject({ rollover: false, carried: 0, available: 500, remaining: -100, over: true });

    // Overspending last period is carried too, as a smaller budget this period.
    const [overspent] = store.computeBudgetStatus(
      [{ id: 'o', category_id: 'fod', period: 'monthly', limit: 500, rollover: true }],
      [{ category_id: 'fod', amount: -650, date: '2026-08-10' }], '2026-09-30');
    expect(overspent).toMatchObject({ carried: -150, available: 350 });
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

  // next_date used to be UTC-parsed, advanced with local setMonth, then keyed
  // via toISOString — west of UTC, rent on the 1st after February projected
  // to Mar 29. Force a western TZ so this fails on any machine.
  it('keeps a 1st-of-month bill on the 1st west of UTC', () => {
    const prevTZ = process.env.TZ;
    process.env.TZ = 'America/Phoenix';
    try {
      const txns = [
        { payee: 'Rent', amount: -1500, date: '2026-01-01' },
        { payee: 'Rent', amount: -1500, date: '2026-02-01' },
        { payee: 'Rent', amount: -1500, date: '2026-03-01' },
      ];
      // `today` pins "now" next to the fixture: detections whose last charge is
      // more than two periods old are dropped as stopped.
      expect(store.detectRecurring(txns, [], { today: '2026-03-15' })[0].next_date).toBe('2026-04-01');
      const sep = txns.map((t, i) => ({ ...t, date: `2026-0${7 + i}-01` }));
      expect(store.detectRecurring(sep, [], { today: '2026-09-15' })[0].next_date).toBe('2026-10-01');
    } finally {
      if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ;
    }
  });
});

describe('detectRecurring — schedules and staleness', () => {
  it('clamps month math instead of skipping a month (Jan 31 -> Feb 28, not Mar 3)', () => {
    const txns = [
      { payee: 'Gym', amount: -40, date: '2025-11-30' },
      { payee: 'Gym', amount: -40, date: '2025-12-31' },
      { payee: 'Gym', amount: -40, date: '2026-01-31' },
    ];
    expect(store.detectRecurring(txns, [], { today: '2026-02-10' })[0].next_date).toBe('2026-02-28');
  });

  it('drops a series that stopped charging more than two periods ago', () => {
    const txns = [
      { payee: 'Gym', amount: -899.99, date: '2024-01-10' },
      { payee: 'Gym', amount: -899.99, date: '2024-02-10' },
      { payee: 'Gym', amount: -899.99, date: '2024-03-10' },
    ];
    expect(store.detectRecurring(txns, [], { today: '2024-04-20' })).toHaveLength(1); // one missed period: still live
    expect(store.detectRecurring(txns, [], { today: '2026-10-10' })).toHaveLength(0);
  });

  it('never treats a transfer between the user\'s own accounts as a recurring bill', () => {
    const categories = [{ id: 'sav', name: 'Savings', group: 'transfers' }];
    const txns = [
      { payee: 'To savings', amount: -500, date: '2026-07-01', category_id: 'sav' },
      { payee: 'To savings', amount: -500, date: '2026-08-01', category_id: 'sav' },
      { payee: 'To savings', amount: -500, date: '2026-09-01', category_id: 'sav' },
    ];
    expect(calc.detectRecurring(txns, [], { categories, today: '2026-09-10' })).toHaveLength(0);
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

  it('advances a quarterly bill through every occurrence in a long window, not just the first', () => {
    // next_date is 5 days out (always in the future, regardless of run date).
    // Quarterly hits land at ~day 5, ~day 96, ~day 187 inside a 200-day window
    // (worst-case 2-quarter offset is 189 days — still short of 200 by a
    // comfortable margin); the 4th hit (~day 278) falls outside it. Before the
    // fix, an unrecognized cadence hit "else break" and never advanced past
    // the first occurrence, so this would have summed to -90, not -270.
    const accounts = [{ type: 'checking', balance: 0 }];
    const recurring = [{ payee: 'Insurance', amount: 90, cadence: 'quarterly', kind: 'bill', next_date: daysAgo(-5) }];
    const out = store.projectCashflow(accounts, recurring, 200);
    expect(out.summary.endBalance).toBe(-270);
  });

  it('advances an annual bill through every occurrence in a multi-year window, not just the first', () => {
    // Same shape as the quarterly case above, scaled to a ~2-year window so
    // three annual hits (~day 5, ~day 371, ~day 736) land inside it and a
    // 4th (~day 1101) does not. Before the fix this would have summed to
    // -40, not -120.
    const accounts = [{ type: 'checking', balance: 0 }];
    const recurring = [{ payee: 'Domain renewal', amount: 40, cadence: 'annual', kind: 'bill', next_date: daysAgo(-5) }];
    const out = store.projectCashflow(accounts, recurring, 800);
    expect(out.summary.endBalance).toBe(-120);
  });
});

describe('computeGoalInsights with recurring', () => {
  const liquid = [{ type: 'checking', balance: 6000 }];

  it('normalizes weekly and biweekly recurring to a monthly figure', () => {
    const insights = store.computeGoalInsights(liquid, [], [
      { kind: 'bill', amount: 100, cadence: 'weekly' },    // 433.33/mo
      { kind: 'bill', amount: 200, cadence: 'biweekly' },  // 433.33/mo
      { kind: 'bill', amount: 50, cadence: 'monthly' },    // 50/mo
    ]);
    expect(insights.emergencyFund.monthlyExpenses).toBeCloseTo(916.67, 1);
    expect(insights.emergencyFund.targetAmount).toBeCloseTo(5500, 0); // 6 months
  });

  it('takes the max of actual and recurring so a posted bill is not double counted', () => {
    // 60 days of actuals: $2,400 spent => $1,200/mo. Recurring says $1,000/mo.
    const txns = [
      { amount: -1200, date: daysAgo(10) },
      { amount: -1200, date: daysAgo(40) },
      { amount: 5000, date: daysAgo(5) },
    ];
    const insights = store.computeGoalInsights(liquid, txns, [{ kind: 'bill', amount: 1000, cadence: 'monthly' }]);
    expect(insights.emergencyFund.monthlyExpenses).toBe(1200); // not 2200
  });

  it('recurring income raises monthlyIncome when actuals are thin', () => {
    const insights = store.computeGoalInsights(
      liquid,
      [{ amount: -500, date: daysAgo(3) }],
      [{ kind: 'income', amount: 3000, cadence: 'monthly' }, { kind: 'bill', amount: 500, cadence: 'monthly' }]
    );
    // fire.yearsToFire only becomes a number when monthlySavings > 0 (3000 - 500)
    expect(insights.fire.yearsToFire).not.toBeNull();
  });

  it('reports 0 months covered (not a division fallback) when there are no expenses', () => {
    const insights = store.computeGoalInsights(liquid, [], []);
    expect(insights.emergencyFund.monthsCovered).toBe(0);
    expect(insights.emergencyFund.targetAmount).toBe(0);
  });
});
