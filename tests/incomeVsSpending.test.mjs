import { describe, it, expect } from 'vitest';
import { computeIncomeVsSpending } from '../src/lib/incomeVsSpending.js';

const today = new Date(2026, 8, 16); // Sep 16 2026 (local)

describe('computeIncomeVsSpending', () => {
  it('buckets posted transactions by month and keeps two months of history', () => {
    const { rows } = computeIncomeVsSpending({
      today,
      recurring: [],
      transactions: [
        { date: '2026-06-30', amount: -100 },  // dropped: older than 2 months back
        { date: '2026-07-05', amount: 2000 },
        { date: '2026-07-20', amount: -400.4 },
        { date: '2026-09-01', amount: -50 },
      ],
    });
    expect(rows.map(r => r.month)).toEqual(['2026-07', '2026-09']);
    expect(rows[0]).toEqual({ month: '2026-07', income: 2000, spending: 400, projected: false });
    expect(rows[1].projected).toBe(false);
  });

  it('projects unlinked recurring from today and linked recurring strictly after today', () => {
    const { rows } = computeIncomeVsSpending({
      today,
      transactions: [],
      recurring: [
        { kind: 'bill', amount: 100, cadence: 'monthly', next_date: '2026-09-16' },                     // unlinked: counts today
        { kind: 'bill', amount: 1, cadence: 'monthly', next_date: '2026-09-16', account_id: 'acc1' },  // linked: skips today
      ],
    });
    const sep = rows.find(r => r.month === '2026-09');
    const oct = rows.find(r => r.month === '2026-10');
    expect(sep.spending).toBe(100);
    expect(oct.spending).toBe(101);
    expect(oct.projected).toBe(true);
  });

  it('stops at the end of the fifth month ahead and totals across rows', () => {
    const { rows, totals } = computeIncomeVsSpending({
      today,
      transactions: [],
      recurring: [{ kind: 'income', amount: 10, cadence: 'monthly', next_date: '2026-09-20' }],
    });
    expect(rows[rows.length - 1].month).toBe('2027-02');
    expect(rows).toHaveLength(6); // Sep..Feb
    expect(totals).toEqual({ income: 60, spending: 0, net: 60 });
  });
});
