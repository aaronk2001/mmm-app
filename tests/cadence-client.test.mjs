// Pins the client-side cadence normalizer against the same table the server
// uses (server/money/runway.js perMonth). Keep the two in step.
import { describe, it, expect } from 'vitest';
import { perMonth, perYear } from '../src/lib/cadence.js';

describe('perMonth', () => {
  it('leaves monthly as-is', () => {
    expect(perMonth(50, 'monthly')).toBe(50);
  });
  it('spreads weekly over 52/12', () => {
    expect(perMonth(100, 'weekly')).toBeCloseTo(433.33, 2);
  });
  it('spreads biweekly over 26/12', () => {
    expect(perMonth(100, 'biweekly')).toBeCloseTo(216.67, 2);
  });
  it('divides quarterly by 3', () => {
    expect(perMonth(600, 'quarterly')).toBe(200);
  });
  it('divides annual by 12', () => {
    expect(perMonth(1200, 'annual')).toBe(100);
  });
});

describe('perYear', () => {
  it('multiplies monthly-equivalent by 12', () => {
    expect(perYear(50, 'monthly')).toBe(600);
  });
  it('handles weekly', () => {
    expect(perYear(100, 'weekly')).toBeCloseTo(5200, 2);
  });
  it('handles biweekly', () => {
    expect(perYear(100, 'biweekly')).toBeCloseTo(2600, 2);
  });
  it('handles quarterly', () => {
    expect(perYear(600, 'quarterly')).toBe(2400);
  });
  it('handles annual', () => {
    expect(perYear(1200, 'annual')).toBe(1200);
  });
});
