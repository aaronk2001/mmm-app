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

// providers.js reaches the seam through Node's require, which vitest keeps
// separate from this file's ESM `import` — two module instances, two sets of
// cooldowns. Reset the one the providers actually use as well, or a 429 in
// one test (host-scoped now) would leak into the next.
const onlineRequired = require('../server/online/index.js');

beforeEach(() => {
  online._resetForTests();
  onlineRequired._resetForTests();
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

// ── Snapshot rows the Watchlist can actually read, stamped honestly ─────────
// The Watchlist renders row.price (price_cents) and row.fetched_at. Before:
// snapshots.js passed `price_cents`, which repo.upsertPriceCache ignores, so
// every row stored NULL; and a refresh that failed upstream re-stamped the
// seam's cached copy with fetched_at = now.
describe('refreshSnapshots — honest rows', () => {
  const chartFor = (overrides = {}) => (url) => {
    const symbol = decodeURIComponent(String(url).split('/finance/chart/')[1].split('?')[0]);
    const o = overrides[symbol] || {};
    return Promise.resolve(okResponse(fakeChartJson(symbol, o.price ?? 123.45, o.prev ?? 120, o.meta || {})));
  };

  it('stores the quote price, so row.price is set (not NULL)', async () => {
    setMarket(true);
    repo.createWatchlistItem(db(), { symbol: 'PRCE' });
    vi.spyOn(global, 'fetch').mockImplementation(chartFor());
    await refreshSnapshots({ includeIndices: false, includeFutures: false });
    expect(repo.getPriceCacheEntry(db(), 'quote:PRCE').price).toBe(123.45);
    expect(db().prepare("SELECT price_cents FROM price_cache WHERE id = 'quote:PRCE'").get().price_cents).toBe(12345);
  });

  it('a failed refresh keeps the cached copy\'s true fetch time instead of stamping it "now"', async () => {
    setMarket(true);
    repo.createWatchlistItem(db(), { symbol: 'OLDQ' });
    const oldAt = new Date(Date.now() - 20 * 86_400_000).toISOString();
    repo.upsertHttpCache(db(), { cache_key: 'yahoo:chart:OLDQ:5d:1d', feature: 'market', url: 'x', data: fakeChartJson('OLDQ', 50, 49), cached_at: oldAt });
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(new Response('{}', { status: 429 })));
    const out = await refreshSnapshots({ includeIndices: false, includeFutures: false });
    const row = repo.getPriceCacheEntry(db(), 'quote:OLDQ');
    expect(row.price).toBe(50);
    expect(row.fetched_at).toBe(oldAt); // not "just now"
    expect(out.skipped.map((s) => s.symbol)).toContain('OLDQ');
  });

  it('never overwrites a newer snapshot with an older cached copy', async () => {
    setMarket(true);
    repo.createWatchlistItem(db(), { symbol: 'NEWR' });
    const recent = new Date(Date.now() - 60_000).toISOString();
    repo.upsertPriceCache(db(), { id: 'quote:NEWR', kind: 'quote', symbol: 'NEWR', price: 99, change_pct: 1, data: { price: 99 }, source: 'yahoo', fetched_at: recent });
    repo.upsertHttpCache(db(), {
      cache_key: 'yahoo:chart:NEWR:5d:1d', feature: 'market', url: 'x', data: fakeChartJson('NEWR', 50, 49),
      cached_at: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    });
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(new Response('{}', { status: 429 })));
    await refreshSnapshots({ includeIndices: false, includeFutures: false });
    const row = repo.getPriceCacheEntry(db(), 'quote:NEWR');
    expect(row.price).toBe(99);
    expect(row.fetched_at).toBe(recent);
  });

  it('stores minor-unit quotes (London pence) in the major unit', async () => {
    setMarket(true);
    repo.createWatchlistItem(db(), { symbol: 'VOD.L' });
    vi.spyOn(global, 'fetch').mockImplementation(chartFor({ 'VOD.L': { price: 250, prev: 240, meta: { currency: 'GBp' } } }));
    await refreshSnapshots({ includeIndices: false, includeFutures: false });
    const row = repo.getPriceCacheEntry(db(), 'quote:VOD.L');
    expect(row.price).toBe(2.5);
    expect(row.data.currency).toBe('GBP');
    expect(row.data.previousClose).toBe(2.4);
  });

  it('a refresh requested mid-run shares that run instead of starting a second one', async () => {
    setMarket(true);
    repo.createWatchlistItem(db(), { symbol: 'INFL' });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const perUrl = new Map();
    const inner = chartFor();
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      perUrl.set(String(url), (perUrl.get(String(url)) || 0) + 1);
      await gate;
      return inner(url);
    });
    const a = refreshSnapshots({ includeIndices: false, includeFutures: false });
    const b = refreshSnapshots({ includeIndices: false, includeFutures: false });
    expect(b).toBe(a);
    release();
    await a;
    expect([...perUrl.keys()].some((u) => u.includes('/INFL?'))).toBe(true);
    expect(Math.max(...perUrl.values())).toBe(1); // nothing fetched twice
  });
});

