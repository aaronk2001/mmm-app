import { describe, it, expect } from 'vitest';
import { computeRunway } from '../server/money/runway.js';

const today = new Date(2026, 8, 16); // Sep 16 2026
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };

const accounts = [
  { type: 'checking', balance: 3000 },
  { type: 'savings', balance: 2000 },
  { type: 'credit', balance: -400 },      // not liquid
  { type: 'brokerage', balance: 9000 },   // not liquid
];

describe('computeRunway', () => {
  it('uses trailing-90-day actual spend when it exceeds recurring bills', () => {
    const transactions = [
      { date: daysAgo(10), amount: -1500, payee: 'Rent' },
      { date: daysAgo(40), amount: -1500, payee: 'Rent' },
      { date: daysAgo(70), amount: -1500, payee: 'Rent' },
      { date: daysAgo(100), amount: -9999, payee: 'Old' },   // outside window
      { date: daysAgo(5), amount: 2000, payee: 'Income' },   // ignored
    ];
    const r = computeRunway({ accounts, transactions, recurring: [{ kind: 'bill', amount: 800, cadence: 'monthly' }], today });
    expect(r.liquid).toBe(5000);
    expect(r.monthlyBurn).toBe(1500);
    expect(r.burnSource).toBe('actual');
    expect(r.months).toBeCloseTo(3.33, 2);
    expect(r.daysLeft).toBe(100);                 // 5000 / (1500/30)
    expect(r.dateMoneyRunsOut).toBe('2026-12-25');
    expect(r.band).toBe('tight');
    expect(r.largestOutflow).toEqual({ payee: 'Rent', amount: 4500 });
    expect(r.grade).toBe('A');
    expect(r.historyDays).toBeGreaterThanOrEqual(70);
  });

  it('falls back to recurring bills (grade B) when history is thin', () => {
    const r = computeRunway({
      accounts, today,
      transactions: [{ date: daysAgo(2), amount: -20, payee: 'Coffee' }],
      recurring: [{ kind: 'bill', amount: 1000, cadence: 'monthly' }, { kind: 'bill', amount: 25, cadence: 'weekly' }],
    });
    expect(r.burnSource).toBe('recurring');
    expect(r.monthlyBurn).toBeCloseTo(1108.33, 1);
    expect(r.grade).toBe('B');
  });

  it('is unknown with no spend data and safe above six months', () => {
    expect(computeRunway({ accounts, transactions: [], recurring: [], today }).band).toBe('unknown');
    const r = computeRunway({ accounts, transactions: [{ date: daysAgo(1), amount: -100, payee: 'x' }], recurring: [], today });
    expect(r.band).toBe('safe'); // 5000 / 33.33 ≈ 150 months
  });
});
