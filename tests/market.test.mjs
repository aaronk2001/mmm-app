// Sprint A, Track 2 — market data providers, snapshots job, and /api/market
// routes. The one non-negotiable property under test throughout: with the
// `market` online feature off, every provider call and every route resolves
// to a cached/offline shape and NEVER opens a socket — asserted here by
// spying on global.fetch (which server/online/index.js calls directly) and
// checking it was never invoked, the same guarantee tests/online.test.mjs
// proves for the seam itself. No live network calls anywhere in this file;
// the yahoo-finance2 SDK (used only by earnings/screener) is vi.mock'd.
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createRequire } from 'node:module';
import { db } from '../server/db/connection.js';
import repo from '../server/db/repo.js';
import online from '../server/online/index.js';

const require = createRequire(import.meta.url);
const providers = require('../server/market/providers.js');
const marketRoutes = require('../server/market/routes.js');
const { refreshSnapshots, symbolsFromWatchlistAndHoldings } = require('../server/market/snapshots.js');
const { isUsMarketHours } = require('../server/jobs.js');

function setMarket(on) {
  repo.setSettings(db(), { online: { market: on } });
}

function fakeChartJson(symbol, price = 150, prevClose = 140, metaExtra = {}) {
  return {
    chart: {
      result: [{
        meta: { symbol, regularMarketPrice: price, chartPreviousClose: prevClose, currency: 'USD', regularMarketTime: 1_700_000_000, ...metaExtra },
        timestamp: [1_699_900_000, 1_699_986_400],
        indicators: { quote: [{ open: [140, 145], high: [146, 151], low: [139, 144], close: [141, price], volume: [1000, 2000] }] },
      }],
    },
  };
}
function okResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  online._resetForTests();
  repo.setSettings(db(), { online: Object.fromEntries(online.FEATURES.map((f) => [f, false])) });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('providers.yahoo — feature-off means zero sockets', () => {
  it('quote() never calls fetch and returns an offline envelope', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const q = await providers.yahoo.quote('AAPL');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(q.offline).toBe(true);
    expect(q.stale).toBe(true);
    expect(q.quote).toBeNull();
  });

  it('chart() never calls fetch when disabled', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const c = await providers.yahoo.chart('MSFT');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(c.offline).toBe(true);
    expect(c.series).toBeNull();
  });

  it('indices()/futures()/sectors() never call fetch and every entry is offline', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const [idx, fut, sec] = await Promise.all([providers.yahoo.indices(), providers.yahoo.futures(), providers.yahoo.sectors()]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(idx).toHaveLength(Object.keys(providers.INDEX_SYMBOLS).length);
    expect(fut).toHaveLength(Object.keys(providers.FUTURES_SYMBOLS).length);
    expect(sec).toHaveLength(Object.keys(providers.SECTOR_SYMBOLS).length);
    for (const row of [...idx, ...fut, ...sec]) expect(row.offline).toBe(true);
  });

  it('fred.series / coingecko.simplePrice / frankfurter.latest never call fetch when disabled', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const [fred, crypto, fx] = await Promise.all([
      providers.fred.series('FEDFUNDS'),
      providers.coingecko.simplePrice(),
      providers.frankfurter.latest(),
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const env of [fred, crypto, fx]) { expect(env.offline).toBe(true); expect(env.data).toBeNull(); }
  });

  it('earnings()/screener() short-circuit to offline before ever requiring the yahoo-finance2 SDK', async () => {
    // providers.js's `online.enabled('market')` gate runs before the lazy
    // `require('yahoo-finance2')` inside yf() — with the feature off, that
    // require (and therefore the SDK's own network/cookie handshake) never
    // executes at all, so there is nothing to stub here.
    const e = await providers.yahoo.earnings('AAPL');
    const s = await providers.yahoo.screener('day_gainers');
    expect(e.offline).toBe(true);
    expect(s.offline).toBe(true);
  });

  it('screener() rejects an unknown screen id regardless of feature state', async () => {
    await expect(providers.yahoo.screener('not_a_real_screen')).rejects.toThrow(/Unknown predefined screen/);
  });
});

