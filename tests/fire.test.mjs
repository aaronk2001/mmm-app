// FIRE projection (finding #18). The old estimate divided the gap to the FIRE
// number by 1.1x a year's savings: it ignored growth on what's already
// invested, went negative once the target was met, and reported
// progressPct = Infinity when there was no expense history.
import { describe, it, expect } from 'vitest';
import calc from '../server/money/calc.js';

const { projectYearsToFire, FIRE_REAL_RETURN, computeGoalInsights, localDate } = calc;

describe('projectYearsToFire', () => {
  it('compounds the existing portfolio as well as new savings', () => {
    // W(1+r)^n + S((1+r)^n - 1)/r = F with W = 500k, S = 24k/yr, F = 1.2M, r = 5%:
    // n = ln((1.2M + 480k) / (500k + 480k)) / ln(1.05) = ln(1.7143) / 0.04879 = 11.05
    expect(projectYearsToFire({ fireNumber: 1200000, netWorth: 500000, annualSavings: 24000 })).toBe(11);
    expect(FIRE_REAL_RETURN).toBe(0.05);
  });

  it('takes the return as an override', () => {
    const slow = projectYearsToFire({ fireNumber: 1200000, netWorth: 500000, annualSavings: 24000, realReturn: 0.03 });
    const fast = projectYearsToFire({ fireNumber: 1200000, netWorth: 500000, annualSavings: 24000, realReturn: 0.07 });
    expect(slow).toBeGreaterThan(11);
    expect(fast).toBeLessThan(11);
    // With no growth it is plain arithmetic: 1.2M / 24k.
    expect(projectYearsToFire({ fireNumber: 1200000, netWorth: 0, annualSavings: 24000, realReturn: 0 })).toBe(50);
  });

  it('is 0 once the target is met (was negative)', () => {
    expect(projectYearsToFire({ fireNumber: 1200000, netWorth: 2000000, annualSavings: 24000 })).toBe(0);
  });

  it('is null with no target, or when the target is out of reach', () => {
    expect(projectYearsToFire({ fireNumber: 0, netWorth: 1000, annualSavings: 0 })).toBeNull();
    expect(projectYearsToFire({ fireNumber: 1200000, netWorth: -50000, annualSavings: 0 })).toBeNull();
    expect(projectYearsToFire({ fireNumber: 1200000, netWorth: 100000, annualSavings: -10000 })).toBeNull();
    expect(projectYearsToFire({ fireNumber: 1e9, netWorth: 1, annualSavings: 1 })).toBeNull(); // > 100 years
  });

  it('still reaches the target on growth alone when drawing down slower than it grows', () => {
    // 500k at 5% grows 25k/yr; spending 10k/yr more than earned still gets there.
    expect(projectYearsToFire({ fireNumber: 1200000, netWorth: 500000, annualSavings: -10000 })).toBeCloseTo(24.7, 1);
  });
});

describe('computeGoalInsights FIRE block', () => {
  const recent = (n) => localDate(-n);

  it('reports progress and years with the compound-growth projection', () => {
    const txns = [
      { date: recent(10), amount: 6000 }, { date: recent(40), amount: 6000 },
      { date: recent(12), amount: -4000 }, { date: recent(42), amount: -4000 },
    ];
    const g = computeGoalInsights([{ type: 'investment', balance: 500000 }], txns, []);
    expect(g.fire.fireNumber).toBe(1200000);     // 4,000/mo x 12 x 25
    expect(g.fire.progressPct).toBe(41.7);
    expect(g.fire.yearsToFire).toBe(11);          // was 26.5
    expect(g.fire.realReturn).toBe(0.05);
  });

  it('says 0 years, not a negative number, when already past the target', () => {
    const txns = [{ date: recent(10), amount: -4000 }, { date: recent(40), amount: -4000 }];
    const g = computeGoalInsights([{ type: 'investment', balance: 2000000 }], txns, []);
    expect(g.fire.yearsToFire).toBe(0);           // was -30.3
    expect(g.fire.progressPct).toBe(166.7);
  });

  it('reports null progress, not Infinity, with no expense history', () => {
    const g = computeGoalInsights([{ type: 'checking', balance: 1000 }], [], []);
    expect(g.fire.fireNumber).toBe(0);
    expect(g.fire.progressPct).toBeNull();
    expect(g.fire.yearsToFire).toBeNull();
    expect(JSON.parse(JSON.stringify(g)).fire.progressPct).toBeNull();
  });
});
