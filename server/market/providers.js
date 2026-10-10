'use strict';

// Sprint A, Track 2 — market data providers. Four sources only, per the plan:
// yahoo (quote/chart/indices/futures/earnings/predefined screener), fred
// (macro series, optional key), coingecko (crypto), frankfurter (fx).
// Marketaux, Exa, Financial Datasets, Finnhub, Alpha Vantage, ytsr, and any
// custom (non-predefined) screener are cut.
//
// Transport: quote/chart/indices/futures/fred/coingecko/frankfurter all go
// through `online.fetch()` — Yahoo's `/v8/finance/chart` endpoint needs no
// session crumb, so it's a plain GET-and-cache like every other provider
// here. `earnings` and `screener` are the one deliberate exception: Yahoo's
// `quoteSummary` and `screener` endpoints require a crumb obtained through a
// cookie-jar handshake that `online.fetch`'s single-shot fetch(url)->JSON
// contract has no seam for, so those two call the `yahoo-finance2` SDK
// directly (it owns that handshake) — gated by the same `online.enabled`
// check, never throwing, and backed by the same `price_cache` table so a
// disabled feature or a failed call still renders cached data instead of an
// error. See the Track 2 report for the full writeup of this deviation.

const { db } = require('../db/connection');
const repo = require('../db/repo');
const online = require('../online');
const keys = require('../online/keys');
const { withGrowth, fromYahoo } = require('../research/fundamentals');

const YF_HOST = 'https://query1.finance.yahoo.com';
const DEFAULT_TTL = 5 * 60 * 1000;   // quotes/chart — 5 min
const SLOW_TTL = 30 * 60 * 1000;     // macro/earnings/screener — 30 min

const INDEX_SYMBOLS = { '^GSPC': 'S&P 500', '^DJI': 'Dow 30', '^IXIC': 'Nasdaq', '^RUT': 'Russell 2000', '^VIX': 'VIX' };
const FUTURES_SYMBOLS = { 'ES=F': 'S&P 500 Futures', 'NQ=F': 'Nasdaq Futures', 'YM=F': 'Dow Futures', 'CL=F': 'Crude Oil', 'GC=F': 'Gold', 'SI=F': 'Silver', 'NG=F': 'Nat Gas' };
// The 11 SPDR sector ETFs — no dedicated "sectors" data source in scope for
// this sprint, so sector performance is just quote() over these symbols,
// same shape as indices()/futures() below.
const SECTOR_SYMBOLS = {
  XLK: 'Technology', XLF: 'Financials', XLE: 'Energy', XLV: 'Health Care',
  XLY: 'Consumer Discretionary', XLP: 'Consumer Staples', XLI: 'Industrials',
  XLB: 'Materials', XLU: 'Utilities', XLRE: 'Real Estate', XLC: 'Communication Services',
};
// Predefined screens only — no custom screener query builder in this sprint.
const SCREENS = {
  day_gainers: 'Day Gainers',
  day_losers: 'Day Losers',
  most_actives: 'Most Active',
  undervalued_growth_stocks: 'Undervalued Growth',
  aggressive_small_caps: 'Aggressive Small Caps',
};

function chartMetaToQuote(meta) {
  if (!meta) return null;
  const price = meta.regularMarketPrice ?? null;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const changePct = price != null && prevClose ? ((price - prevClose) / prevClose) * 100 : null;
  return {
    symbol: meta.symbol,
    price,
    previousClose: prevClose,
    change: price != null && prevClose != null ? price - prevClose : null,
    changePct: changePct != null ? Math.round(changePct * 100) / 100 : null,
    currency: meta.currency || 'USD',
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    // Day/52-week range + volume: real fields on Yahoo's chart `meta` object
    // (same payload chartPreviousClose already comes from), just not mapped
    // through before — not every symbol/timeframe carries all of them, hence
    // the `?? null` throughout.
    dayHigh: meta.regularMarketDayHigh ?? null,
    dayLow: meta.regularMarketDayLow ?? null,
    weekHigh52: meta.fiftyTwoWeekHigh ?? null,
    weekLow52: meta.fiftyTwoWeekLow ?? null,
    volume: meta.regularMarketVolume ?? null,
  };
}

