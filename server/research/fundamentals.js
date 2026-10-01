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

function withGrowth(years) {
  const ys = [...years]
    .sort((a, b) => (a.fiscal_year_end < b.fiscal_year_end ? -1 : 1))
    .map((r) => ({
      ...r,
      free_cash_flow: r.free_cash_flow ?? (r.operating_cash_flow != null && r.capex != null ? r.operating_cash_flow + r.capex : null),
    }));
  return {
    years: ys,
    growth: {
      revenue_yoy_pct: yoy(ys.map((r) => r.revenue)),
      net_income_yoy_pct: yoy(ys.map((r) => r.net_income)),
      free_cash_flow_yoy_pct: yoy(ys.map((r) => r.free_cash_flow)),
    },
  };
}

// Yahoo stamps fiscal period ends at UTC midnight, so the UTC date IS the day.
function fromYahoo(rows) {
  return (rows || []).filter((r) => r && r.date).map((r) => ({
    fiscal_year_end: new Date(r.date).toISOString().slice(0, 10),
    revenue: num(r.annualTotalRevenue),
    net_income: num(r.annualNetIncome),
    operating_cash_flow: num(r.annualOperatingCashFlow),
    capex: num(r.annualCapitalExpenditure),
    free_cash_flow: num(r.annualFreeCashFlow),
  }));
}

module.exports = { withGrowth, fromYahoo, num };