// ── /refresh-holdings: fresh, same-currency quotes only ─────────────────────
describe('POST /refresh-holdings — never writes a stale or wrong-currency price', () => {
  let server; let base;
  const originalFetch = global.fetch.bind(globalThis);
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/market', marketRoutes);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/market`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('converts pence, refuses stale and mismatched-currency quotes, and reports each skip', async () => {
    setMarket(true);
    const d = db();
    const gbp = repo.createAccount(d, { name: 'ISA', type: 'investment', balance: 0, currency: 'GBP' });
    const usd = repo.createAccount(d, { name: 'Brokerage', type: 'investment', balance: 0, currency: 'USD' });
    const vod = repo.createHolding(d, { account_id: gbp.id, symbol: 'VOD.L', shares: 1000, cost_basis: 2, current_price: 2.1 });
    const sap = repo.createHolding(d, { account_id: usd.id, symbol: 'SAP.DE', shares: 10, cost_basis: 100, current_price: 120 });
    const old = repo.createHolding(d, { account_id: usd.id, symbol: 'STLE', shares: 5, cost_basis: 70, current_price: 80 });
    const fresh = repo.createHolding(d, { account_id: usd.id, symbol: 'FRSH', shares: 1, cost_basis: 10, current_price: 11 });
    // STLE only has a 20-day-old cached quote, and its upstream is down.
    repo.upsertHttpCache(d, {
      cache_key: 'yahoo:chart:STLE:5d:1d', feature: 'market', url: 'x', data: fakeChartJson('STLE', 50, 49),
      cached_at: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    });
    const meta = { 'VOD.L': { price: 250, currency: 'GBp' }, 'SAP.DE': { price: 130, currency: 'EUR' }, FRSH: { price: 12.34, currency: 'USD' } };
    vi.spyOn(global, 'fetch').mockImplementation((url, opts) => {
      const u = String(url);
      if (u.startsWith(base)) return originalFetch(url, opts);
      const symbol = decodeURIComponent(u.split('/finance/chart/')[1].split('?')[0]);
      const m = meta[symbol];
      if (!m) return Promise.resolve(new Response('{}', { status: 404 })); // STLE and the sample holdings
      return Promise.resolve(okResponse(fakeChartJson(symbol, m.price, m.price, { currency: m.currency })));
    });

    const body = await (await fetch(`${base}/refresh-holdings`, { method: 'POST' })).json();
    const after = Object.fromEntries(body.holdings.map((h) => [h.id, h]));
    expect(after[vod.id]).toMatchObject({ current_price: 2.5, price_source: 'yahoo' });   // 250p -> £2.50
    expect(after[fresh.id]).toMatchObject({ current_price: 12.34, price_source: 'yahoo' });
    expect(after[sap.id]).toMatchObject({ current_price: 120 });                         // EUR quote, USD holding
    expect(after[old.id]).toMatchObject({ current_price: 80 });                          // stale cache refused
    const reasons = Object.fromEntries(body.skipped.map((s) => [s.id, s.reason]));
    expect(reasons[sap.id]).toMatch(/EUR.*USD/);
    expect(reasons[old.id]).toMatch(/no fresh quote/);
    expect(reasons[vod.id]).toBeUndefined();
  });
});

