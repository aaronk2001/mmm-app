import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createRequire } from 'node:module';
import store from '../server/money/store.js';
import repo from '../server/db/repo.js';
import { db } from '../server/db/connection.js';
import online from '../server/online/index.js';

const require = createRequire(import.meta.url);
const { trailingTwelveMonths } = require('../server/market/dividends.js');
const providers = require('../server/market/providers.js');
const marketRoutes = require('../server/market/routes.js');
const { computeInvestmentMetrics } = require('../server/money/calc.js');
const v = require('../server/middleware/validators.js');

const DAY = 86400;

beforeEach(() => {
  store.reset();
  online._resetForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('trailingTwelveMonths', () => {
  const now = Date.UTC(2026, 9, 10);
  const ago = (days) => Math.floor(now / 1000) - days * DAY;

  it('sums only events inside the trailing 365 days', () => {
    const events = [
      { time: ago(30), amount: 1 },
      { time: ago(200), amount: 2 },
      { time: ago(400), amount: 4 },
    ];
    expect(trailingTwelveMonths(events, now)).toBe(3);
  });

  it('returns 0 for empty or missing input', () => {
    expect(trailingTwelveMonths([], now)).toBe(0);
    expect(trailingTwelveMonths(undefined, now)).toBe(0);
  });

  it('ignores malformed entries', () => {
    const events = [{ time: ago(10) }, { time: ago(10), amount: 'x' }, { amount: 5 }, null, { time: ago(10), amount: 0.25 }];
    expect(trailingTwelveMonths(events, now)).toBe(0.25);
  });

  it('rounds to 4 decimals', () => {
    const events = [{ time: ago(1), amount: 0.1 }, { time: ago(2), amount: 0.2 }, { time: ago(3), amount: 0.00004 }];
    expect(trailingTwelveMonths(events, now)).toBe(0.3);
  });
});

describe('chart() dividend parsing', () => {
  function chartJson(symbol, events) {
    return {
      chart: {
        result: [{
          meta: { symbol, regularMarketPrice: 100, chartPreviousClose: 99, currency: 'USD' },
          timestamp: [1_699_900_000],
          indicators: { quote: [{ open: [1], high: [1], low: [1], close: [100], volume: [1] }] },
          ...(events ? { events } : {}),
        }],
      },
    };
  }
  const okResponse = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  beforeEach(() => {
    repo.setSettings(db(), { online: { market: true } });
  });

  it('returns dividends as [{ time, amount }] from events.dividends', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(okResponse(chartJson('DIVA', {
      dividends: {
        1700000000: { amount: 0.5, date: 1700000000 },
        1710000000: { amount: 0.55, date: 1710000000 },
      },
    })));
    const c = await providers.yahoo.chart('DIVA', { range: '1y', interval: '1wk' });
    expect(c.dividends).toEqual([
      { time: 1700000000, amount: 0.5 },
      { time: 1710000000, amount: 0.55 },
    ]);
    expect(c.series).toHaveLength(1);
  });

  it('returns an empty array when the payload has no dividend events', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(okResponse(chartJson('NODIV')));
    const c = await providers.yahoo.chart('NODIV', { range: '1y', interval: '1wk' });
    expect(c.dividends).toEqual([]);
  });
});

describe('computeInvestmentMetrics dividends', () => {
  const holdings = [
    { symbol: 'AAA', shares: 10, cost_basis: 80, current_price: 100, dividend_ttm: 1.5 },
    { symbol: 'BBB', shares: 5, cost_basis: 150, current_price: 200, dividend_ttm: 0.5 },
  ];

  it('adds annualIncome and yieldPct without changing existing fields', () => {
    const m = computeInvestmentMetrics(holdings);
    expect(m.annualIncome).toBe(17.5);
    expect(m.yieldPct).toBe(0.88);
    expect(m.marketValue).toBe(2000);
    expect(m.costBasis).toBe(1550);
    expect(m.gain).toBe(450);
    expect(m.gainPct).toBe(29.03);
    expect(m.holdingsCount).toBe(2);
    expect(m.allocation).toEqual([
      { symbol: 'AAA', value: 1000, pct: 50 },
      { symbol: 'BBB', value: 1000, pct: 50 },
    ]);
  });

  it('is 0/0 with no holdings or no dividend data', () => {
    expect(computeInvestmentMetrics([])).toMatchObject({ annualIncome: 0, yieldPct: 0 });
    expect(computeInvestmentMetrics([{ symbol: 'X', shares: 1, current_price: 10 }])).toMatchObject({ annualIncome: 0, yieldPct: 0 });
  });
});

