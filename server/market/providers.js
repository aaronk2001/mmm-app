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
// here. `earnings` and `screener` need a crumb obtained through a cookie-jar
// handshake that only the `yahoo-finance2` SDK performs, so the SDK does the
// I/O — but inside `online.guard()`, which gives those calls the same feature
// gate, http_cache TTL, cooldowns (sharing the chart host's rate limit),
// concurrency slots and deadline as every other provider, and never throws.

const online = require('../online');
const keys = require('../online/keys');

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

// Yahoo quotes some exchanges in the currency's MINOR unit: London in pence
// ('GBp', sometimes 'GBX'), Johannesburg in cents ('ZAc'), Tel Aviv in agorot
// ('ILA'). Anything that persists a price as money (a snapshot row, a
// holding's current_price) must convert to the major unit first, or a
// 70.5p share lands as 70.50 of whole currency — 100x too high.
const MINOR_UNIT_CURRENCIES = { GBp: 'GBP', GBX: 'GBP', ZAc: 'ZAR', ZAC: 'ZAR', ILA: 'ILS' };

/**
 * A copy of a chartMetaToQuote() quote expressed in the currency's major
 * unit (every price-like field / 100, currency renamed); quotes already in a
 * major unit come back unchanged. changePct and volume are unit-free.
 */
function toMajorUnits(quote) {
  if (!quote) return quote;
  const major = MINOR_UNIT_CURRENCIES[quote.currency];
  if (!major) return quote;
  const scale = (v) => (v == null ? v : v / 100);
  return {
    ...quote,
    currency: major,
    price: scale(quote.price),
    previousClose: scale(quote.previousClose),
    change: scale(quote.change),
    dayHigh: scale(quote.dayHigh),
    dayLow: scale(quote.dayLow),
    weekHigh52: scale(quote.weekHigh52),
    weekLow52: scale(quote.weekLow52),
  };
}

const dayKey = (epochSeconds) => new Date(epochSeconds * 1000).toISOString().slice(0, 10);

// Dividends arrive as `events.dividends`, keyed by timestamp: { amount, date }
// per ex-date. chart() asks for them (events=div|split) and the backtest bar
// sync needs them — without them every Yahoo-sourced backtest was price-only.
// Each amount lands on the bar for its ex-date (or the next bar, if that day
// has no bar). Split events are deliberately NOT surfaced: Yahoo's `close`
// series is already split-adjusted, so applying them again would double-count.
function dividendsByDay(result, days) {
  const out = new Map();
  const events = Object.values(result.events?.dividends || {});
  for (const ev of events) {
    const amount = Number(ev && ev.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(Number(ev.date))) continue;
    const exDay = dayKey(Number(ev.date));
    const day = days.find((d) => d >= exDay);
    if (day) out.set(day, (out.get(day) || 0) + amount);
  }
  return out;
}

function seriesFromChart(result) {
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const rows = ts.map((t, i) => ({
    time: dayKey(t),
    open: q.open?.[i] ?? null,
    high: q.high?.[i] ?? null,
    low: q.low?.[i] ?? null,
    close: q.close?.[i] ?? null,
    volume: q.volume?.[i] ?? null,
  })).filter((row) => row.close != null);
  const divs = dividendsByDay(result, rows.map((r) => r.time));
  for (const row of rows) if (divs.has(row.time)) row.dividend = divs.get(row.time);
  return rows;
}

// ── yahoo: chart-backed quote/chart/indices/futures (no crumb needed) ──────

async function chart(symbol, { range = '1mo', interval = '1d', ttl = DEFAULT_TTL } = {}) {
  const url = `${YF_HOST}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%7Csplit`;
  const env = await online.fetch(url, { feature: 'market', cacheKey: `yahoo:chart:${symbol}:${range}:${interval}`, ttl });
  const result = env.data?.chart?.result?.[0] || null;
  return {
    ...env,
    symbol,
    meta: result ? result.meta : null,
    series: result ? seriesFromChart(result) : null,
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

// The SDK's requests go to Yahoo's query hosts; they share the chart host's
// cooldown because Yahoo rate-limits per client, not per path.
const YF_RATE_LIMIT_HOST = new URL(YF_HOST).host;

// Lazily required — keeps module load cheap, and with the market feature off
// the SDK is never even loaded. yahoo-finance2 v3+ (v4 is installed) exports a
// CLASS; the v2-era `require('yahoo-finance2').default.quoteSummary(...)`
// throws "Call `new YahooFinance()` first", so earnings/screener could only
// ever return their offline envelope. versionCheck is off because on a schema
// mismatch the SDK otherwise fetches registry.npmjs.org — a host outside the
// online seam that the user never opted into.
let _yf = null;
function yf() {
  if (!_yf) {
    const mod = require('yahoo-finance2');
    const YahooFinance = mod.default || mod;
    _yf = typeof YahooFinance === 'function'
      ? new YahooFinance({ versionCheck: false, suppressNotices: ['yahooSurvey'] })
      : YahooFinance; // a pre-built instance (v2 shape)
  }
  return _yf;
}
// Tests inject a stand-in client instead of loading the real SDK.
function _setYahooClientForTests(client) { _yf = client; }

// Per-call SDK options: the seam's AbortSignal cancels the request (and the
// crumb handshake) at the deadline, and schema drift in Yahoo's payload
// degrades to "whatever came back" instead of a thrown validation error.
const sdkOptions = (signal) => ({ validateResult: false, fetchOptions: { signal } });

async function earnings(symbol, { ttl = SLOW_TTL } = {}) {
  const key = String(symbol).toUpperCase();
  return online.guard(
    (signal) => yf().quoteSummary(key, { modules: ['calendarEvents', 'earnings'] }, sdkOptions(signal)),
    { feature: 'market', cacheKey: `yahoo:earnings:${key}`, host: YF_RATE_LIMIT_HOST, ttl },
  );
}

async function screener(screenId, { count = 25, ttl = SLOW_TTL } = {}) {
  if (!SCREENS[screenId]) throw new Error(`Unknown predefined screen: ${screenId}`);
  return online.guard(
    (signal) => yf().screener(screenId, { count }, sdkOptions(signal)),
    { feature: 'market', cacheKey: `yahoo:screener:${screenId}:${count}`, host: YF_RATE_LIMIT_HOST, ttl },
  );
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
  MINOR_UNIT_CURRENCIES,
  toMajorUnits,
  seriesFromChart,
  _setYahooClientForTests,
  yahoo: { quote, chart, indices, futures, sectors, earnings, screener },
  fred: { series },
  coingecko: { simplePrice },
  frankfurter: { latest },
};