// ── earnings / screener: the SDK behind online.guard ────────────────────────
describe('earnings()/screener() — yahoo-finance2 through the seam', () => {
  afterEach(() => providers._setYahooClientForTests(null));

  it('passes the seam\'s abort signal, caches within the TTL, and returns a live envelope', async () => {
    setMarket(true);
    const calls = [];
    providers._setYahooClientForTests({
      quoteSummary: async (symbol, query, opts) => { calls.push({ symbol, query, opts }); return { earnings: { symbol } }; },
      screener: async (id, query, opts) => { calls.push({ id, query, opts }); return { quotes: [{ symbol: 'X' }] }; },
    });
    const first = await providers.yahoo.earnings('aapl');
    const second = await providers.yahoo.earnings('AAPL');
    expect(calls).toHaveLength(1); // second call served from http_cache within the TTL
    expect(calls[0].opts.fetchOptions.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].opts.validateResult).toBe(false);
    expect(first).toMatchObject({ offline: false, stale: false, data: { earnings: { symbol: 'AAPL' } } });
    expect(second.data).toEqual(first.data);

    const s = await providers.yahoo.screener('day_gainers');
    expect(s.data.quotes[0].symbol).toBe('X');
    expect(calls[1]).toMatchObject({ id: 'day_gainers', query: { count: 25 } });
  });

  it('a 429 from the SDK rate-limits the Yahoo chart host too', async () => {
    setMarket(true);
    providers._setYahooClientForTests({
      quoteSummary: async () => { const e = new Error('Too Many Requests'); e.code = 429; throw e; },
    });
    expect((await providers.yahoo.earnings('RLMT')).offline).toBe(true);
    const spy = vi.spyOn(global, 'fetch');
    const q = await providers.yahoo.quote('RLMT2');
    expect(spy).not.toHaveBeenCalled();
    expect(q.offline).toBe(true);
  });

  it('builds a working client from the installed (v3+, class-exporting) SDK, with no traffic off Yahoo', async () => {
    setMarket(true);
    providers._setYahooClientForTests(null); // let yf() construct the real client
    const seen = [];
    vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
      seen.push({ url: String(url), signal: init && init.signal });
      return Promise.reject(new Error('no network in tests'));
    });
    const out = await providers.yahoo.earnings('INST');
    expect(out.offline).toBe(true);
    // The old `.default.quoteSummary()` threw before making any request.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((c) => /^https:\/\/[^/]*yahoo\.com\//.test(c.url))).toBe(true);
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
  });
});

// chart() asks Yahoo for events=div|split; the dividends used to be dropped
// on the floor, so every Yahoo-synced backtest was price-only.
describe('seriesFromChart — dividends from Yahoo events', () => {
  const t = (day) => Date.UTC(2024, 0, day, 14, 30) / 1000; // 09:30 ET market open
  const result = {
    timestamp: [t(2), t(3), t(4), t(8)],
    indicators: { quote: [{ open: [100, 99, 98, 97], high: [100, 99, 98, 97], low: [100, 99, 98, 97], close: [100, 98.75, 98, 97], volume: [1, 1, 1, 1] }] },
    events: {
      dividends: {
        [t(3)]: { amount: 1.25, date: t(3) }, // ex-date with a bar
        [t(6)]: { amount: 0.5, date: t(6) },  // a Saturday: lands on the next bar (Mon the 8th)
        [t(4)]: { amount: 0, date: t(4) },    // junk amounts are ignored
      },
      splits: { [t(4)]: { numerator: 2, denominator: 1, date: t(4) } },
    },
  };

  it('puts each dividend on its ex-date bar (or the next bar), and never surfaces splits', () => {
    const rows = providers.seriesFromChart(result);
    expect(rows.map((r) => r.time)).toEqual(['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-08']);
    expect(rows[1].dividend).toBe(1.25);
    expect(rows[3].dividend).toBe(0.5);
    expect(rows[0].dividend).toBeUndefined();
    expect(rows[2].dividend).toBeUndefined();
    // Yahoo's close series is already split-adjusted; nothing split-shaped leaks out.
    for (const r of rows) expect(r.split).toBeUndefined();
  });

  it('toMajorUnits converts only minor-unit currencies', () => {
    expect(providers.toMajorUnits({ currency: 'GBp', price: 250, previousClose: 240, change: 10, changePct: 4.17 }))
      .toMatchObject({ currency: 'GBP', price: 2.5, previousClose: 2.4, change: 0.1, changePct: 4.17 });
    expect(providers.toMajorUnits({ currency: 'ZAc', price: 1000 })).toMatchObject({ currency: 'ZAR', price: 10 });
    expect(providers.toMajorUnits({ currency: 'ILA', price: 500 })).toMatchObject({ currency: 'ILS', price: 5 });
    const gbp = { currency: 'GBP', price: 2.5 };
    expect(providers.toMajorUnits(gbp)).toBe(gbp); // 'GBP' is pounds already
  });
});
