// buildDefaults is a pure helper (no DOM/rendering needed) exported from
// ApplyConfirm.jsx specifically so it can be unit-tested without a React
// renderer — this repo carries no jsdom/RTL dependency (see
// tests/animatedNumber.test.mjs for the same pattern).
import { describe, it, expect } from 'vitest';
import { buildDefaults, usesSampleData } from '../src/components/money/sections/parts/learn/ApplyConfirm.jsx';

describe('ApplyConfirm.buildDefaults — add_recurring (C2)', () => {
  it('never seeds amount from largest_outflow\'s 90-day total', () => {
    // largest_outflow.amount is a SUM over 90 days (server/money/runway.js) —
    // e.g. $1,800/mo rent posted 3x in the window renders as $5,400. Seeding
    // that straight into a monthly recurring amount would silently write a
    // 3x-wrong bill the moment the user confirms without editing it.
    const variables = { largest_outflow: { value: { payee: 'Landlord LLC', amount: 5400 }, formatted: 'Landlord LLC — $5,400 over the last 90 days', grade: 'B', sample: false } };
    const defaults = buildDefaults('add_recurring', variables);
    expect(defaults.payee).toBe('Landlord LLC'); // payee name is safe to carry over
    expect(defaults.amount).toBe(''); // amount is left for the user to enter
  });

  it('leaves amount blank even with no data (sample largest_outflow)', () => {
    const variables = { largest_outflow: { value: { payee: 'Rent', amount: 1500 }, formatted: 'Rent — $1,500 over the last 90 days', grade: 'C', sample: true } };
    const defaults = buildDefaults('add_recurring', variables);
    expect(defaults.amount).toBe('');
  });

  it('leaves amount blank when there is no largest_outflow variable at all', () => {
    const defaults = buildDefaults('add_recurring', {});
    expect(defaults.payee).toBe('');
    expect(defaults.amount).toBe('');
  });
});

describe('ApplyConfirm.usesSampleData (C3)', () => {
  it('is true for add_recurring when largest_outflow is sample', () => {
    const variables = { largest_outflow: { value: { payee: 'Rent', amount: 1500 }, sample: true } };
    expect(usesSampleData('add_recurring', variables)).toBe(true);
  });

  it('is false for add_recurring when largest_outflow is real', () => {
    const variables = { largest_outflow: { value: { payee: 'Landlord LLC', amount: 1800 }, sample: false } };
    expect(usesSampleData('add_recurring', variables)).toBe(false);
  });

  it('is true for create_goal when either ef_target or monthly_surplus is sample', () => {
    const variables = { ef_target: { value: 12000, sample: false }, monthly_surplus: { value: 400, sample: true } };
    expect(usesSampleData('create_goal', variables)).toBe(true);
  });

  it('is false for an action with no personalized source variables (e.g. export_backup)', () => {
    expect(usesSampleData('export_backup', {})).toBe(false);
  });

  it('is false when variables is missing entirely (never throws)', () => {
    expect(usesSampleData('add_recurring', undefined)).toBe(false);
  });
});
