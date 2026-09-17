import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkContrast, contrast } from '../scripts/check-contrast.mjs';

describe('v3 tokens contrast gate', () => {
  it('computes WCAG ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
  });
  it('every text token clears 4.5:1 and every chart token 3:1 in both themes', () => {
    const css = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8');
    const { failures, rows } = checkContrast(css);
    expect(rows.length).toBeGreaterThan(60);
    expect(failures.map((f) => `${f.theme} ${f.a} on ${f.b} ${f.ratio.toFixed(2)}`)).toEqual([]);
  });
});
