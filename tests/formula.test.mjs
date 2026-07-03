// Characterization tests for the custom-metric formula evaluator.
import { describe, it, expect } from 'vitest';
import { evalFormula } from '../src/lib/formula.js';

const VARS = { net_worth: 20000, savings_rate: 0.25, monthly_income: 5000 };

describe('evalFormula', () => {
  it('evaluates arithmetic over named variables', () => {
    expect(evalFormula('savings_rate * 100', VARS).value).toBe(25);
    expect(evalFormula('net_worth + monthly_income * 2', VARS).value).toBe(30000);
    expect(evalFormula('(net_worth + 1000) / 2', VARS).value).toBe(10500);
  });

  it('reports unknown variables as errors, not crashes', () => {
    const out = evalFormula('bogus_var * 2', VARS);
    expect(out.value == null).toBe(true);
    expect(out.error).toBeTruthy();
  });

  it('rejects anything outside the arithmetic grammar', () => {
    for (const evil of ['process.exit(1)', 'require("fs")', 'a=1', '1;2', 'window.alert(1)']) {
      const out = evalFormula(evil, VARS);
      expect(out.error, evil).toBeTruthy();
    }
  });

  it('handles division by zero without throwing', () => {
    const out = evalFormula('net_worth / 0', VARS);
    // Documents current behavior: Infinity or an error, but never a throw.
    expect(typeof out).toBe('object');
  });
});
