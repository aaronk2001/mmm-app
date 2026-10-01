// Research — the grounding check. A figure in the answer is grounded only if a
// tool returned it (to the precision the answer states it), the user wrote it,
// or it's a bare small count. IDs, URLs and day/month parts of dates can't
// ground anything.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkGrounding } = require('../server/research/grounding.js');

const tool = [
  { years: [{ fiscal_year_end: '2025-06-30', free_cash_flow: 71_611_000_000 }], growth: { free_cash_flow_yoy_pct: [null, -3.4] } },
  { gross_margin_pct: 68.82, market_cap_usd: 3_050_000_000_000, url: 'https://x.com/a/77', id: 4411 },
];

describe('checkGrounding', () => {
  it.each([
    'FCF was $71.6B in FY2025 [1].',
    'FCF was $71.61 billion [1].',
    'FCF was $72B.',
    'FCF fell 3.4% year over year.',
    'Gross margin is 68.8% [2].',
    'Market cap is about $3.05 trillion.',
    'It has 3 segments and 2 risks.',
  ])('grounded: %s', (a) => expect(checkGrounding(a, tool)).toEqual({ grounded: true, ungrounded: [] }));

  it.each([
    ['FCF was $75B.', '$75B'],
    ['FCF fell 4.1%.', '4.1%'],
    ['Margins expanded to 70%.', '70%'],
    ['P/E is 32.5.', '32.5'],
    ['Revenue hit $1,234,567.', '$1,234,567'],
    ['A 30% upside.', '30%'],
    ['Up 77% since.', '77%'],
    ['Ticket 4411 says so.', '4411'],
  ])('flags %s', (a, fig) => {
    const r = checkGrounding(a, tool);
    expect(r.grounded).toBe(false);
    expect(r.ungrounded).toEqual([fig]);
  });

  // Review finding I2: ordinary dates and hyphenated words were flagged as
  // unverified figures on otherwise correct answers.
  const quote = [{ price: 410.5, as_of: '2026-09-30 14:05' }, { date: '2026-09-28', headline: 'h' }];
  it.each([
    'Price was 410.5 as of 2026-09-30 14:05 [1].',
    'News on 2026-09-28 [2].',
    'Trailing 12-month P/E is not available.',
    'It sits below its 52-week high.',
    'Demand recovered after COVID-19.',
  ])('not flagged: %s', (a) => expect(checkGrounding(a, quote)).toEqual({ grounded: true, ungrounded: [] }));

  it('a date the tools never returned still flags its year', () => {
    expect(checkGrounding('As of 2019-01-01.', quote).ungrounded).toEqual(['2019']);
  });

  it('allows numbers the user wrote', () => {
    expect(checkGrounding('Above your 15% hurdle.', tool, 'is it above a 15% hurdle?').grounded).toBe(true);
  });

  it('no figures → grounded', () => expect(checkGrounding('Quality business.', []).grounded).toBe(true));
});
