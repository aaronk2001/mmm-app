import { describe, it, expect } from 'vitest';
import { profileFromMmm, validateProfile, PROFILE_FIELDS } from '../server/tools/profile.js';

const data = () => ({
  accounts: [
    { id: 'a1', name: 'Checking',  type: 'checking',   balance: 4000 },
    { id: 'a2', name: 'Savings',   type: 'savings',    balance: 6000 },
    { id: 'a3', name: 'Cash',      type: 'cash',       balance: 200 },
    { id: 'a4', name: '401k',      type: 'investment', balance: 18000 },
    { id: 'a5', name: 'Visa',      type: 'credit',     balance: -2500 },
    { id: 'a6', name: 'Car loan',  type: 'loan',       balance: -11000 },
  ],
  transactions: [],
  // NOTE: repo.readAll() converts amount_cents -> `amount` in DOLLARS before
  // any consumer sees a recurring row (server/db/repo.js rowRecurring). Every
  // fixture here and in Task 5 uses `amount`, matching tests/runway.test.mjs.
  recurring: [
    { id: 'r1', payee: 'Rent',     amount: 1400,  cadence: 'monthly',   kind: 'bill' },
    { id: 'r2', payee: 'Netflix',  amount: 15.99, cadence: 'monthly',   kind: 'bill' },
    { id: 'r3', payee: 'Car ins',  amount: 600,   cadence: 'quarterly', kind: 'bill' },
    { id: 'r4', payee: 'Paycheck', amount: 2500,  cadence: 'biweekly',  kind: 'income' },
  ],
  categories: [],
  goals: [],
});

describe('profileFromMmm', () => {
  it('derives liquid and retirement assets from real account types', () => {
    const s = profileFromMmm(data(), { profile: { gross_salary: 65000, state: 'AZ' } });
    expect(s.assets.checking).toBe(4000);
    expect(s.assets.savings).toBe(6200);       // savings + cash
    expect(s.assets.retirement).toBe(18000);
  });

  it('nets liabilities into current_net_worth', () => {
    const s = profileFromMmm(data(), { profile: { gross_salary: 65000 } });
    expect(s.context.current_net_worth).toBe(4000 + 6000 + 200 + 18000 - 2500 - 11000);
  });

  it('normalizes every recurring bill cadence into a monthly expense total', () => {
    const s = profileFromMmm(data(), { profile: {} });
    // 1400 + 15.99 + (600 / 3) = 1615.99
    expect(s.expenses.total_monthly).toBeCloseTo(1615.99, 2);
  });

  it('carries the declared salary and state through', () => {
    const s = profileFromMmm(data(), { profile: { gross_salary: 85000, state: 'TX' } });
    expect(s.income.current_gross).toBe(85000);
    expect(s.context.state).toBe('TX');
  });

  it('leaves current_gross null rather than guessing when undeclared', () => {
    const s = profileFromMmm(data(), {});
    expect(s.income.current_gross).toBeNull();
  });

  it('defaults the state to AZ and never re-types an account', () => {
    const d = data();
    const s = profileFromMmm(d, {});
    expect(s.context.state).toBe('AZ');
    expect(d.accounts.map((a) => a.type)).toEqual(
      ['checking', 'savings', 'cash', 'investment', 'credit', 'loan']);
  });

  it('grades A with a declared salary and real accounts, C with neither', () => {
    expect(profileFromMmm(data(), { profile: { gross_salary: 65000 } }).grade).toBe('A');
    expect(profileFromMmm({ accounts: [], transactions: [], recurring: [], categories: [], goals: [] }, {}).grade).toBe('C');
  });

  it('survives an empty database without throwing', () => {
    const s = profileFromMmm({ accounts: [], transactions: [], recurring: [], categories: [], goals: [] }, {});
    expect(s.expenses.total_monthly).toBe(0);
    expect(s.context.current_net_worth).toBe(0);
  });
});

describe('validateProfile', () => {
  it('accepts a full valid profile', () => {
    const r = validateProfile({
      name: 'Alex', age: 24, state: 'AZ', filing_status: 'single', gross_salary: 65000,
      employment_status: 'employed', income_end_date: null, retirement_age: 65, risk_tolerance: 'moderate',
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects an out-of-range age and a bad filing status', () => {
    const r = validateProfile({ age: 300, filing_status: 'nope' });
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
  });

  it('rejects a non-YYYY-MM-DD income_end_date', () => {
    expect(validateProfile({ income_end_date: '11/02/2026' }).ok).toBe(false);
  });

  it('drops unknown keys instead of persisting them', () => {
    const r = validateProfile({ name: 'Alex', ssn: '000-00-0000' });
    expect(r.value.ssn).toBeUndefined();
    expect(Object.keys(r.value)).toEqual(['name']);
  });

  it('exposes the field order the intake UI renders', () => {
    expect(PROFILE_FIELDS[0]).toBe('name');
    expect(PROFILE_FIELDS).toContain('gross_salary');
    expect(PROFILE_FIELDS).toHaveLength(9);
  });
});
