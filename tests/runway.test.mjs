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
    // oldest is 70 days ago => historyDays = round(70) + 1 = 71 (inclusive of today)
    expect(r.historyDays).toBe(71);

    // actualTotal = 4500; actualMonthly = 4500 / 71 * 30 = 1901.408450... >= recurringMonthly (800) => actual-driven
    expect(r.monthlyBurn).toBeCloseTo(1901.41, 1);
    expect(r.burnSource).toBe('actual');

    // grade: historyDays 71 -> not >=90, but >=14 => 'B'
    expect(r.grade).toBe('B');

    // months = 5000 / 1901.41 = 2.629628... => rounds to 2.63; < 3 => 'critical'
    expect(r.months).toBeCloseTo(2.63, 2);
    expect(r.band).toBe('critical');

    // daysLeft = floor(5000 / (1901.41 / 30)) = floor(5000 / 63.380333...) = floor(78.8887) = 78
    expect(r.daysLeft).toBe(78);

    // today (2026-09-16) + 78 days: 14 left in Sep + 31 Oct + 30 Nov = 75, +3 more => Dec 3
    expect(r.dateMoneyRunsOut).toBe('2026-12-03');

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
});
