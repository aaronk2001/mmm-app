'use strict';

// One annual-financials shape for every Research source. Growth and derived
// free cash flow are computed here, in code — the research model only quotes
// these figures, it never calculates them.

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function yoy(series) {
  return series.map((v, i) => {
    const prev = i > 0 ? series[i - 1] : null;
    if (v === null || prev === null || prev === 0) return null;
    return Math.round(((v - prev) / Math.abs(prev)) * 1000) / 10;
  });
}

const FIGURES = ['revenue', 'net_income', 'operating_cash_flow', 'capex', 'free_cash_flow'];

// Growth goes on each year's own row, labelled FYyyyy, and empty years are
// dropped: a 1.5B model mis-aligned parallel growth arrays with the year list
// and shifted every year label by one (live MSFT run, 2026-09-30).
function withGrowth(years) {
  const ys = [...years]
    .map((r) => ({
      ...r,
      free_cash_flow: r.free_cash_flow ?? (r.operating_cash_flow != null && r.capex != null ? r.operating_cash_flow + r.capex : null),
    }))
    .filter((r) => FIGURES.some((k) => r[k] != null))
    .sort((a, b) => (a.fiscal_year_end < b.fiscal_year_end ? -1 : 1));
  const rev = yoy(ys.map((r) => r.revenue));
  const ni = yoy(ys.map((r) => r.net_income));
  const fcf = yoy(ys.map((r) => r.free_cash_flow));
  return {
    years: ys.map((r, i) => ({
      fiscal_year: `FY${r.fiscal_year_end.slice(0, 4)}`,
      ...r,
      revenue_yoy_pct: rev[i],
      net_income_yoy_pct: ni[i],
      free_cash_flow_yoy_pct: fcf[i],
    })),
  };
}

// Yahoo stamps fiscal period ends at UTC midnight, so the UTC date IS the day.
// yahoo-finance2 4.x returns unprefixed field names (totalRevenue, …), not the
// `annual…` names its own docstring shows — checked against a live response.
function fromYahoo(rows) {
  return (rows || []).filter((r) => r && r.date).map((r) => ({
    fiscal_year_end: new Date(r.date).toISOString().slice(0, 10),
    revenue: num(r.totalRevenue),
    net_income: num(r.netIncome),
    operating_cash_flow: num(r.operatingCashFlow),
    capex: num(r.capitalExpenditure),
    free_cash_flow: num(r.freeCashFlow),
  }));
}

module.exports = { withGrowth, fromYahoo, num };
