// The strict money boundary (server/money/amounts.js) and the shared account
// types it pairs with at the repo layer.
import { describe, it, expect } from 'vitest';
import amounts from '../server/money/amounts.js';
import types from '../server/money/account-types.js';
import v from '../server/middleware/validators.js';

const { parseMoney, toCents, MAX_ABS_DOLLARS } = amounts;

describe('parseMoney', () => {
  it('accepts plain decimals as numbers or strings', () => {
    expect(parseMoney(12.5)).toBe(12.5);
    expect(parseMoney('12.50')).toBe(12.5);
    expect(parseMoney(' -3 ')).toBe(-3);
    expect(parseMoney('.5')).toBe(0.5);
    expect(parseMoney('+7.')).toBe(7);
  });

  it('refuses what parseFloat used to wave through', () => {
    for (const bad of ['12abc', '1,234.56', '$5', '(12.00)', '5e16', 'abc', '', ' ', null, undefined, true, {}, NaN, Infinity]) {
      expect(parseMoney(bad)).toBeNull();
    }
  });

  it('bounds magnitude so cents can never overflow int64 sums', () => {
    expect(parseMoney(MAX_ABS_DOLLARS)).toBe(MAX_ABS_DOLLARS);
    expect(parseMoney(-MAX_ABS_DOLLARS)).toBe(-MAX_ABS_DOLLARS);
    expect(parseMoney(MAX_ABS_DOLLARS * 10)).toBeNull();
    expect(parseMoney('1e308')).toBeNull();
    expect(parseMoney(1e308)).toBeNull();
  });
});

describe('toCents', () => {
  it('rounds half away from zero on both signs, despite binary floats', () => {
    expect(toCents(1.005)).toBe(101);
    expect(toCents('1.005')).toBe(101);
    expect(toCents(10.125)).toBe(1013);
    expect(toCents(-10.125)).toBe(-1013);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(-0.004)).toBe(0);
    expect(Object.is(toCents(-0.001), -0)).toBe(false);
  });

  it('treats blank as zero and throws a 400 on anything invalid', () => {
    expect(toCents(undefined)).toBe(0);
    expect(toCents(null)).toBe(0);
    expect(toCents('')).toBe(0);
    for (const bad of ['12abc', '5e16', 1e308, NaN]) {
      expect(() => toCents(bad)).toThrow(/Invalid amount/);
      try { toCents(bad); } catch (e) { expect(e.status).toBe(400); }
    }
  });
});

describe('account types', () => {
  it('stores liabilities negative however the amount owed was typed', () => {
    expect(types.normalizeBalance('credit', 2000)).toBe(-2000);
    expect(types.normalizeBalance('loan', '-18500')).toBe(-18500);
    expect(types.normalizeBalance('checking', -50)).toBe(-50); // overdraft stays
    expect(types.normalizeBalance('credit', undefined)).toBeUndefined();
  });

  it('counts a liability as owed in net worth whatever its stored sign', () => {
    expect(types.signedBalance({ type: 'credit', balance: 2000 })).toBe(-2000);
    expect(types.signedBalance({ type: 'credit', balance: -2000 })).toBe(-2000);
    expect(types.signedBalance({ type: 'savings', balance: 900 })).toBe(900);
  });

  it('is the same list the validator enforces — every type the form offers is accepted', () => {
    for (const type of ['brokerage', 'retirement', 'crypto', 'real_estate', 'vehicle', 'checking', 'savings']) {
      expect(v.validateAccount({ name: 'x', type }).valid).toBe(true);
    }
    expect(v.validateAccount({ name: 'x', type: 'yacht' }).valid).toBe(false);
  });
});

describe('validators tightened at the boundary', () => {
  it('rejects garbage amounts', () => {
    expect(v.validateTransaction({ account_id: 'a', date: '2026-09-01', amount: '12abc' }).valid).toBe(false);
    expect(v.validateTransaction({ account_id: 'a', date: '2026-09-01', amount: '5e16' }).valid).toBe(false);
  });

  it('rejects out-of-range years (a 2-digit year typed into a date input)', () => {
    expect(v.validateRecurring({ payee: 'Rent', amount: 1850, cadence: 'monthly', kind: 'bill', next_date: '0026-10-01' }).valid).toBe(false);
    expect(v.validateRecurring({ payee: 'Rent', amount: 1850, cadence: 'monthly', kind: 'bill', next_date: '2026-10-01' }).valid).toBe(true);
  });

  it('refuses to detach a transaction from its account', () => {
    expect(v.validateTransaction({ account_id: null }, { partial: true }).valid).toBe(false);
    expect(v.validateTransaction({ account_id: '' }, { partial: true }).valid).toBe(false);
  });

  it('takes APR as a fraction and a non-negative minimum payment', () => {
    expect(v.validateAccount({ name: 'Card', type: 'credit', apr: 0.2499, min_payment: 35 }).valid).toBe(true);
    expect(v.validateAccount({ name: 'Card', type: 'credit', apr: 24.99 }).errors[0]).toMatch(/fraction/);
    expect(v.validateAccount({ name: 'Card', type: 'credit', min_payment: -1 }).valid).toBe(false);
    expect(v.validateAccount({ name: 'Card', type: 'credit', apr: null, min_payment: '' }).valid).toBe(true);
  });
});