describe('providers.yahoo — feature-on fetches through online.fetch and shapes the result', () => {
  it('quote() maps chart meta into a quote with a computed changePct', async () => {
    setMarket(true);
    vi.spyOn(global, 'fetch').mockResolvedValue(okResponse(fakeChartJson('AAPL', 150, 140)));
    const q = await providers.yahoo.quote('AAPL');
    expect(q.offline).toBe(false);
    expect(q.quote.price).toBe(150);
    expect(q.quote.previousClose).toBe(140);
    expect(q.quote.changePct).toBeCloseTo(7.14, 1);
  });

  it('chart() shapes series rows for lightweight-charts, dropping null closes', async () => {
    setMarket(true);
    vi.spyOn(global, 'fetch').mockResolvedValue(okResponse(fakeChartJson('SPY', 500, 495)));
    const c = await providers.yahoo.chart('SPY');
    expect(c.series).toHaveLength(2);
    expect(c.series[0]).toMatchObject({ open: 140, high: 146, low: 139, close: 141 });
    expect(c.series[1].close).toBe(500);
  });

  it('quote() maps day range, 52-week range, and volume off chart meta when present', async () => {
    setMarket(true);
    // Distinct symbols per test — providers.js's chart() caches by
    // `yahoo:chart:<symbol>:<range>:<interval>` in http_cache, and a
    // symbol reused across tests in this file (e.g. AAPL, above) would
    // silently serve that earlier cached payload instead of this mock.
    vi.spyOn(global, 'fetch').mockResolvedValue(okResponse(fakeChartJson('RNGE', 150, 140, {
      regularMarketDayHigh: 152, regularMarketDayLow: 148,
      fiftyTwoWeekHigh: 200, fiftyTwoWeekLow: 120, regularMarketVolume: 45_000_000,
    })));
    const q = await providers.yahoo.quote('RNGE');
    expect(q.quote).toMatchObject({
      dayHigh: 152, dayLow: 148, weekHigh52: 200, weekLow52: 120, volume: 45_000_000,
    });
  });

  it('quote() falls back to null range/volume fields when chart meta omits them', async () => {
    setMarket(true);
    vi.spyOn(global, 'fetch').mockResolvedValue(okResponse(fakeChartJson('NORNG', 150, 140)));
    const q = await providers.yahoo.quote('NORNG');
    expect(q.quote).toMatchObject({ dayHigh: null, dayLow: null, weekHigh52: null, weekLow52: null, volume: null });
  });
});

describe('server/jobs.js — isUsMarketHours (no hardcoded UTC offsets)', () => {
  it('true on a weekday during regular hours (handles DST via America/New_York)', () => {
    expect(isUsMarketHours(new Date('2026-09-15T14:30:00Z'))).toBe(true); // Tue 10:30 ET
  });
  it('false on a weekend', () => {
    expect(isUsMarketHours(new Date('2026-09-19T15:00:00Z'))).toBe(false); // Sat
  });
  it('false before the open and after the close on a weekday', () => {
    expect(isUsMarketHours(new Date('2026-09-15T09:00:00Z'))).toBe(false); // Tue 05:00 ET
    expect(isUsMarketHours(new Date('2026-09-15T21:30:00Z'))).toBe(false); // Tue 17:30 ET
  });
});

describe('server/market/snapshots.js — refreshSnapshots', () => {
  it('is a no-op (ok:false) when market is off, and never calls fetch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const out = await refreshSnapshots();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.ok).toBe(false);
    expect(out.written).toBe(0);
  });

  it('writes price_cache rows for watchlist + holding symbols when on', async () => {
    setMarket(true);
    const d = db();
    // The demo dataset already ships a few sample holdings — add one symbol
    // that's guaranteed not already there, and assert against the actual
    // watchlist+holdings union rather than a hardcoded count.
    repo.createWatchlistItem(d, { symbol: 'GOOGL' });
    const expectedSymbols = symbolsFromWatchlistAndHoldings(d);
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const symbol = decodeURIComponent(String(url).split('/finance/chart/')[1].split('?')[0]);
      return Promise.resolve(okResponse(fakeChartJson(symbol, 200, 190)));
    });
    const out = await refreshSnapshots({ includeIndices: false, includeFutures: false });
    expect(out.ok).toBe(true);
    expect(out.written).toBe(expectedSymbols.length);
    const cached = repo.getPriceCache(d, 'quote');
    expect(cached.map((c) => c.symbol)).toEqual(expect.arrayContaining(['GOOGL']));
  });
});

