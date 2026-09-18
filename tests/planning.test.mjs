import { describe, it, expect } from 'vitest';
import {
  TAX_YEAR, calcTakeHome, modelRaise, modelEmergencyFund,
  modelRothIra, modelNetWorth18mo, modelFireNumber, generateMilestones,
} from '../server/tools/planning.js';

// A realistic snapshot: $65k gross, $3,200/mo expenses, $10k liquid, $12k net worth.
const snap = () => ({
  context:  { state: 'AZ', current_net_worth: 12000, gap_period_weeks: 0 },
  income:   { current_gross: 65000 },
  expenses: { total_monthly: 3200 },
  assets:   { checking: 4000, savings: 6000, retirement: 0 },
  goals:    {},
  grade: 'A',
});

describe('calcTakeHome', () => {
  it('applies 2024 federal brackets, state tax and FICA', () => {
    const t = calcTakeHome(85000, 'AZ');
    expect(t.federal_tax).toBe(10541);
    expect(t.state_tax).toBe(2125);
    expect(t.fica).toBe(6503);
    expect(t.annual_take_home).toBe(65832);
    expect(t.monthly_take_home).toBe(5486);
    expect(t.effective_rate).toBe(22.6);
  });

  it('carries its tax year and a B grade so stale brackets are visible', () => {
    const t = calcTakeHome(85000, 'AZ');
    expect(t.tax_year).toBe(TAX_YEAR);
    expect(TAX_YEAR).toBe(2024);
    expect(t.grade).toBe('B');
  });

  it('zeroes state tax in a no-income-tax state', () => {
    expect(calcTakeHome(85000, 'TX').state_tax).toBe(0);
    expect(calcTakeHome(85000, 'tx').state_tax).toBe(0); // case-insensitive
  });

  it('falls back to a 5% blended rate for an unlisted state', () => {
    expect(calcTakeHome(100000, 'ME').state_tax).toBe(5000);
  });

  it('never taxes below the standard deduction', () => {
    const t = calcTakeHome(10000, 'AZ');
    expect(t.federal_tax).toBe(0);
    expect(t.annual_take_home).toBeGreaterThan(0);
  });

  it('returns zeros rather than NaN at zero income', () => {
    const t = calcTakeHome(0, 'AZ');
    expect(t.annual_take_home).toBe(0);
    expect(t.effective_rate).toBe(0);
  });
});

describe('modelRaise', () => {
  it('computes the monthly and annual delta between two salaries', () => {
    const r = modelRaise(snap(), 85000, 0);
    expect(r.needs_profile).toBe(false);
    expect(r.current_monthly_takehome).toBe(4355);
    expect(r.new_monthly_takehome).toBe(5486);
    expect(r.monthly_delta).toBe(1131);
    expect(r.annual_delta).toBe(13572);
    expect(r.net_12mo_gain).toBe(13572);
  });

  it('charges an unemployment gap against the first-year gain', () => {
    const r = modelRaise(snap(), 85000, 8);
    expect(r.gap_cost).toBe(Math.round(8 * (3200 / 4.33)));
    expect(r.net_12mo_gain).toBe(r.annual_delta - r.gap_cost);
  });

  it('allocates the raise to emergency fund, then Roth, then taxable', () => {
    const r = modelRaise(snap(), 120000, 0);
    expect(r.allocation_plan.map((a) => a.goal)).toEqual([
      'Emergency Fund', 'Roth IRA', 'Taxable Investments / Savings',
    ]);
  });

  // Ruling R6: one source of truth for the emergency-fund timeline.
  it('reports months_to_emergency_fund from the allocation plan', () => {
    const r = modelRaise(snap(), 85000, 0);
    const ef = r.allocation_plan.find((a) => a.goal === 'Emergency Fund');
    expect(r.months_to_emergency_fund).toBe(ef.months_to_goal);
  });

  // Ruling R5: never fabricate a current salary.
  it('flags a missing profile instead of assuming $65k', () => {
    const s = snap();
    s.income.current_gross = null;
    const r = modelRaise(s, 85000, 0);
    expect(r.needs_profile).toBe(true);
    expect(r.monthly_delta).toBeNull();
  });

  it('reports a pay cut as a negative delta without crashing', () => {
    const r = modelRaise(snap(), 45000, 0);
    expect(r.monthly_delta).toBeLessThan(0);
    expect(r.allocation_plan).toEqual([]);
  });
});