function seriesFromChart(result) {
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  return ts.map((t, i) => ({
    time: new Date(t * 1000).toISOString().slice(0, 10),
    open: q.open?.[i] ?? null,
    high: q.high?.[i] ?? null,
    low: q.low?.[i] ?? null,
    close: q.close?.[i] ?? null,
    volume: q.volume?.[i] ?? null,
  })).filter((row) => row.close != null);
}

// ── yahoo: chart-backed quote/chart/indices/futures (no crumb needed) ──────

function dividendsFromChart(result) {
  return Object.values(result?.events?.dividends || {})
    .map((e) => ({ time: Number(e?.date), amount: Number(e?.amount) }))
    .filter((e) => Number.isFinite(e.time) && Number.isFinite(e.amount));
}

async function chart(symbol, { range = '1mo', interval = '1d', ttl = DEFAULT_TTL } = {}) {
  const url = `${YF_HOST}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%7Csplit`;
  const env = await online.fetch(url, { feature: 'market', cacheKey: `yahoo:chart:${symbol}:${range}:${interval}`, ttl });
  const result = env.data?.chart?.result?.[0] || null;
  return {
    ...env,
    symbol,
    meta: result ? result.meta : null,
    series: result ? seriesFromChart(result) : null,
    dividends: dividendsFromChart(result),
  };
}

async function quote(symbol, opts = {}) {
  const c = await chart(symbol, { range: '5d', interval: '1d', ...opts });
  return { ...c, quote: chartMetaToQuote(c.meta) };
}

async function indices(opts = {}) {
  const symbols = Object.keys(INDEX_SYMBOLS);
  const results = await Promise.all(symbols.map((s) => quote(s, opts)));
  return results.map((r, i) => ({ ...r, symbol: symbols[i], name: INDEX_SYMBOLS[symbols[i]] }));
}

async function futures(opts = {}) {
  const symbols = Object.keys(FUTURES_SYMBOLS);
  const results = await Promise.all(symbols.map((s) => quote(s, opts)));
  return results.map((r, i) => ({ ...r, symbol: symbols[i], name: FUTURES_SYMBOLS[symbols[i]] }));
}

async function sectors(opts = {}) {
  const symbols = Object.keys(SECTOR_SYMBOLS);
  const results = await Promise.all(symbols.map((s) => quote(s, opts)));
  return results.map((r, i) => ({ ...r, symbol: symbols[i], name: SECTOR_SYMBOLS[symbols[i]] }));
}

// ── yahoo: earnings + predefined screener (crumb required — SDK transport) ─

