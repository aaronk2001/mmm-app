// Unit tests for the deterministic advice engine. Pure function → synthetic
// inputs, no DB. Locks the rule behavior the LLM coach is grounded on.
import { describe, it, expect, vi } from 'vitest';
import advice from '../server/money/advice.js';

const { computeAdvice, computeDigest, fingerprint } = advice;
const ids = (fs) => fs.map((f) => f.id);
const byId = (fs, id) => fs.find((f) => f.id === id);

describe('computeAdvice', () => {
  it('returns nothing when there is no activity', () => {
    expect(computeAdvice({})).toEqual([]);
    expect(computeAdvice({ metrics: {}, accounts: [] })).toEqual([]);
  });

  it('flags a thin emergency fund as critical', () => {
    const fs = computeAdvice({
      metrics: { monthly_income: 4000, monthly_expenses: 3000 },
      goalInsights: { emergencyFund: { adequacy: 'low', monthsCovered: 1, targetAmount: 18000, monthlyExpenses: 3000 } },
    });
    const f = byId(fs, 'emergency-fund-low');
    expect(f).toBeTruthy();
    expect(f.severity).toBe('critical');
    expect(f.action.route).toBe('/goals');
  });

  it('reassures when the emergency fund is good (low impact)', () => {
    const fs = computeAdvice({
      metrics: { monthly_income: 4000, monthly_expenses: 3000 },
      goalInsights: { emergencyFund: { adequacy: 'good', monthsCovered: 8, targetAmount: 18000, monthlyExpenses: 3000 } },
    });
    const f = byId(fs, 'emergency-fund-good');
    expect(f.severity).toBe('good');
    expect(f.impact).toBeLessThan(30);
  });

  it('flags spending more than you earn as critical', () => {
    const fs = computeAdvice({
      metrics: { monthly_income: 3000, monthly_expenses: 3500, monthly_surplus: -500, savings_rate: -0.17 },
      accounts: [{ id: 'a', balance: 100 }],
    });
    expect(ids(fs)).toContain('savings-negative');
    expect(byId(fs, 'savings-negative').severity).toBe('critical');
  });

  it('flags a low (but positive) savings rate as a warning', () => {
    const fs = computeAdvice({
      metrics: { monthly_income: 4000, monthly_expenses: 3800, monthly_surplus: 200, savings_rate: 0.05 },
    });
    expect(byId(fs, 'savings-rate-low').severity).toBe('warn');
    expect(ids(fs)).not.toContain('savings-negative');
  });

  it('flags budget overspend with a category deep-link', () => {
    const fs = computeAdvice({
      metrics: { monthly_income: 4000, monthly_expenses: 3000 },
      budgetStatus: [{ category_id: 'fod', limit: 600, spent: 800, pct: 133 }],
      categories: [{ id: 'fod', name: 'Food & Dining' }],
    });
    const f = byId(fs, 'budget-fod');
    expect(f.severity).toBe('warn');
    expect(f.action).toEqual({ label: 'Review Food & Dining', route: '/transactions', params: { category: 'Food & Dining' } });
  });

  it('does not flag a budget that is comfortably under', () => {
    const fs = computeAdvice({
      metrics: { monthly_income: 4000, monthly_expenses: 3000 },
      budgetStatus: [{ category_id: 'fod', limit: 600, spent: 300, pct: 50 }],
      categories: [{ id: 'fod', name: 'Food & Dining' }],
    });
    expect(ids(fs)).not.toContain('budget-fod');
  });

  it('flags a projected negative balance as critical', () => {
    const fs = computeAdvice({
      metrics: { monthly_income: 4000, monthly_expenses: 3000 },
      cashflow: { summary: { lowestBalance: -250, lowestDate: '2026-08-01' } },
    });
    expect(byId(fs, 'cashflow-negative').severity).toBe('critical');
  });

  it('picks the highest-APR debt as the avalanche target', () => {
    const fs = computeAdvice({
      metrics: { monthly_income: 4000, monthly_expenses: 3000 },
      debts: [
        { name: 'Auto Loan', balance: 18000, apr: 0.07 },
        { name: 'Chase Sapphire', balance: 2400, apr: 0.22 },
      ],
    });
    const f = byId(fs, 'debt-avalanche-target');
    expect(f).toBeTruthy();
    expect(f.title).toContain('Chase Sapphire');
  });

  it('flags a goal that is behind pace', () => {
    const future = new Date();
    future.setMonth(future.getMonth() + 4);
    const target_date = future.toISOString().slice(0, 10);
    const fs = computeAdvice({
      metrics: { monthly_income: 4000, monthly_expenses: 3000 },
      goals: [{ id: 'g1', name: 'Vacation', target: 5000, current: 500, monthly_contribution: 200, target_date }],
      accounts: [],
    });
    // needs (4500/4)=1125/mo but only contributing 200 → behind
    expect(byId(fs, 'goal-behind-g1')).toBeTruthy();
  });

  it('counts monthsLeft on the LOCAL calendar day for a 1st-of-month target date (west of UTC)', () => {
    const prevTZ = process.env.TZ;
    process.env.TZ = 'America/Phoenix';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 15, 10, 0)); // Sep 15 2026, 10am Phoenix local
    try {
      // `new Date('2026-11-01')` parses as UTC midnight = Oct 31, 5pm Phoenix
      // local, collapsing Sep 15 -> Nov 1 (2 months) into 1 month and falsely
      // flagging the goal as behind pace even though $550/mo covers the real
      // 2-month, $500/mo pace.
      const fs = computeAdvice({
        metrics: { monthly_income: 4000, monthly_expenses: 3000 },
        goals: [{ id: 'g1', name: 'Trip', target: 1000, current: 0, monthly_contribution: 550, target_date: '2026-11-01' }],
        accounts: [],
      });
      expect(byId(fs, 'goal-behind-g1')).toBeFalsy();
    } finally {
      vi.useRealTimers();
      if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ;
    }
  });

  it('spreads quarterly and annual bills over their true monthly share in the recurring-heavy finding', () => {
    const fs = computeAdvice({
      metrics: { monthly_income: 1000, monthly_expenses: 800 },
      recurring: [
        { payee: 'Insurance', amount: 900, cadence: 'quarterly', kind: 'bill' }, // 300/mo
        { payee: 'Domain', amount: 2400, cadence: 'annual', kind: 'bill' },      // 200/mo
      ],
    });
    const f = byId(fs, 'recurring-heavy');
    expect(f).toBeTruthy();
    // 300 + 200 = 500/mo (50% of income), not 900 + 2400 = 3300/mo (330%) —
    // the old fallthrough-to-monthly bug would have used the raw amounts.
    expect(f.detail).toContain('$500/mo');
    expect(f.detail).toContain('50% of income');
    expect(f.detail).toContain('Insurance ($300/mo)');
  });

  it('flags month-over-month spending spikes', () => {
    const fs = computeAdvice({
      metrics: { monthly_income: 4000, monthly_expenses: 3000 },
      spendThisMonth: 4000,
      spendLastMonth: 3000,
    });
    expect(byId(fs, 'spending-spike')).toBeTruthy();
  });

  it('ranks critical findings above info findings', () => {
    const fs = computeAdvice({
      metrics: { monthly_income: 3000, monthly_expenses: 3500, monthly_surplus: -500, savings_rate: -0.17 },
      accounts: [{ id: 'a', balance: 100 }],
      spendThisMonth: 4000,
      spendLastMonth: 3000,
    });
    const crit = fs.findIndex((f) => f.severity === 'critical');
    const info = fs.findIndex((f) => f.severity === 'info');
    expect(crit).toBeGreaterThanOrEqual(0);
    expect(info).toBeGreaterThan(crit);
  });
});

