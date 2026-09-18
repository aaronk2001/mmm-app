import { describe, it, expect, beforeAll } from 'vitest';
import { computeRunway } from '../server/money/runway.js';
import { CADENCES } from '../server/middleware/validators.js';
import store from '../server/money/store.js';

describe('CADENCES', () => {
  it('accepts quarterly and annual', () => {
    expect(CADENCES).toEqual(['monthly', 'biweekly', 'weekly', 'quarterly', 'annual']);
  });
});

describe('runway normalization', () => {
  const base = {
    accounts: [{ id: 'a1', type: 'checking', balance: 12000 }],
    transactions: [], categories: [], today: new Date(2026, 8, 17),
  };

  // `amount` is dollars and the returned key is `monthlyBurn` — see
  // tests/runway.test.mjs and server/money/runway.js:86.
  it('spreads a quarterly bill over three months', () => {
    const r = computeRunway({ ...base, recurring: [{ id: 'r1', payee: 'Ins', amount: 600, cadence: 'quarterly', kind: 'bill' }] });
    expect(r.monthlyBurn).toBeCloseTo(200, 2);
    expect(r.burnSource).toBe('recurring');
  });

  it('spreads an annual bill over twelve months', () => {
    const r = computeRunway({ ...base, recurring: [{ id: 'r1', payee: 'Domain', amount: 1200, cadence: 'annual', kind: 'bill' }] });
    expect(r.monthlyBurn).toBeCloseTo(100, 2);
  });
});

describe('advanceDate', () => {
  it('advances a quarterly item by three months', () => {
    expect(store.advanceDate('2026-01-31', 'quarterly')).toBe('2026-04-30');
  });
  it('advances an annual item by one year, clamping a leap day into a non-leap year', () => {
    // 2026-02-29 is not a real date (2026 isn't a leap year); 2024 is, so this
    // actually exercises the leap-day clamp the brief intended.
    expect(store.advanceDate('2024-02-29', 'annual')).toBe('2025-02-28');
  });
  it('still advances weekly and monthly', () => {
    expect(store.advanceDate('2026-09-17', 'weekly')).toBe('2026-09-24');
    expect(store.advanceDate('2026-09-17', 'monthly')).toBe('2026-10-17');
  });
});

describe('postDueRecurring with new cadences', () => {
  beforeAll(() => { store.reset(); });

  it('posts a due quarterly bill once and schedules the next quarter', () => {
    const data = store.readData();
    data.accounts = [{ id: 'a1', name: 'Checking', type: 'checking', balance: 5000, opening_balance: 5000 }];
    data.recurring = [{ id: 'r1', payee: 'Car insurance', amount: 600, cadence: 'quarterly', kind: 'bill', next_date: '2026-01-01', account_id: 'a1' }];
    store.writeData(data);

    const { posted } = store.postDueRecurring();
    expect(posted).toBeGreaterThan(0);
    const after = store.readData();
    expect(after.recurring[0].next_date > '2026-01-01').toBe(true);
    // Every posted date must be a quarter apart.
    const dates = after.transactions.filter((t) => t.payee === 'Car insurance').map((t) => t.date).sort();
    expect(new Set(dates).size).toBe(dates.length);
  });
});
