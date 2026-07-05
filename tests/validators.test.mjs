// Regression tests for the adversarial-review findings on the Phase-2 validators.
import { describe, it, expect } from 'vitest';
import v from '../server/middleware/validators.js';

describe('impossible calendar dates are rejected (Date.parse normalization)', () => {
  it.each(['2026-02-30', '2026-04-31', '2027-02-29', '2026-13-01', '2026-00-10'])('%s -> invalid', (date) => {
    expect(v.validateTransaction({ account_id: 'a', date, amount: 1 }).valid).toBe(false);
  });

  it.each(['2026-07-04', '2028-02-29', '2026-12-31'])('%s -> valid (incl. leap day)', (date) => {
    expect(v.validateTransaction({ account_id: 'a', date, amount: 1 }).valid).toBe(true);
  });

  it('applies to recurring next_date and goal target_date too', () => {
    expect(v.validateRecurring({ payee: 'x', amount: 1, cadence: 'monthly', kind: 'bill', next_date: '2026-02-30' }).valid).toBe(false);
    expect(v.validateGoal({ name: 'g', target: 100, target_date: '2026-04-31' }).valid).toBe(false);
  });
});

describe('custom object size cap', () => {
  it('rejects custom payloads over 16 KB', () => {
    const big = { blob: 'x'.repeat(20 * 1024) };
    expect(v.validateAccount({ name: 'A', type: 'checking', custom: big }).valid).toBe(false);
    expect(v.validateTransaction({ account_id: 'a', date: '2026-07-04', amount: 1, custom: big }).valid).toBe(false);
  });

  it('accepts normal metadata-sized custom objects', () => {
    expect(v.validateAccount({ name: 'A', type: 'checking', custom: { risk: 'low', joint: true } }).valid).toBe(true);
  });
});

describe('bulk ids validation', () => {
  it('rejects missing / empty / non-array ids', () => {
    expect(v.validateBulkIds({}).valid).toBe(false);
    expect(v.validateBulkIds({ ids: [] }).valid).toBe(false);
    expect(v.validateBulkIds({ ids: 'x' }).valid).toBe(false);
    expect(v.validateBulkIds({ ids: ['t1'] }).valid).toBe(true);
  });
});

describe('import row validation', () => {
  it('rejects rows with non-numeric amounts', () => {
    expect(v.validateImport({ account_id: 'a', rows: [{ date: '2026-07-01', amount: 'lots' }] }).valid).toBe(false);
    expect(v.validateImport({ account_id: 'a', rows: [{ date: '2026-07-01', amount: -5 }] }).valid).toBe(true);
  });
});