describe('holdings dividend_ttm persistence', () => {
  it('round-trips through updateHolding with cents rounding, defaulting to 0', () => {
    const d = db();
    const h = repo.createHolding(d, { symbol: 'RTRP', shares: 3, cost_basis: 10, current_price: 12 });
    expect(h.dividend_ttm).toBe(0);
    const updated = repo.updateHolding(d, h.id, { dividend_ttm: 1.2345 });
    expect(updated.dividend_ttm).toBe(1.23);
    expect(repo.getHoldings(d).find((x) => x.id === h.id).dividend_ttm).toBe(1.23);
  });

  it('validateHolding accepts a non-negative dividend_ttm and rejects a negative one', () => {
    expect(v.validateHolding({ dividend_ttm: 1.2 }, { partial: true }).valid).toBe(true);
    expect(v.validateHolding({ dividend_ttm: -1 }, { partial: true }).valid).toBe(false);
  });
});

describe('POST /api/market/refresh-holdings dividends', () => {
  let server; let base;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/market', marketRoutes);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/market`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('sets dividend_ttm from the chart; a failed chart still updates the price and leaves dividend_ttm alone', async () => {
    const d = db();
    repo.setSettings(d, { online: { market: true } });
    const good = repo.createHolding(d, { symbol: 'GOODD', shares: 1, current_price: 1 });
    const bad = repo.createHolding(d, { symbol: 'BADD', shares: 1, current_price: 1 });
    repo.updateHolding(d, bad.id, { dividend_ttm: 2 });

    const nowSec = Math.floor(Date.now() / 1000);
    vi.spyOn(providers.yahoo, 'quote').mockImplementation(async (symbol) => ({ quote: { price: symbol === 'GOODD' ? 50 : 60 } }));
    vi.spyOn(providers.yahoo, 'chart').mockImplementation(async (symbol) => {
      if (symbol === 'BADD') throw new Error('boom');
      return {
        meta: {},
        dividends: [{ time: nowSec - 10 * DAY, amount: 0.4 }, { time: nowSec - 100 * DAY, amount: 0.4 }, { time: nowSec - 500 * DAY, amount: 9 }],
      };
    });

    const res = await fetch(`${base}/refresh-holdings`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    const g = body.holdings.find((h) => h.id === good.id);
    const b = body.holdings.find((h) => h.id === bad.id);
    expect(g.current_price).toBe(50);
    expect(g.dividend_ttm).toBe(0.8);
    expect(b.current_price).toBe(60);
    expect(b.dividend_ttm).toBe(2);
  });

  it('leaves dividend_ttm unchanged when the chart came back offline (no result)', async () => {
    const d = db();
    repo.setSettings(d, { online: { market: true } });
    const h = repo.createHolding(d, { symbol: 'OFFD', shares: 1, current_price: 1 });
    repo.updateHolding(d, h.id, { dividend_ttm: 3 });
    vi.spyOn(providers.yahoo, 'quote').mockResolvedValue({ quote: { price: 7 } });
    vi.spyOn(providers.yahoo, 'chart').mockResolvedValue({ meta: null, series: null, dividends: [], offline: true });
    const body = await (await fetch(`${base}/refresh-holdings`, { method: 'POST' })).json();
    const out = body.holdings.find((x) => x.id === h.id);
    expect(out.current_price).toBe(7);
    expect(out.dividend_ttm).toBe(3);
  });
});
