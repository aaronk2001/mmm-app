import { describe, it, expect } from 'vitest';
import { computeRunway } from '../server/money/runway.js';

const today = new Date(2026, 8, 16); // Sep 16 2026
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };

const accounts = [
  { id: 'chk', type: 'checking', balance: 3000 },
  { id: 'sav', type: 'savings', balance: 2000 },
  { id: 'cc', type: 'credit', balance: -400 },      // not liquid
  { id: 'brk', type: 'brokerage', balance: 9000 },  // not liquid
];

describe('computeRunway', () => {
  it('uses trailing-90-day actual spend when it exceeds recurring bills', () => {
    const transactions = [
      { date: daysAgo(10), amount: -1500, payee: 'Rent', account_id: 'chk' },
      { date: daysAgo(40), amount: -1500, payee: 'Rent', account_id: 'chk' },
      { date: daysAgo(70), amount: -1500, payee: 'Rent', account_id: 'chk' },
      { date: daysAgo(100), amount: -9999, payee: 'Old', account_id: 'chk' },   // outside 90-day window
      { date: daysAgo(5), amount: 2000, payee: 'Income', account_id: 'chk' },   // ignored (positive)
    ];
    const r = computeRunway({ accounts, transactions, recurring: [{ kind: 'bill', amount: 800, cadence: 'monthly' }], today });

    expect(r.liquid).toBe(5000); // chk 3000 + sav 2000 (cc/brk excluded)

    // spend = the three $1500 Rent rows (Old is outside the window, Income is positive).
    // History length changed deliberately (finding #14): it used to run from the
    // oldest OUTFLOW (70 days ago => 71 days => $1,901/mo, 27% above the real
    // $1,500 rent). It now runs from the oldest transaction on a liquid account —
    // "Old", 100 days ago — capped at the 90-day window.
    expect(r.historyDays).toBe(90);

    // actualTotal = 4500; actualMonthly = 4500 / 90 * 30 = 1500 (>= recurringMonthly 800)
    expect(r.monthlyBurn).toBe(1500);
    expect(r.burnSource).toBe('actual');
    expect(r.actualMonthly).toBe(1500);
    expect(r.recurringMonthly).toBe(800);

    // grade: a full 90-day history => 'A'
    expect(r.grade).toBe('A');

    // months = 5000 / 1500 = 3.33 => 'tight' (3 to 6 months)
    expect(r.months).toBeCloseTo(3.33, 2);
    expect(r.band).toBe('tight');

    // daysLeft = floor(5000 / (1500 / 30)) = 100
    expect(r.daysLeft).toBe(100);

    // today (2026-09-16) + 100 days: 14 left in Sep + 31 Oct + 30 Nov = 75, +25 more => Dec 25
    expect(r.dateMoneyRunsOut).toBe('2026-12-25');

    expect(r.largestOutflow).toEqual({ payee: 'Rent', amount: 4500 });
  });

  it('falls back to recurring bills (grade B) when history is thin', () => {
    const r = computeRunway({
      accounts, today,
      transactions: [{ date: daysAgo(2), amount: -20, payee: 'Coffee', account_id: 'chk' }],
      recurring: [{ kind: 'bill', amount: 1000, cadence: 'monthly' }, { kind: 'bill', amount: 25, cadence: 'weekly' }],
    });
    // recurringMonthly = 1000 + 25 * 52 / 12 = 1108.333...
    // actualMonthly: historyDays = round(2) + 1 = 3; actualMonthly = 20 / 3 * 30 = 200 < recurringMonthly
    expect(r.burnSource).toBe('recurring');
    expect(r.monthlyBurn).toBeCloseTo(1108.33, 1);
    expect(r.grade).toBe('B');
  });

  it('is unknown with thin history, and safe once a full window of real spend appears', () => {
    expect(computeRunway({ accounts, transactions: [], recurring: [], today }).band).toBe('unknown');

    // single $100 spend yesterday: historyDays = round(1) + 1 = 2 (< 14) => grade 'C' => 'unknown' band
    // even though actualMonthly = 100 / 2 * 30 = 1500 > 0
    const thin = computeRunway({ accounts, transactions: [{ date: daysAgo(1), amount: -100, payee: 'x', account_id: 'chk' }], recurring: [], today });
    expect(thin.grade).toBe('C');
    expect(thin.band).toBe('unknown');

    // $50 every 10 days for 90 days: 9 rows at 89,79,...,9 days ago => historyDays = round(89) + 1 = 90
    const txns = [];
    for (let i = 89; i >= 9; i -= 10) txns.push({ date: daysAgo(i), amount: -50, payee: 'Groceries', account_id: 'chk' });
    const full = computeRunway({ accounts, transactions: txns, recurring: [], today });
    expect(full.historyDays).toBe(90);
    expect(full.grade).toBe('A'); // full 90-day window
    // actualTotal = 50 * 9 = 450; monthlyBurn = 450 / 90 * 30 = 150
    expect(full.monthlyBurn).toBe(150);
    // months = 5000 / 150 = 33.33... >= 6 => safe
    expect(full.band).toBe('safe');
  });

  it('excludes transfer-group transactions from spend', () => {
    const categories = [
      { id: 'xfer', name: 'Transfer', group: 'transfers' },
      { id: 'groc', name: 'Groceries', group: 'Food' },
    ];
    const transactions = [
      { date: daysAgo(9), amount: -2500, payee: 'Transfer to Savings', category_id: 'xfer', account_id: 'chk' },
      { date: daysAgo(9), amount: -300, payee: 'Groceries', category_id: 'groc', account_id: 'chk' },
    ];
    const r = computeRunway({ accounts, transactions, recurring: [], categories, today });
    // the $2500 transfer is excluded; only the $300 groceries row is spend
    expect(r.largestOutflow).toEqual({ payee: 'Groceries', amount: 300 });
    // historyDays = round(9) + 1 = 10; monthlyBurn = 300 / 10 * 30 = 900
    expect(r.monthlyBurn).toBe(900);
  });

  it('counts a credit-card purchase once, via the checking payment, not the card swipe', () => {
    const transactions = [
      { date: daysAgo(9), amount: -900, payee: 'Card Purchase', account_id: 'cc' },        // credit — not liquid, excluded
      { date: daysAgo(9), amount: -900, payee: 'Card payment', category_id: 'debt', account_id: 'chk' },
    ];
    const r = computeRunway({ accounts, transactions, recurring: [], categories: [], today });
    // only the chk payment counts as spend; the cc purchase is filtered out
    expect(r.largestOutflow).toEqual({ payee: 'Card payment', amount: 900 });
    // historyDays = round(9) + 1 = 10; monthlyBurn = 900 / 10 * 30 = 2700 (single $900 counted once)
    expect(r.monthlyBurn).toBe(2700);
  });

  // Finding #14: periodic outflows used to be divided by the time since the
  // FIRST outflow. Three monthly $2,000 payments 61/31/1 days ago, with a year
  // of paychecks behind them, read as $2,903/mo and a 'critical' band.
  it('divides burn by the whole observed history, not the time since the first outflow', () => {
    const transactions = [];
    for (let m = 0; m < 12; m++) transactions.push({ date: daysAgo(15 + 30 * m), amount: 2500, payee: 'Payroll', account_id: 'chk' });
    for (const n of [61, 31, 1]) transactions.push({ date: daysAgo(n), amount: -2000, payee: 'Rent + card', account_id: 'chk' });
    const r = computeRunway({ accounts: [{ id: 'chk', type: 'checking', balance: 6000 }], transactions, recurring: [], today });
    expect(r.historyDays).toBe(90);
    expect(r.monthlyBurn).toBe(2000); // 3 x 2000 over the 90-day window
    expect(r.months).toBe(3);
    expect(r.band).toBe('tight');
  });

  it("counts an account's creation date as the start of its history", () => {
    const created = new Date(today); created.setDate(created.getDate() - 45);
    const r = computeRunway({
      accounts: [{ id: 'chk', type: 'checking', balance: 3000, created_at: created.toISOString() }],
      transactions: [{ date: daysAgo(15), amount: -900, payee: 'Rent', account_id: 'chk' }],
      recurring: [], today,
    });
    // created 45 days ago => 46 days of history (inclusive), not the 16 since the one outflow
    expect(r.historyDays).toBe(46);
    expect(r.monthlyBurn).toBeCloseTo(900 / 46 * 30, 2);
    expect(r.grade).toBe('B');
  });

  it('does not let an account created long before its first transaction dilute the burn', () => {
    // Set up two years ago, transactions entered only for the last 24 days (the
    // bundled sample data looks like this): counting from creation would read
    // 90 days of history and a burn ~3.7x too low — a runway that looks safe.
    const r = computeRunway({
      accounts: [{ id: 'chk', type: 'checking', balance: 16000, created_at: '2024-01-15T10:00:00Z' }],
      transactions: [
        { date: daysAgo(24), amount: 3500, payee: 'Payroll', account_id: 'chk' },
        { date: daysAgo(23), amount: -1200, payee: 'Rent', account_id: 'chk' },
        { date: daysAgo(5), amount: -2000, payee: 'Card payment', account_id: 'chk' },
      ],
      recurring: [], today,
    });
    expect(r.historyDays).toBe(25);
    expect(r.monthlyBurn).toBe(3840); // 3,200 / 25 x 30
  });

  it('ignores transactions on non-liquid accounts and future dates when measuring history', () => {
    const r = computeRunway({
      accounts, today,
      transactions: [
        { date: daysAgo(80), amount: -50, payee: 'Card swipe', account_id: 'cc' }, // credit card: not liquid
        { date: daysAgo(-5), amount: -10, payee: 'Scheduled', account_id: 'chk' }, // future-dated
        { date: daysAgo(20), amount: -300, payee: 'Groceries', account_id: 'chk' },
      ],
      recurring: [],
    });
    expect(r.historyDays).toBe(21);
  });
});