describe('computeAdvice — proposals', () => {
  const efInput = (goals = []) => ({
    metrics: { monthly_income: 4000, monthly_expenses: 3000 },
    goalInsights: { emergencyFund: { adequacy: 'low', monthsCovered: 1, targetAmount: 18000.4, currentSaved: 2999.6, monthlyExpenses: 3000 } },
    goals,
  });
  const behindInput = (over = {}) => {
    const now = new Date();
    const future = new Date(now.getFullYear(), now.getMonth() + 4, 1);
    const target_date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-01`;
    return {
      metrics: { monthly_income: 4000, monthly_expenses: 3000 },
      goals: [{ id: 'g1', name: 'Vacation', target: 5000, current: 500, monthly_contribution: 200, target_date, ...over }],
      accounts: [],
    };
  };

  it('offers a create_goal proposal on a thin emergency fund with no emergency goal', () => {
    const f = byId(computeAdvice(efInput()), 'emergency-fund-low');
    expect(f.proposal).toMatchObject({
      action: 'create_goal',
      params: { name: 'Emergency fund', target: 18000, current: 3000 },
      title: 'Create a goal "Emergency fund" for $18,000',
      verb: 'Create goal',
    });
    expect(f.proposal.fields.map((x) => x.label)).toEqual(['Target', 'Already saved', 'Covers']);
    expect(f.proposal.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('offers no proposal when an emergency goal already exists', () => {
    const f = byId(computeAdvice(efInput([{ id: 'e1', name: 'My Emergency Fund', target: 5000, current: 0 }])), 'emergency-fund-low');
    expect(f).toBeTruthy();
    expect(f.proposal).toBeUndefined();
  });

  it('offers an update_goal_contribution proposal on a goal behind pace', () => {
    const input = behindInput();
    const f = byId(computeAdvice(input), 'goal-behind-g1');
    expect(f.proposal.action).toBe('update_goal_contribution');
    expect(f.proposal.params).toEqual({ goal_id: 'g1', monthly_contribution: 1125 });
    expect(f.proposal.title).toBe('Raise "Vacation" to $1,125/mo');
    expect(f.proposal.fields[0]).toEqual({ label: 'Now', value: '$200/mo' });
  });

  it('drops a dismissed proposal only when the fingerprint matches, keeping the finding', () => {
    const input = behindInput();
    const fp = byId(computeAdvice(input), 'goal-behind-g1').proposal.fingerprint;
    const hit = byId(computeAdvice(input, { dismissed: { 'goal-behind-g1': fp } }), 'goal-behind-g1');
    expect(hit).toBeTruthy();
    expect(hit.proposal).toBeUndefined();
    const miss = byId(computeAdvice(input, { dismissed: { 'goal-behind-g1': 'deadbeefdeadbeef' } }), 'goal-behind-g1');
    expect(miss.proposal).toBeTruthy();
  });

  it('fingerprints are key-order independent and change with the data', () => {
    const a = byId(computeAdvice(behindInput()), 'goal-behind-g1').proposal.fingerprint;
    const reordered = behindInput();
    reordered.goals[0] = Object.fromEntries(Object.entries(reordered.goals[0]).reverse());
    expect(byId(computeAdvice(reordered), 'goal-behind-g1').proposal.fingerprint).toBe(a);
    expect(byId(computeAdvice(behindInput({ target: 6000 })), 'goal-behind-g1').proposal.fingerprint).not.toBe(a);
  });

  it('fingerprint hashes nested objects identically regardless of key order', () => {
    const x = { rule: 'r', nested: { b: 1, a: [{ d: 4, c: 3 }] }, z: null };
    const y = { z: null, nested: { a: [{ c: 3, d: 4 }], b: 1 }, rule: 'r' };
    expect(fingerprint(x)).toBe(fingerprint(y));
    expect(fingerprint(x)).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint({ ...x, z: 0 })).not.toBe(fingerprint(x));
  });

  it('fingerprint changes when the clock moves the proposed amount across a month boundary', () => {
    const input = { ...behindInput(), goals: [{ id: 'g1', name: 'Trip', target: 5000, current: 500, monthly_contribution: 200, target_date: '2027-03-01' }] };
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 31, 12, 0));
      const before = byId(computeAdvice(input), 'goal-behind-g1').proposal;
      vi.setSystemTime(new Date(2026, 10, 1, 12, 0));
      const after = byId(computeAdvice(input), 'goal-behind-g1').proposal;
      expect(after.params.monthly_contribution).not.toBe(before.params.monthly_contribution);
      expect(after.fingerprint).not.toBe(before.fingerprint);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('computeDigest', () => {
  it('leads with a positive headline when the week was net-positive', () => {
    const d = computeDigest({ weekOf: '2026-07-06', savedThisWeek: 420, spendThisWeek: 300, spendLastWeek: 500 });
    expect(d.headline).toMatch(/saved/i);
    expect(d.stats[0]).toMatchObject({ label: 'Saved this week', tone: 'good' });
  });

  it('calls out a negative week', () => {
    const d = computeDigest({ weekOf: '2026-07-06', savedThisWeek: -150, spendThisWeek: 900, spendLastWeek: 500 });
    expect(d.headline).toMatch(/more than you earned/i);
    expect(d.stats.find((s) => s.label.startsWith('Spending'))).toMatchObject({ tone: 'bad' });
  });

  it('includes at most two non-good findings', () => {
    const findings = [
      { id: 'a', severity: 'critical', title: 'A' },
      { id: 'b', severity: 'warn', title: 'B' },
      { id: 'c', severity: 'info', title: 'C' },
      { id: 'g', severity: 'good', title: 'G' },
    ];
    const d = computeDigest({ findings });
    expect(d.topFindings).toHaveLength(2);
    expect(d.topFindings.every((f) => f.severity !== 'good')).toBe(true);
  });
});