function offlineFromPriceCache(kind, key) {
  const row = repo.getPriceCacheEntry(db(), `${kind}:${key}`);
  return {
    data: row ? row.data : null,
    cached_at: row ? row.fetched_at : null,
    stale: true,
    offline: true,
  };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

// Lazily required — keeps module load cheap. Tests swap in a fake through
// _setYahooForTests so they never touch the network.
let _yf = null;
function yf() {
  if (!_yf) {
    // yahoo-finance2 v4: the default export is a class; static calls throw.
    const YahooFinance = require('yahoo-finance2').default;
    _yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  }
  return _yf;
}
function _setYahooForTests(instance) { _yf = instance; }

async function earnings(symbol, { ttl = SLOW_TTL } = {}) {
  const key = String(symbol).toUpperCase();
  if (!online.enabled('market')) return offlineFromPriceCache('earnings', key);
  try {
    const data = await withTimeout(yf().quoteSummary(key, { modules: ['calendarEvents', 'earnings'] }), 8000);
    repo.upsertPriceCache(db(), { id: `earnings:${key}`, kind: 'earnings', symbol: key, data, source: 'yahoo', fetched_at: new Date().toISOString() });
    return { data, cached_at: new Date().toISOString(), stale: false, offline: false };
  } catch {
    return offlineFromPriceCache('earnings', key);
  }
  // eslint-disable-next-line no-unreachable
  void ttl; // ttl kept for interface symmetry with the other providers
}

// Annual statements for Research (server/research/). Same gate and offline
// fallback as earnings(); the summary (not the raw SDK rows) is cached.
async function fundamentals(symbol) {
  const key = String(symbol).toUpperCase();
  if (!online.enabled('market')) return offlineFromPriceCache('fundamentals', key);
  try {
    const period1 = `${new Date().getFullYear() - 5}-01-01`;
    const rows = await withTimeout(yf().fundamentalsTimeSeries(key, { period1, type: 'annual', module: 'all' }), 10000);
    const data = withGrowth(fromYahoo(rows));
    repo.upsertPriceCache(db(), { id: `fundamentals:${key}`, kind: 'fundamentals', symbol: key, data, source: 'yahoo', fetched_at: new Date().toISOString() });
    return { data, cached_at: new Date().toISOString(), stale: false, offline: false };
  } catch {
    return offlineFromPriceCache('fundamentals', key);
  }
}

async function screener(screenId, { count = 25 } = {}) {
  if (!SCREENS[screenId]) throw new Error(`Unknown predefined screen: ${screenId}`);
  if (!online.enabled('market')) return offlineFromPriceCache('screener', screenId);
  try {
    const data = await withTimeout(yf().screener({ scrIds: screenId, count }), 8000);
    repo.upsertPriceCache(db(), { id: `screener:${screenId}`, kind: 'screener', symbol: screenId, data, source: 'yahoo', fetched_at: new Date().toISOString() });
    return { data, cached_at: new Date().toISOString(), stale: false, offline: false };
  } catch {
    return offlineFromPriceCache('screener', screenId);
  }
}

// ── fred: macro series (real, optional key — no key means every request
// simply 400s through online.fetch's normal error-cooldown path) ──────────

async function series(seriesId, { ttl = SLOW_TTL, limit = 60 } = {}) {
  const apiKey = keys.getKey('market') || '';
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(apiKey)}&file_type=json&sort_order=desc&limit=${limit}`;
  // limit belongs in the key: the Macro tiles ask for limit=1 and the detail
  // table for limit=24, and a shared row let whichever landed first serve both
  // for the whole TTL — the full-history table could render one observation.
  return online.fetch(url, { feature: 'market', cacheKey: `fred:${seriesId}:${limit}`, ttl });
}

// ── coingecko: crypto simple price (keyless) ───────────────────────────────

async function simplePrice(ids = ['bitcoin', 'ethereum'], { ttl = DEFAULT_TTL, vs = 'usd' } = {}) {
  const idsParam = ids.join(',');
  // include_24hr_vol / include_last_updated_at are the same keyless
  // simple/price endpoint, just asking it for two more fields it already
  // supports — lets the Crypto tab show 24h volume and per-coin freshness.
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(idsParam)}&vs_currencies=${vs}&include_24hr_change=true&include_24hr_vol=true&include_last_updated_at=true`;
  return online.fetch(url, { feature: 'market', cacheKey: `coingecko:${idsParam}:${vs}`, ttl });
}

// ── frankfurter: fx rates (keyless) ─────────────────────────────────────────

async function latest(base = 'USD', symbols = ['EUR', 'GBP', 'JPY'], { ttl = SLOW_TTL } = {}) {
  const symParam = symbols.length ? `&symbols=${symbols.join(',')}` : '';
  const url = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(base)}${symParam}`;
  return online.fetch(url, { feature: 'market', cacheKey: `fx:${base}:${symbols.join(',')}`, ttl });
}

module.exports = {
  INDEX_SYMBOLS,
  FUTURES_SYMBOLS,
  SECTOR_SYMBOLS,
  SCREENS,
  yahoo: { quote, chart, indices, futures, sectors, earnings, screener, fundamentals },
  fred: { series },
  coingecko: { simplePrice },
  frankfurter: { latest },
  dividendsFromChart,
  _setYahooForTests,
};
