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

  it('projects a quarterly bill only on its true occurrences, not every month', () => {
    const { rows, totals } = computeIncomeVsSpending({
      today,
      transactions: [],
      recurring: [{ kind: 'bill', amount: 300, cadence: 'quarterly', next_date: '2026-09-16' }],
    });
    // Sep 16 (today, unlinked so it counts) and Dec 16 land inside the
    // Sep..Feb horizon; Mar 16 2027 falls just past it. A fallthrough-to-
    // monthly bug would have hit every month (Sep, Oct, Nov, Dec, Jan, Feb).
    expect(rows.map((r) => r.month)).toEqual(['2026-09', '2026-12']);
    expect(rows.every((r) => r.spending === 300)).toBe(true);
    expect(totals.spending).toBe(600);
  });

  it('projects an annual bill only on its true occurrence within the horizon', () => {
    const { rows, totals } = computeIncomeVsSpending({
      today,
      transactions: [],
      recurring: [{ kind: 'bill', amount: 1200, cadence: 'annual', next_date: '2026-09-16' }],
    });
    // Only the Sep 16 hit falls inside the Sep..Feb horizon; the next
    // occurrence isn't until Sep 2027.
    expect(rows.map((r) => r.month)).toEqual(['2026-09']);
    expect(rows[0].spending).toBe(1200);
    expect(totals.spending).toBe(1200);
  });
});

describe('computeIncomeVsSpending — transfers', () => {
  it('leaves money moved between your own accounts out of both columns when categories are given', () => {
    const today = new Date(2026, 8, 15);
    const categories = [{ id: 'sav', group: 'transfers' }, { id: 'fod', group: 'expenses' }];
    const transactions = [
      { date: '2026-09-05', amount: -2500, category_id: 'sav' },
      { date: '2026-09-05', amount: 2500, category_id: 'sav' },
      { date: '2026-09-06', amount: -80, category_id: 'fod' },
      { date: '2026-09-07', amount: 3000, category_id: 'inc' },
    ];
    const rows = (out) => (out.rows || out);
    const sept = (out) => rows(out).find((r) => r.month === '2026-09');
    expect(sept(computeIncomeVsSpending({ transactions, today, categories }))).toMatchObject({ income: 3000, spending: 80 });
    // Without categories (older callers) nothing is filtered.
    expect(sept(computeIncomeVsSpending({ transactions, today }))).toMatchObject({ income: 5500, spending: 2580 });
  });
});
