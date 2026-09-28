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

// Deliberate re-pin (finding #11): the model moved from 2024 single-filer
// brackets, uncapped FICA and flat state rates on gross to the 2026 tables
// (sources in server/tools/planning.js). Every expected figure below is worked
// by hand in the comment next to it.
describe('calcTakeHome', () => {
  it('applies 2026 federal brackets, state tax and FICA', () => {
    const t = calcTakeHome(85000, 'AZ');
    // taxable = 85,000 - 16,100 = 68,900
    // federal = 10% x 12,400 + 12% x 38,000 + 22% x 18,500 = 1,240 + 4,560 + 4,070
    expect(t.federal_tax).toBe(9870);
    expect(t.state_tax).toBe(1723);            // AZ 2.5% x 68,900 (federal std. deduction)
    expect(t.fica).toBe(6503);                 // 6.2% x 85,000 + 1.45% x 85,000
    expect(t.annual_take_home).toBe(66905);
    expect(t.monthly_take_home).toBe(5575);
    expect(t.effective_rate).toBe(21.3);
    expect(t).toMatchObject({ state: 'AZ', state_tax_estimated: true, state_tax_basis: 'flat', filing_status: 'single' });
  });

  it('carries its tax year and a B grade so stale brackets are visible', () => {
    const t = calcTakeHome(85000, 'AZ');
    expect(t.tax_year).toBe(TAX_YEAR);
    expect(TAX_YEAR).toBe(2026);
    expect(t.grade).toBe('B');
  });

  it('uses the filing status it is given', () => {
    // $120k: single taxable 103,900 -> 1,240 + 4,560 + 22% x 53,500 = 17,570
    expect(calcTakeHome(120000, 'TX').federal_tax).toBe(17570);
    // married jointly: taxable 87,800 -> 10% x 24,800 + 12% x 63,000 = 10,040
    expect(calcTakeHome(120000, 'TX', 'married_joint').federal_tax).toBe(10040);
    // head of household $80k: taxable 55,850 -> 10% x 17,700 + 12% x 38,150 = 6,348
    expect(calcTakeHome(80000, 'TX', 'head_of_household').federal_tax).toBe(6348);
    // married separately hits 37% above $384,350 (single: $640,600)
    expect(calcTakeHome(450000, 'TX', 'married_separate').federal_tax).toBe(121625);
    expect(calcTakeHome(450000, 'TX').federal_tax).toBe(120634);
    expect(calcTakeHome(60000, 'TX', 'nonsense').filing_status).toBe('single');
  });

  it('caps Social Security at the 2026 wage base and adds the 0.9% Additional Medicare Tax', () => {
    // 6.2% x 184,500 = 11,439; 1.45% x 300,000 = 4,350; 0.9% x (300,000 - 200,000) = 900
    expect(calcTakeHome(300000, 'TX').fica).toBe(16689); // was 22,950 (7.65% of everything)
    expect(calcTakeHome(300000, 'TX', 'married_joint').fica).toBe(16239); // threshold $250k
    expect(calcTakeHome(300000, 'TX', 'married_separate').fica).toBe(17364); // threshold $125k
  });

  it('zeroes state tax in every no-income-tax state', () => {
    for (const st of ['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY']) {
      expect(calcTakeHome(60000, st)).toMatchObject({ state_tax: 0, state_tax_basis: 'no_income_tax' });
    }
    expect(calcTakeHome(85000, 'tx').state_tax).toBe(0); // case-insensitive
  });

  it('estimates California from its brackets, not 9.3% of gross', () => {
    // CA taxable 50,000 - 5,706 = 44,294 -> 110.79 + 303.70 + 607.52 + 170.52 = 1,192.53, less the $153 credit
    expect(calcTakeHome(50000, 'CA')).toMatchObject({ state_tax: 1040, state_tax_basis: 'brackets', state_tax_estimated: true, state_tax_year: 2025 });
    expect(calcTakeHome(80000, 'CA', 'head_of_household').state_tax_note).toMatch(/single-filer schedule/);
  });

  it('applies the flat-rate states to their own base', () => {
    expect(calcTakeHome(100000, 'IL', 'married_joint').state_tax).toBe(4660); // 4.95% x (100,000 - 2 x 2,925)
    expect(calcTakeHome(100000, 'CO').state_tax).toBe(3692);                  // 4.4% x 83,900 federal taxable
  });

  it('flags an unset or unmodelled state instead of guessing', () => {
    expect(calcTakeHome(60000)).toMatchObject({ state: null, state_tax: 0, state_tax_basis: 'no_state', state_tax_estimated: false });
    // Deliberate change: an unlisted state used to be charged a 5% "blended" rate.
    expect(calcTakeHome(100000, 'ME')).toMatchObject({ state: 'ME', state_tax: 0, state_tax_basis: 'not_modeled', state_tax_estimated: false });
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
    expect(r.current_monthly_takehome).toBe(4432); // 2026 tables (was 4,355 on 2024's)
    expect(r.new_monthly_takehome).toBe(5575);
    expect(r.monthly_delta).toBe(1143);
    expect(r.annual_delta).toBe(13716);
    expect(r.net_12mo_gain).toBe(13716);
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
    expect(e.estimated_monthly_surplus).toBe(1232); // 4,432 - 3,200 on the 2026 tables
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
    expect(r.annual_contribution).toBe(7500); // 2026 limit (IRS Notice 2025-67)
    expect(r.irs_limit).toBe(7500);
    expect(r.tax_year).toBe(TAX_YEAR);
  });

  it('adds the $1,100 catch-up from age 50', () => {
    const r = modelRothIra(20000, 48, 52, 0);
    expect(r.catch_up_limit).toBe(1100);
    expect(r.total_contributions).toBe(7500 * 2 + 8600 * 2); // ages 48, 49 then 50, 51
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
    expect(n.monthly_save).toBe(713); // (5,575 - 3,200) x 0.30 = 712.5
    expect(n.timeline[0]).toEqual({ month: 1, net_worth: 12713, monthly_save: 713 });
    expect(n.final_net_worth).toBe(24825); // 12,000 + 18 x 712.5
  });

  it('subtracts the gap cost before the first month', () => {
    const s = snap();
    s.context.gap_period_weeks = 4;
    const n = modelNetWorth18mo(s, 85000, 0.30);
    expect(n.gap_cost).toBe(Math.round((3200 / 4.33) * 4));
    expect(n.timeline[0].net_worth).toBeLessThan(12713);
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
