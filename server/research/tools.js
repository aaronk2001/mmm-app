'use strict';

// The five tools Linda's model can call. Each tool tries its sources in order
// and returns the first one with data, so a small local model only has to pick
// between five names. Every source goes out through online.fetch (or, for
// Yahoo's SDK, providers.js's online.enabled('market') gate); keys travel in
// headers only.

const crypto = require('crypto');
const online = require('../online');
const keys = require('../online/keys');
const providers = require('../market/providers');
const finnhub = require('./finnhub');
const fd = require('./fd');
const { withGrowth } = require('./fundamentals');

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

function validateTicker(t) {
  const v = typeof t === 'string' ? t.trim().toUpperCase() : '';
  if (!TICKER_RE.test(v)) throw new Error('ticker must be a symbol like MSFT');
  return v;
}

const clampInt = (v, lo, hi, dflt) => {
  const n = Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : dflt;
  return Math.min(hi, Math.max(lo, n));
};
const tickerProp = { type: 'string', description: 'Stock ticker symbol, e.g. MSFT' };
const tickerOnly = { type: 'object', properties: { ticker: tickerProp }, required: ['ticker'] };
const byTicker = (a = {}) => ({ ticker: validateTicker(a.ticker) });
const marketOn = () => online.enabled('market');

async function exaSearch({ query, num_results }) {
  const hash = crypto.createHash('sha1').update(query).digest('hex').slice(0, 16);
  const e = await online.fetch('https://api.exa.ai/search', {
    feature: 'exa', method: 'POST', cacheKey: `exa:${hash}:${num_results}`, ttl: 60 * 60 * 1000, retries: 0,
    headers: { 'x-api-key': keys.getKey('exa') || '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, numResults: num_results, contents: { text: { maxCharacters: 800 } } }),
  });
  const rs = e.data && Array.isArray(e.data.results) ? e.data.results : null;
  return {
    data: rs && rs.map((r) => ({ title: r.title, url: r.url, published: r.publishedDate || null, text: r.text })),
    cached_at: e.cached_at,
    offline: !!e.offline,
  };
}

const TOOLS = [
  {
    name: 'get_quote',
    description: 'Live price, day change and previous close for a ticker.',
    parameters: tickerOnly,
    validate: byTicker,
    sources: [
      { label: 'Finnhub quote', ready: finnhub.ready, run: ({ ticker }) => finnhub.quote(ticker) },
      {
        label: 'Yahoo Finance quote',
        ready: marketOn,
        run: async ({ ticker }) => {
          const e = await providers.yahoo.quote(ticker);
          return { data: e.quote || null, cached_at: e.cached_at, offline: !!e.offline };
        },
      },
    ],
  },
  {
    name: 'get_financials',
    description: 'Up to 5 fiscal years (labelled FYyyyy) of revenue, net income, operating cash flow, capex and free cash flow; each year carries its own year-over-year growth, already computed.',
    parameters: tickerOnly,
    validate: byTicker,
    sources: [
      {
        label: 'Financial Datasets',
        ready: fd.ready,
        run: async ({ ticker }) => {
          const e = await fd.annual(ticker);
          return { ...e, data: e.data && withGrowth(e.data) };
        },
      },
      {
        label: 'Yahoo Finance fundamentals',
        ready: marketOn,
        run: async ({ ticker }) => {
          const e = await providers.yahoo.fundamentals(ticker);
          return { data: e.data, cached_at: e.cached_at, offline: !!e.offline };
        },
      },
    ],
  },
  {
    name: 'get_key_metrics',
    description: 'Valuation and quality ratios: P/E, P/B, margins (in percent), ROE, growth, dividend yield, beta, 52-week range, market cap in USD.',
    parameters: tickerOnly,
    validate: byTicker,
    sources: [
      { label: 'Finnhub metrics', ready: finnhub.ready, run: ({ ticker }) => finnhub.metrics(ticker) },
      { label: 'Financial Datasets ratios', ready: fd.ready, run: ({ ticker }) => fd.ratios(ticker) },
    ],
  },
  {
    name: 'get_company_news',
    description: 'Up to 5 recent headlines about a company, with dates.',
    parameters: {
      type: 'object',
      properties: { ticker: tickerProp, days: { type: 'integer', description: 'Look-back in days, 1-30 (default 7)' } },
      required: ['ticker'],
    },
    validate: (a = {}) => ({ ticker: validateTicker(a.ticker), days: clampInt(a.days, 1, 30, 7) }),
    sources: [{ label: 'Finnhub company news', ready: finnhub.ready, run: ({ ticker, days }) => finnhub.news(ticker, days) }],
  },
  {
    name: 'exa_search',
    description: 'Web search for qualitative context: business model, competition, management, recent events. Not for financial figures.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        num_results: { type: 'integer', description: 'Results, 1-5 (default 3)' },
      },
      required: ['query'],
    },
    validate: (a = {}) => {
      const q = typeof a.query === 'string' ? a.query.trim() : '';
      if (q.length < 3 || q.length > 200) throw new Error('query must be 3-200 characters');
      return { query: q, num_results: clampInt(a.num_results, 1, 5, 3) };
    },
    sources: [{ label: 'Exa web search', ready: () => online.enabled('exa') && keys.hasKey('exa'), run: exaSearch }],
  },
];

async function runTool(tool, args) {
  let last = { data: null, cached_at: null, offline: true, source: null };
  for (const s of tool.sources.filter((x) => x.ready())) {
    const out = await s.run(args);
    last = { ...out, source: s.label };
    if (out.data != null) return last;
  }
  return last;
}

const availableTools = () => TOOLS.filter((t) => t.sources.some((s) => s.ready()));
const getTool = (name) => TOOLS.find((t) => t.name === name) || null;

module.exports = { TOOLS, availableTools, getTool, runTool, validateTicker };
