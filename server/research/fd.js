'use strict';

// Financial Datasets (financialdatasets.ai) — optional, paid. Ported from
// Linda's src/tools/api.js + financials.js. X-API-KEY header and the
// ticker/period/limit params are from the provider's docs; the response field
// names below follow Linda's usage and should be confirmed against one live
// response.

const online = require('../online');
const keys = require('../online/keys');
const { num } = require('./fundamentals');

const BASE = 'https://api.financialdatasets.ai';
const TTL = 12 * 60 * 60 * 1000;

const ready = () => online.enabled('financialDatasets') && keys.hasKey('financialDatasets');

function get(path, params, cacheKey) {
  const qs = new URLSearchParams(params).toString();
  return online.fetch(`${BASE}${path}?${qs}`, {
    feature: 'financialDatasets', cacheKey, ttl: TTL, retries: 0,
    headers: { 'X-API-KEY': keys.getKey('financialDatasets') || '' },
  });
}

async function annual(ticker) {
  const params = { ticker, period: 'annual', limit: 5 };
  const [inc, cf] = await Promise.all([
    get('/financials/income-statements/', params, `fd:income:${ticker}`),
    get('/financials/cash-flow-statements/', params, `fd:cashflow:${ticker}`),
  ]);
  const incRows = (inc.data && inc.data.income_statements) || [];
  const cfRows = (cf.data && cf.data.cash_flow_statements) || [];
  const cached_at = inc.cached_at || cf.cached_at;
  if (!incRows.length && !cfRows.length) return { data: null, cached_at, offline: !!(inc.offline && cf.offline) };
  const byEnd = new Map();
  const row = (end) => {
    if (!byEnd.has(end)) byEnd.set(end, { fiscal_year_end: end, revenue: null, net_income: null, operating_cash_flow: null, capex: null, free_cash_flow: null });
    return byEnd.get(end);
  };
  for (const r of incRows) Object.assign(row(r.report_period), { revenue: num(r.revenue), net_income: num(r.net_income) });
  for (const r of cfRows) {
    Object.assign(row(r.report_period), {
      operating_cash_flow: num(r.net_cash_flow_from_operations),
      capex: num(r.capital_expenditure),
      free_cash_flow: num(r.free_cash_flow),
    });
  }
  return { data: [...byEnd.values()], cached_at, offline: false };
}

async function ratios(ticker) {
  const e = await get('/financial-metrics/snapshot/', { ticker }, `fd:ratios:${ticker}`);
  const data = e.data ? (e.data.snapshot || e.data) : null;
  return { data, cached_at: e.cached_at, offline: !!e.offline };
}

module.exports = { ready, annual, ratios };
