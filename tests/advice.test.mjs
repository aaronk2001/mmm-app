// Unit tests for the deterministic advice engine. Pure function → synthetic
// inputs, no DB. Locks the rule behavior the LLM coach is grounded on.
import { describe, it, expect } from 'vitest';
import advice from '../server/money/advice.js';

const { computeAdvice, computeDigest } = advice;
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
