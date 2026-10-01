'use strict';

// Finnhub — live quotes, key metrics and company news for Research. Free key.
// The key is sent as the X-Finnhub-Token header (documented alternative to
// ?token=) so it never appears in a URL or an http_cache row.

const online = require('../online');
const keys = require('../online/keys');

const BASE = 'https://finnhub.io/api/v1';

// Our name → Finnhub's /stock/metric field. Margins/returns/growth are
// already percentages in Finnhub's payload.
const METRICS = {
  pe_ttm: 'peTTM',
  pb: 'pbAnnual',
  ps_ttm: 'psTTM',
  gross_margin_pct: 'grossMarginTTM',
  operating_margin_pct: 'operatingMarginTTM',
  net_margin_pct: 'netProfitMarginTTM',
  roe_pct: 'roeTTM',
  revenue_growth_yoy_pct: 'revenueGrowthTTMYoy',
  eps_growth_yoy_pct: 'epsGrowthTTMYoy',
  dividend_yield_pct: 'dividendYieldIndicatedAnnual',
  beta: 'beta',
  week52_high: '52WeekHigh',
  week52_low: '52WeekLow',
};

const ready = () => online.enabled('finnhub') && keys.hasKey('finnhub');

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localStamp = (sec) => {
  const d = new Date(sec * 1000);
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function get(path, cacheKey, ttl) {
  return online.fetch(`${BASE}${path}`, {
    feature: 'finnhub', cacheKey, ttl, retries: 0,
    headers: { 'X-Finnhub-Token': keys.getKey('finnhub') || '' },
  });
}

async function quote(ticker) {
  const e = await get(`/quote?symbol=${encodeURIComponent(ticker)}`, `fh:quote:${ticker}`, 60 * 1000);
  const q = e.data;
  // Finnhub answers an unknown symbol with all zeros rather than a 404.
  const data = q && q.c
    ? { price: q.c, change: q.d, change_pct: q.dp, open: q.o, high: q.h, low: q.l, prev_close: q.pc, as_of: localStamp(q.t) }
    : null;
  return { data, cached_at: e.cached_at, offline: !!e.offline };
}

async function metrics(ticker) {
  const e = await get(`/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all`, `fh:metric:${ticker}`, 12 * 60 * 60 * 1000);
  const m = e.data && e.data.metric;
  let data = null;
  if (m) {
    data = {};
    for (const [out, src] of Object.entries(METRICS)) if (typeof m[src] === 'number') data[out] = m[src];
    // Finnhub reports market cap in millions; convert so a quoted "$3.05T" grounds.
    if (typeof m.marketCapitalization === 'number') data.market_cap_usd = m.marketCapitalization * 1e6;
  }
  return { data, cached_at: e.cached_at, offline: !!e.offline };
}

async function news(ticker, days = 7) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  const e = await get(
    `/company-news?symbol=${encodeURIComponent(ticker)}&from=${localDate(from)}&to=${localDate(to)}`,
    `fh:news:${ticker}:${days}:${localDate(to)}`,
    30 * 60 * 1000,
  );
  const data = Array.isArray(e.data)
    ? e.data.slice(0, 5).map((n) => ({
      headline: n.headline,
      source: n.source,
      date: localDate(new Date(n.datetime * 1000)),
      url: n.url,
      summary: String(n.summary || '').slice(0, 300),
    }))
    : null;
  return { data, cached_at: e.cached_at, offline: !!e.offline };
}

module.exports = { ready, quote, metrics, news };
