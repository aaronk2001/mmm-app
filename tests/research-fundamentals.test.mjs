// Research — annual financials shape and the Yahoo fundamentals provider.
// Growth figures are computed here in code (hand-computed expectations below)
// so the research model only ever quotes them, never derives them.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { db } from '../server/db/connection.js';
import repo from '../server/db/repo.js';

const require = createRequire(import.meta.url);
const { withGrowth, fromYahoo } = require('../server/research/fundamentals.js');
const providers = require('../server/market/providers.js');

const y = (end, o) => ({ fiscal_year_end: end, revenue: null, net_income: null, operating_cash_flow: null, capex: null, free_cash_flow: null, ...o });

// Growth sits on each year's own row (not in parallel arrays) and each row is
// labelled FYyyyy: a live run on a 1.5B model mis-aligned parallel arrays and
// shifted every year label by one.
describe('withGrowth', () => {
  it('sorts oldest first, labels fiscal years, and puts YoY on each row', () => {
    const out = withGrowth([
      y('2025-06-30', { revenue: 300, free_cash_flow: 90 }),
      y('2023-06-30', { revenue: 200, free_cash_flow: 100 }),
      y('2024-06-30', { revenue: 250, free_cash_flow: 120 }),
    ]);
    expect(out.years.map((r) => r.fiscal_year)).toEqual(['FY2023', 'FY2024', 'FY2025']);
    expect(out.years.map((r) => r.free_cash_flow_yoy_pct)).toEqual([null, 20, -25]);
    expect(out.years.map((r) => r.revenue_yoy_pct)).toEqual([null, 25, 20]);
    expect(out.growth).toBeUndefined();
  });

  it('drops years with no figures before computing growth', () => {
    const out = withGrowth([y('2022-06-30', {}), y('2023-06-30', { free_cash_flow: 100 }), y('2024-06-30', { free_cash_flow: 110 })]);
    expect(out.years.map((r) => r.fiscal_year)).toEqual(['FY2023', 'FY2024']);
    expect(out.years.map((r) => r.free_cash_flow_yoy_pct)).toEqual([null, 10]);
  });

  it('derives FCF from OCF + capex when missing', () => {
    expect(withGrowth([y('2024-06-30', { operating_cash_flow: 500, capex: -120 })]).years[0].free_cash_flow).toBe(380);
  });

  it('never divides by zero', () => {
    const out = withGrowth([y('2023-01-01', { net_income: 0 }), y('2024-01-01', { net_income: 5 })]);
    expect(out.years.map((r) => r.net_income_yoy_pct)).toEqual([null, null]);
  });
});

describe('fromYahoo', () => {
  // Field names as yahoo-finance2 4.0.2 actually returns them (live probe,
  // 2026-09-30) — unprefixed, unlike the `annual…` names in its docstring.
  it('maps fundamentalsTimeSeries rows', () => {
    expect(fromYahoo([{
      date: new Date('2026-06-30T00:00:00Z'), periodType: '12M', TYPE: 'ALL',
      totalRevenue: 331_839_000_000, netIncome: 2, operatingCashFlow: 3, capitalExpenditure: -1, freeCashFlow: 66_987_000_000,
    }])).toEqual([{ fiscal_year_end: '2026-06-30', revenue: 331_839_000_000, net_income: 2, operating_cash_flow: 3, capex: -1, free_cash_flow: 66_987_000_000 }]);
  });
});

describe('providers.yahoo.fundamentals', () => {
  afterEach(() => { providers._setYahooForTests(null); vi.restoreAllMocks(); });

  it('off → offline, SDK never touched, zero sockets', async () => {
    repo.setSettings(db(), { online: { market: false } });
    const spy = vi.spyOn(global, 'fetch');
    const fts = vi.fn();
    providers._setYahooForTests({ fundamentalsTimeSeries: fts });
    expect((await providers.yahoo.fundamentals('MSFT')).offline).toBe(true);
    expect(fts).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it('on → fundamentalsTimeSeries(annual, all) → withGrowth', async () => {
    repo.setSettings(db(), { online: { market: true } });
    const fts = vi.fn().mockResolvedValue([{ date: new Date('2024-06-30T00:00:00Z'), freeCashFlow: 7 }]);
    providers._setYahooForTests({ fundamentalsTimeSeries: fts });
    const out = await providers.yahoo.fundamentals('msft');
    expect(fts.mock.calls[0][0]).toBe('MSFT');
    expect(fts.mock.calls[0][1]).toMatchObject({ type: 'annual', module: 'all' });
    expect(out.offline).toBe(false);
    expect(out.data.years[0].free_cash_flow).toBe(7);
  });
});
