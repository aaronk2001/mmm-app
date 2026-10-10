import { describe, it, expect } from 'vitest';
import { requiredAnnualReturn, assessReturn, requiredReturnFor } from '../src/components/money/sections/parts/goals/requiredReturn.js';

const fv = (current, monthly, n, i) =>
  i === 0 ? current + monthly * n : current * (1 + i) ** n + monthly * (((1 + i) ** n - 1) / i);

describe('requiredAnnualReturn', () => {
  it('is 0 when contributions alone reach the target', () => {
    expect(requiredAnnualReturn(10000, 500, 20000, 5)).toBe(0);
  });

  it('solves for a rate that lands on the target', () => {
    const r = requiredAnnualReturn(10000, 500, 100000, 10);
    expect(typeof r).toBe('number');
    const i = (1 + r) ** (1 / 12) - 1;
    expect(Math.abs(fv(10000, 500, 120, i) - 100000) / 100000).toBeLessThan(0.005);
  });

  it('is null when even 100% a month cannot reach it', () => {
    expect(requiredAnnualReturn(0, 1, 1e9, 1)).toBeNull();
  });

  it('is null for non-positive years', () => {
    expect(requiredAnnualReturn(1000, 100, 5000, 0)).toBeNull();
  });
});

describe('assessReturn', () => {
  const cases = [
    [null, 'bad', 'Unreachable at this pace. Raise the contribution or push the date.'],
    [0, 'good', 'On track without any investment growth.'],
    [0.04, 'good', 'Conservative: feasible with a low-risk allocation.'],
    [0.0401, 'info', 'Moderate: in line with a diversified long-term portfolio.'],
    [0.08, 'info', 'Moderate: in line with a diversified long-term portfolio.'],
    [0.12, 'warn', 'Aggressive: high risk, not guaranteed.'],
    [0.2, 'bad', 'Unrealistic: extend the date, raise contributions, or lower the target.'],
  ];
  it.each(cases)('%s', (r, tone, text) => {
    expect(assessReturn(r)).toEqual({ tone, text });
  });
});

describe('requiredReturnFor', () => {
  const today = new Date(2026, 9, 10);

  it('flags a passed target date', () => {
    const out = requiredReturnFor({ current: 100, monthly: 10, target: 1000, targetDate: '2026-01-01', today });
    expect(out.annualReturn).toBeNull();
    expect(out.assessment).toEqual({ tone: 'warn', text: 'Target date has passed.' });
  });

  it('is null without a target date', () => {
    expect(requiredReturnFor({ current: 100, monthly: 10, target: 1000, today })).toBeNull();
  });

  it('is null when the target is already met', () => {
    expect(requiredReturnFor({ current: 1000, monthly: 10, target: 1000, targetDate: '2030-01-01', today })).toBeNull();
    expect(requiredReturnFor({ current: 100, monthly: 10, target: 0, targetDate: '2030-01-01', today })).toBeNull();
  });

  it('computes years and a rate for a future date', () => {
    const out = requiredReturnFor({ current: 10000, monthly: 500, target: 100000, targetDate: '2036-10-10', today });
    expect(out.years).toBeGreaterThan(9.9);
    expect(out.annualReturn).toBeGreaterThan(0);
  });
});