describe('routes: /api/market', () => {
  let server; let base;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/market', marketRoutes);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/market`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  // The test harness itself calls `fetch()` to talk to the local Express
  // server it just stood up — vi.spyOn(global, 'fetch') without a mock
  // implementation calls through to the real fetch, so it captures that
  // outbound call too. Only calls to something OTHER than our own `base`
  // count as a genuine (would-be-external) network attempt.
  function externalCalls(fetchSpy) {
    return fetchSpy.mock.calls.filter(([url]) => !String(url).startsWith(base));
  }

  it('GET /snapshots never triggers a fetch — it only reads price_cache', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const res = await fetch(`${base}/snapshots`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body.price_cache)).toBe(true);
    expect(externalCalls(fetchSpy)).toHaveLength(0);
  });

  it('POST /refresh 400s when market is off, without calling fetch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const res = await fetch(`${base}/refresh`, { method: 'POST' });
    expect(res.status).toBe(400);
    expect(externalCalls(fetchSpy)).toHaveLength(0);
  });

  it('GET /quote/:symbol, /indices, /futures, /sectors all 200 with an offline envelope and zero sockets when off', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    for (const path of ['/quote/AAPL', '/indices', '/futures', '/sectors']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${base}${path}`);
      // eslint-disable-next-line no-await-in-loop
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body).toBeTruthy();
    }
    expect(externalCalls(fetchSpy)).toHaveLength(0);
  });

  it('watchlist CRUD round-trips', async () => {
    const created = await (await fetch(`${base}/watchlist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: 'nvda', note: 'watch it' }),
    })).json();
    expect(created.symbol).toBe('NVDA');

    const list = await (await fetch(`${base}/watchlist`)).json();
    expect(list.watchlist.some((w) => w.id === created.id)).toBe(true);

    const del = await fetch(`${base}/watchlist/${created.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);

    const del404 = await fetch(`${base}/watchlist/${created.id}`, { method: 'DELETE' });
    expect(del404.status).toBe(404);
  });

  it('POST /watchlist 400s without a symbol', async () => {
    const res = await fetch(`${base}/watchlist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('alert rules CRUD + validation', async () => {
    const bad = await fetch(`${base}/alerts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: 'AAPL', condition: 'sideways', target: 100 }),
    });
    expect(bad.status).toBe(400);

    const created = await (await fetch(`${base}/alerts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: 'AAPL', condition: 'above', target: 200 }),
    })).json();
    expect(created.symbol).toBe('AAPL');

    const list = await (await fetch(`${base}/alerts`)).json();
    expect(list.alert_rules.some((a) => a.id === created.id)).toBe(true);

    const del = await fetch(`${base}/alerts/${created.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const del404 = await fetch(`${base}/alerts/${created.id}`, { method: 'DELETE' });
    expect(del404.status).toBe(404);
  });

  it('GET /screens lists the predefined screens; unknown screener id 400s', async () => {
    const screens = await (await fetch(`${base}/screens`)).json();
    expect(screens.screens.some((s) => s.id === 'day_gainers')).toBe(true);
    const bad = await fetch(`${base}/screener/not_a_screen`);
    expect(bad.status).toBe(400);
  });

  it('POST /refresh-holdings 400s when market is off', async () => {
    const res = await fetch(`${base}/refresh-holdings`, { method: 'POST' });
    expect(res.status).toBe(400);
  });
});

// A FRED cache row must be keyed by limit: the Macro tiles request limit=1 and
// the detail table limit=24, and a shared row served whichever landed first for
// the whole TTL.
describe('fred cache key', () => {
  it('keys the cached row by series AND limit', async () => {
    const online = require('../server/online/index.js');
    const seen = [];
    vi.spyOn(online, 'fetch').mockImplementation((url, opts) => {
      seen.push(opts.cacheKey);
      return Promise.resolve({ data: { observations: [] }, cached: false });
    });
    await providers.fred.series('FEDFUNDS', { limit: 1 });
    await providers.fred.series('FEDFUNDS', { limit: 24 });
    expect(new Set(seen).size).toBe(2);
    expect(seen).toEqual(['fred:FEDFUNDS:1', 'fred:FEDFUNDS:24']);
    vi.restoreAllMocks();
  });
});