describe('modelEmergencyFund', () => {
  // Ruling R4: surplus comes from calcTakeHome, not a hardcoded 0.74 factor.
  it('derives the monthly surplus from real take-home math', () => {
    const e = modelEmergencyFund(snap());
    expect(e.estimated_monthly_surplus).toBe(calcTakeHome(65000, 'AZ').monthly_take_home - 3200);
    expect(e.estimated_monthly_surplus).toBe(1155);
    expect(e.months_to_6mo_goal).toBe(8);
  });

  it('sizes the 3- and 6-month targets and the funded percentage', () => {
    const e = modelEmergencyFund(snap());
    expect(e.current_liquid).toBe(10000);
    expect(e.target_3mo).toBe(9600);
    expect(e.target_6mo).toBe(19200);
    expect(e.deficit_to_6mo).toBe(9200);
    expect(e.current_months_covered).toBe(3.1);
    expect(e.funded_pct).toBe(52);
  });

  it('returns null months when there is no surplus', () => {
    const s = snap();
    s.expenses.total_monthly = 9000;
    expect(modelEmergencyFund(s).months_to_6mo_goal).toBeNull();
  });

  it('reports zero coverage rather than Infinity at zero expenses', () => {
    const s = snap();
    s.expenses.total_monthly = 0;
    const e = modelEmergencyFund(s);
    expect(Number.isFinite(e.current_months_covered)).toBe(true);
    expect(e.funded_pct).toBe(0);
  });
});

describe('modelRothIra', () => {
  it('compounds an annual contribution to retirement', () => {
    const r = modelRothIra(7000, 30, 65, 0.07);
    expect(r.years).toBe(35);
    expect(r.balance_at_retirement).toBe(1035394);
    expect(r.total_contributions).toBe(245000);
    expect(r.investment_growth).toBe(790394);
    expect(r.monthly_contribution).toBe(583);
  });

  it('caps the contribution at the IRS limit and says which year', () => {
    const r = modelRothIra(20000, 30, 65);
    expect(r.annual_contribution).toBe(7000);
    expect(r.irs_limit).toBe(7000);
    expect(r.tax_year).toBe(TAX_YEAR);
  });

  // Ruling R8.
  it('formats the assumed rate without float noise', () => {
    expect(modelRothIra(7000, 30, 65, 0.07).assumed_rate).toBe('7%');
  });

  it('returns a zero balance when retirement is not in the future', () => {
    expect(modelRothIra(7000, 65, 65).balance_at_retirement).toBe(0);
  });
});

describe('modelNetWorth18mo', () => {
  it('projects 18 rows of net worth from the savings rate', () => {
    const n = modelNetWorth18mo(snap(), 85000, 0.30);
    expect(n.timeline).toHaveLength(18);
    expect(n.monthly_save).toBe(686);
    expect(n.timeline[0]).toEqual({ month: 1, net_worth: 12686, monthly_save: 686 });
    expect(n.final_net_worth).toBe(24344);
  });

  it('subtracts the gap cost before the first month', () => {
    const s = snap();
    s.context.gap_period_weeks = 4;
    const n = modelNetWorth18mo(s, 85000, 0.30);
    expect(n.gap_cost).toBe(Math.round((3200 / 4.33) * 4));
    expect(n.timeline[0].net_worth).toBeLessThan(12686);
  });

  it('reports the month the target is reached, or null', () => {
    const s = snap();
    s.goals.target_net_worth_18mo = 20000;
    expect(modelNetWorth18mo(s, 85000, 0.30).months_to_target).toBe(12);
    expect(modelNetWorth18mo(snap(), 85000, 0.30).months_to_target).toBeNull(); // default 35000 target
  });
});

describe('modelFireNumber', () => {
  it('applies the 25x rule', () => {
    const f = modelFireNumber(snap());
    expect(f.annual_expenses).toBe(38400);
    expect(f.fire_number).toBe(960000);
    expect(f.deficit_to_fire).toBe(948000);
    expect(f.funded_pct).toBe(1);
  });

  it('reports zero rather than NaN with no expenses', () => {
    const s = snap();
    s.expenses.total_monthly = 0;
    expect(modelFireNumber(s).funded_pct).toBe(0);
  });
});

describe('generateMilestones', () => {
  it('emits the 6/12/18-month checkpoints in order', () => {
    const { timeline } = modelNetWorth18mo(snap(), 85000, 0.30);
    const ms = generateMilestones(timeline, snap());
    const checkpoints = ms.filter((m) => m.type === 'net_worth').map((m) => m.month);
    expect(checkpoints).toEqual([6, 12, 18]);
    expect(ms.map((m) => m.month)).toEqual([...ms.map((m) => m.month)].sort((a, b) => a - b));
  });

  it('emits a Roth milestone once the cumulative saving clears the limit', () => {
    const { timeline } = modelNetWorth18mo(snap(), 85000, 0.30);
    const ms = generateMilestones(timeline, snap());
    expect(ms.filter((m) => m.type === 'roth_ira')).toHaveLength(1);
  });

  it('skips the emergency-fund milestone when it is already funded', () => {
    const s = snap();
    s.assets.savings = 60000;
    const { timeline } = modelNetWorth18mo(s, 85000, 0.30);
    expect(generateMilestones(timeline, s).some((m) => m.type === 'emergency_fund')).toBe(false);
  });
});
