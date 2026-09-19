'use strict';

// Backtest performance metrics — pure, no I/O. Turns an equity curve + a
// trade ledger into the numbers a user judges a strategy by. These figures
// ARE the feature: a wrong Sharpe ratio produces a wrong conclusion about
// the user's own money and nothing downstream will contradict it.
//
// INPUT CONTRACT (per docs/superpowers/plans/2026-09-18-sprintB-backtester.md
// Track 2, agreed before Track 1 landed — adapt here + note in the report if
// Track 1's real engine.js output differs):
//   metrics(equityCurve, trades, benchmark, splitDate)
//     equityCurve: [{ date: 'YYYY-MM-DD', equity_cents: number }], sorted
//       ascending by date, equity_cents is total marked equity (cash +
//       positions) in integer cents.
//     trades: DEVIATION FROM THE ORIGINAL BRIEF, recorded here per the
//       brief's own instruction to adapt once Track 1's engine.js lands and
//       say so. The brief assumed trades carried a `pnl_cents` field per
//       closed round-trip. The real, landed `server/backtest/engine.js`
//       Trade record is one fill leg (not a round-trip) shaped
//       `{id, symbol, side: 'buy'|'sell', qty, date, priceCents, grossCents,
//       commissionCents, slippageCents, cashDeltaCents, decisionIndex}` —
//       camelCase, and it never carries a realized P&L. Win rate / profit
//       factor need one, so `reconstructRealizedPnlCents` below replays the
//       SAME average-cost accounting engine.js itself uses
//       (avgCostCents = (priorCost*priorQty + grossCents) / newQty on a buy)
//       to derive each sell's P&L. Both `qty`/`shares` and
//       `priceCents`/`price_cents` naming are accepted (see the `trade*`
//       accessor helpers) so this keeps working if that naming ever changes
//       again; if a trade entry already carries an explicit finite
//       `pnl_cents`, that value is trusted as-is instead of being
//       re-derived. A trade entry may also be an external cash-flow marker
//       `{ date, type: 'deposit'|'withdrawal', amount_cents }` for TWR/XIRR —
//       engine.js's real ledger never produces these (there is no
//       investor-cash-flow concept in this backtester), so that path is
//       currently unexercised by production data but is kept for forward
//       compatibility and is unit-tested directly. Everything here tolerates
//       trades being absent, empty, or missing optional fields.
//     benchmark: same shape as equityCurve — an independent equity/value
//       curve (e.g. a buy-and-hold SPY curve) used only for beta/alpha/
//       tracking error. null/undefined/empty is a valid "no benchmark" input.
//     splitDate: optional 'YYYY-MM-DD'. When given, `metrics()` additionally
//       reports in-sample (dates <= splitDate) and holdout (dates >=
//       splitDate) metrics and the gap between them. The boundary date is
//       intentionally shared by both slices — you need that shared anchor
//       point to compute a period return starting exactly at the split.
//
// ANNUALIZATION CONVENTION (state it once, use it everywhere):
//   - Calendar-time figures (CAGR, XIRR's day-count fraction) use actual
//     elapsed calendar days / 365 per year (CALENDAR_DAYS_PER_YEAR). Chosen
//     over 365.25 so date-fixture arithmetic in tests is exact, not just
//     close; the difference between the two conventions is <0.07% error in
//     any per-year rate and both are equally "standard".
//   - Return-series figures (volatility, Sharpe, Sortino, tracking error,
//     alpha) assume the equity curve is sampled once per TRADING day and
//     annualize a per-period statistic with sqrt(TRADING_DAYS_PER_YEAR) (or,
//     for the mean-return-based alpha, a straight x TRADING_DAYS_PER_YEAR
//     scale-up — not compounded). TRADING_DAYS_PER_YEAR = 252. If the caller
//     ever feeds a non-daily curve (weekly bars, say) these annualized
//     figures are still internally consistent but no longer "per trading
//     year" — that's a caller-side revisit, not a bug here.
//   - Risk-free rate is assumed 0 for Sharpe (the 3-arg contract has no slot
//     for one). Sortino's target return is 0 (a losing period is any period
//     with a negative return, not underperformance-vs-rf).
//
// NULL CASES — every ratio/rate metric returns `null` (never NaN/Infinity)
// when its denominator is degenerate or its inputs are insufficient. Exact
// list is in each function's @returns doc and repeated in the composite
// `metrics()` doc below. The one deliberate non-null default is
// `totalCosts`, which is legitimately 0 (not "unknown") when there are no
// trades.

const CALENDAR_DAYS_PER_YEAR = 365;
const TRADING_DAYS_PER_YEAR = 252;
const MS_PER_DAY = 86400000;

// ---------------------------------------------------------------------------
// Local-date helpers — the runway.js pattern. Never toISOString() for a day
// key, never new Date('YYYY-MM-DD') (that parses as UTC and silently shifts
// a day under local timezones west of UTC, which is exactly the bug that hit
// server/money/calc.js).
// ---------------------------------------------------------------------------
function dateKey(d) {
  return String(d).slice(0, 10);
}
function localDateFromStr(s) {
  const [y, mo, d] = dateKey(s).split('-').map(Number);
  return new Date(y, mo - 1, d);
}
function daysBetween(a, b) {
  return Math.round((localDateFromStr(b) - localDateFromStr(a)) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------
function mean(arr) {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

/** Sample standard deviation (ddof=1). Needs n>=2, else null. */
function sampleStdev(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  const variance = arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/**
 * Simple period-over-period returns from an equity curve. A period whose
 * starting equity is <=0 can't produce a meaningful return (division by a
 * non-positive base) and is dropped rather than propagating a NaN/Infinity.
 * @param {Array<{date: string, equity_cents: number}>} curve
 * @returns {number[]}
 */
function periodReturns(curve) {
  const out = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1].equity_cents;
    if (!(prev > 0)) continue;
    out.push(curve[i].equity_cents / prev - 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// CAGR
// ---------------------------------------------------------------------------
/**
 * Compound annual growth rate over the full span of the curve.
 * @param {Array<{date: string, equity_cents: number}>} equityCurve
 * @returns {number|null} fraction (0.10 = 10%/yr); null when there are fewer
 *   than 2 points, the elapsed time is 0 days, or starting equity is <=0.
 */
function cagr(equityCurve) {
  if (!Array.isArray(equityCurve) || equityCurve.length < 2) return null;
  const first = equityCurve[0];
  const last = equityCurve[equityCurve.length - 1];
  if (!(first.equity_cents > 0)) return null;
  const days = daysBetween(first.date, last.date);
  if (days <= 0) return null;
  const years = days / CALENDAR_DAYS_PER_YEAR;
  return Math.pow(last.equity_cents / first.equity_cents, 1 / years) - 1;
}

// ---------------------------------------------------------------------------
// Max drawdown
// ---------------------------------------------------------------------------
/**
 * Largest peak-to-trough decline and the dates that bound it.
 * @param {Array<{date: string, equity_cents: number}>} equityCurve
 * @returns {{pct: number|null, startDate: string|null, endDate: string|null}}
 *   pct is negative (e.g. -0.5 = a 50% drawdown). startDate is the date of
 *   the peak the drawdown fell from; endDate is the date of the trough.
 *   All three are null when there are fewer than 2 points or every equity
 *   reading is <=0 (no valid peak to measure from).
 */
function maxDrawdown(equityCurve) {
  const empty = { pct: null, startDate: null, endDate: null };
  if (!Array.isArray(equityCurve) || equityCurve.length < 2) return empty;

  let peak = null;
  let peakDate = null;
  let worst = 0;
  let worstStart = null;
  let worstEnd = null;

  for (const point of equityCurve) {
    if (!(point.equity_cents > 0)) continue;
    if (peak === null || point.equity_cents > peak) {
      peak = point.equity_cents;
      peakDate = point.date;
    }
    const dd = point.equity_cents / peak - 1;
    // Seed worst/worstStart/worstEnd on the first valid point too, so a
    // curve that never declines still reports a well-defined 0% drawdown
    // (at that point) instead of a null shape — the data exists, the
    // drawdown really is zero, that's not "can't compute this".
    if (worstStart === null || dd < worst) {
      worst = dd;
      worstStart = peakDate;
      worstEnd = point.date;
    }
  }

  if (peak === null) return empty;
  return { pct: worst, startDate: worstStart, endDate: worstEnd };
}

// ---------------------------------------------------------------------------
// Volatility / Sharpe / Sortino / Calmar
// ---------------------------------------------------------------------------
/**
 * Annualized volatility of the equity curve's period returns.
 * @param {Array<{date: string, equity_cents: number}>} equityCurve
 * @returns {number|null} null when fewer than 2 usable period returns exist.
 */
function volatility(equityCurve) {
  if (!Array.isArray(equityCurve)) return null;
  const rets = periodReturns(equityCurve);
  const sd = sampleStdev(rets);
  return sd === null ? null : sd * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * @param {Array<{date: string, equity_cents: number}>} equityCurve
 * @param {number} [riskFreeRate=0] per-period risk-free rate to subtract before annualizing.
 * @returns {number|null} null on <2 returns or zero return variance (undefined ratio).
 */
function sharpeRatio(equityCurve, riskFreeRate = 0) {
  if (!Array.isArray(equityCurve)) return null;
  const rets = periodReturns(equityCurve);
  const sd = sampleStdev(rets);
  if (sd === null || sd === 0) return null;
  const excess = mean(rets) - riskFreeRate;
  return (excess / sd) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * @param {Array<{date: string, equity_cents: number}>} equityCurve
 * @param {number} [targetReturn=0]
 * @returns {number|null} null on <2 returns or zero downside deviation
 *   (every period beat the target — the ratio is undefined, not infinite).
 */
function sortinoRatio(equityCurve, targetReturn = 0) {
  if (!Array.isArray(equityCurve)) return null;
  const rets = periodReturns(equityCurve);
  if (rets.length < 2) return null;
  const downside = rets.map((r) => Math.min(0, r - targetReturn));
  const downsideDev = Math.sqrt(downside.reduce((s, d) => s + d * d, 0) / rets.length);
  if (downsideDev === 0) return null;
  const excess = mean(rets) - targetReturn;
  return (excess / downsideDev) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * @param {Array<{date: string, equity_cents: number}>} equityCurve
 * @returns {number|null} CAGR / |max drawdown|; null if either is null or
 *   max drawdown is 0 (no decline to divide by).
 */
function calmarRatio(equityCurve) {
  const c = cagr(equityCurve);
  const dd = maxDrawdown(equityCurve);
  if (c === null || dd.pct === null || dd.pct === 0) return null;
  return c / Math.abs(dd.pct);
}

// ---------------------------------------------------------------------------
// Trade-ledger metrics
// ---------------------------------------------------------------------------
function tradeQty(t) {
  return Number.isFinite(t?.qty) ? t.qty : t?.shares;
}
function tradePriceCents(t) {
  return Number.isFinite(t?.priceCents) ? t.priceCents : t?.price_cents;
}
function tradeCommissionCents(t) {
  const v = Number.isFinite(t?.commissionCents) ? t.commissionCents : t?.commission_cents;
  return v || 0;
}
function tradeSlippageCents(t) {
  const v = Number.isFinite(t?.slippageCents) ? t.slippageCents : t?.slippage_cents;
  return v || 0;
}

/**
 * Derives one realized P&L figure per closing ('sell') fill by replaying
 * engine.js's own average-cost accounting per symbol in ledger order:
 * a buy updates avgCost = (priorCost*priorQty + grossCents) / newQty; a
 * sell's P&L is its net cash proceeds minus (avgCost * qty sold) at that
 * moment. Buys contribute no realized P&L (they open/add to a position).
 * A trade that already carries an explicit finite `pnl_cents` is trusted
 * as-is rather than re-derived.
 * @param {Array<object>} trades
 * @returns {number[]} one entry per closed round-trip, in cents.
 */
function reconstructRealizedPnlCents(trades) {
  const avgCost = {};
  const heldQty = {};
  const out = [];
  for (const t of trades || []) {
    if (!t) continue;
    if (Number.isFinite(t.pnl_cents)) { out.push(t.pnl_cents); continue; }
    if (t.side !== 'buy' && t.side !== 'sell') continue; // not a fill (e.g. a deposit/withdrawal marker)
    const qty = tradeQty(t);
    const priceCents = tradePriceCents(t);
    if (!Number.isFinite(qty) || !Number.isFinite(priceCents)) continue;
    const sym = t.symbol ?? '__default__';
    if (!(sym in avgCost)) { avgCost[sym] = 0; heldQty[sym] = 0; }
    if (t.side === 'buy') {
      const gross = Number.isFinite(t.grossCents) ? t.grossCents : priceCents * qty;
      const priorCostCents = avgCost[sym] * heldQty[sym];
      heldQty[sym] += qty;
      avgCost[sym] = heldQty[sym] > 0 ? (priorCostCents + gross) / heldQty[sym] : 0;
    } else {
      const proceedsCents = Number.isFinite(t.cashDeltaCents) ? t.cashDeltaCents : priceCents * qty - tradeCommissionCents(t);
      const basisCents = avgCost[sym] * qty;
      out.push(proceedsCents - basisCents);
      heldQty[sym] -= qty;
      if (heldQty[sym] <= 0) { avgCost[sym] = 0; heldQty[sym] = 0; }
    }
  }
  return out;
}

/**
 * @param {Array<object>} trades
 * @returns {number|null} fraction of closed (realized-P&L) trades that were
 *   profitable; null when there are no closed trades to rate.
 */
function winRate(trades) {
  const pnls = reconstructRealizedPnlCents(trades);
  if (pnls.length === 0) return null;
  const wins = pnls.filter((p) => p > 0).length;
  return wins / pnls.length;
}

/**
 * @param {Array<object>} trades
 * @returns {number|null} gross profit / gross loss (both positive terms).
 *   null when there are no closed trades, no losses (ratio undefined/
 *   infinite), or no wins (an all-losses ledger — a 0 here would be
 *   technically defined but is called out in the brief as a required null
 *   guard, so it's treated the same as the all-wins case).
 */
function profitFactor(trades) {
  const pnls = reconstructRealizedPnlCents(trades);
  if (pnls.length === 0) return null;
  const grossProfit = pnls.filter((p) => p > 0).reduce((s, p) => s + p, 0);
  const grossLoss = pnls.filter((p) => p < 0).reduce((s, p) => s - p, 0);
  if (grossLoss === 0 || grossProfit === 0) return null;
  return grossProfit / grossLoss;
}

/**
 * Notional traded (both buys and sells) as a multiple of average equity
 * over the period.
 * @param {Array<object>} trades
 * @param {Array<{date: string, equity_cents: number}>} equityCurve
 * @returns {number|null} null with no fills or no positive average equity.
 */
function turnover(trades, equityCurve) {
  const fills = Array.isArray(trades)
    ? trades.filter((t) => t && Number.isFinite(tradeQty(t)) && Number.isFinite(tradePriceCents(t)))
    : [];
  if (fills.length === 0) return null;
  if (!Array.isArray(equityCurve) || equityCurve.length === 0) return null;
  const avgEquity = mean(equityCurve.map((e) => e.equity_cents));
  if (!(avgEquity > 0)) return null;
  const notional = fills.reduce((s, t) => s + Math.abs(tradeQty(t) * tradePriceCents(t)), 0);
  return notional / avgEquity;
}

/**
 * @param {Array<object>} trades
 * @returns {number} total commission + slippage in integer cents. 0 (not
 *   null) with no trades — "no costs" is a known fact, not missing data.
 */
function totalCosts(trades) {
  if (!Array.isArray(trades)) return 0;
  return trades.reduce((s, t) => s + tradeCommissionCents(t) + tradeSlippageCents(t), 0);
}

// ---------------------------------------------------------------------------
// Benchmark-relative: beta / alpha / tracking error
// ---------------------------------------------------------------------------
/**
 * Aligns portfolio and benchmark period returns by shared date keys.
 * @returns {{port: number[], bench: number[]}|null} null when the benchmark
 *   is missing/empty or fewer than 2 aligned returns can be formed.
 */
function alignedReturns(equityCurve, benchmark) {
  if (!Array.isArray(equityCurve) || !Array.isArray(benchmark) || benchmark.length === 0) return null;
  const benchByDate = new Map(benchmark.map((b) => [dateKey(b.date), b.equity_cents]));
  const common = equityCurve.filter((e) => benchByDate.has(dateKey(e.date)));
  if (common.length < 3) return null; // need >=2 aligned returns for a variance
  const port = [];
  const bench = [];
  for (let i = 1; i < common.length; i++) {
    const pPrev = common[i - 1].equity_cents;
    const pCur = common[i].equity_cents;
    const bPrev = benchByDate.get(dateKey(common[i - 1].date));
    const bCur = benchByDate.get(dateKey(common[i].date));
    if (!(pPrev > 0) || !(bPrev > 0)) continue;
    port.push(pCur / pPrev - 1);
    bench.push(bCur / bPrev - 1);
  }
  if (port.length < 2) return null;
  return { port, bench };
}

/**
 * @param {Array<{date: string, equity_cents: number}>} equityCurve
 * @param {Array<{date: string, equity_cents: number}>|null|undefined} benchmark
 * @returns {number|null} null with no benchmark, too few aligned points, or
 *   zero benchmark variance (an undefined slope).
 */
function beta(equityCurve, benchmark) {
  const aligned = alignedReturns(equityCurve, benchmark);
  if (aligned === null) return null;
  const { port, bench } = aligned;
  const mp = mean(port);
  const mb = mean(bench);
  // n-divisor cancels between cov and var, so population vs sample doesn't
  // matter here — only used relative to each other.
  const cov = port.reduce((s, p, i) => s + (p - mp) * (bench[i] - mb), 0) / port.length;
  const varBench = bench.reduce((s, b) => s + (b - mb) * (b - mb), 0) / bench.length;
  if (varBench === 0) return null;
  return cov / varBench;
}

/**
 * Jensen's alpha, annualized by scaling the mean daily excess (not
 * compounded — a simplification documented in the header).
 * @returns {number|null} null when beta is null (no benchmark / degenerate variance).
 */
function alpha(equityCurve, benchmark) {
  const aligned = alignedReturns(equityCurve, benchmark);
  const b = beta(equityCurve, benchmark);
  if (aligned === null || b === null) return null;
  const dailyAlpha = mean(aligned.port) - b * mean(aligned.bench);
  return dailyAlpha * TRADING_DAYS_PER_YEAR;
}

/**
 * Annualized stdev of (portfolio return - benchmark return).
 * @returns {number|null} null with no benchmark or too few aligned points.
 */
function trackingError(equityCurve, benchmark) {
  const aligned = alignedReturns(equityCurve, benchmark);
  if (aligned === null) return null;
  const diffs = aligned.port.map((p, i) => p - aligned.bench[i]);
  const sd = sampleStdev(diffs);
  return sd === null ? null : sd * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

// ---------------------------------------------------------------------------
// TWR — time-weighted return
// ---------------------------------------------------------------------------
/**
 * Geometrically links period returns after backing out external cash flows
 * (trades with type 'deposit'/'withdrawal'), so the result isn't distorted
 * by *when* money was added/removed — unlike a naive (end-start)/start,
 * which a mid-period deposit inflates.
 * @param {Array<{date: string, equity_cents: number}>} equityCurve
 * @param {Array<object>} [trades]
 * @returns {number|null} null on <2 points or a non-positive base equity
 *   anywhere in the curve (can't link a return off it).
 */
function timeWeightedReturn(equityCurve, trades) {
  if (!Array.isArray(equityCurve) || equityCurve.length < 2) return null;
  const flowByDate = new Map();
  for (const t of trades || []) {
    if (!t || !Number.isFinite(t.amount_cents)) continue;
    const k = dateKey(t.date);
    if (t.type === 'deposit') flowByDate.set(k, (flowByDate.get(k) || 0) + Math.abs(t.amount_cents));
    else if (t.type === 'withdrawal') flowByDate.set(k, (flowByDate.get(k) || 0) - Math.abs(t.amount_cents));
  }
  let linked = 1;
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity_cents;
    if (!(prev > 0)) return null;
    const flow = flowByDate.get(dateKey(equityCurve[i].date)) || 0;
    const r = (equityCurve[i].equity_cents - flow) / prev - 1;
    linked *= 1 + r;
  }
  return linked - 1;
}

// ---------------------------------------------------------------------------
// XIRR — money-weighted return via a real root-finder
// ---------------------------------------------------------------------------
/**
 * Solves for the periodic (annualized) rate r that zeroes the NPV of a
 * dated cash-flow series, using actual/365 day-count fractions.
 *
 * Approach: Newton's method from r0=0.1, capped at 50 iterations, 1e-7
 * tolerance on NPV. If Newton fails to converge (flat/zero derivative, a
 * runaway step past -100%/period, or the iteration cap), falls back to
 * bisection over a wide bracket [-99.99%, +1000%] *only if* that bracket
 * contains a sign change (a necessary condition for a real root); bisection
 * runs a further capped 200 iterations. If neither converges — no sign
 * change in the fallback bracket, non-finite derivative, or the tolerance
 * is never met — returns `null` rather than a root that hasn't been
 * verified. This can never hang: both loops have hard iteration caps.
 * @param {Array<{date: string, amount_cents: number}>} cashflows negative = outflow, positive = inflow.
 * @returns {number|null} annualized rate as a fraction, or null on failure
 *   to find/verify a root (including <2 flows or all-same-sign flows, which
 *   have no real root).
 */
function xirr(cashflows) {
  if (!Array.isArray(cashflows) || cashflows.length < 2) return null;
  const sorted = [...cashflows].sort((a, b) => (dateKey(a.date) < dateKey(b.date) ? -1 : dateKey(a.date) > dateKey(b.date) ? 1 : 0));
  const amounts = sorted.map((cf) => (cf.amount_cents || 0) / 100);
  if (!amounts.some((a) => a > 0) || !amounts.some((a) => a < 0)) return null;
  const years = sorted.map((cf) => daysBetween(sorted[0].date, cf.date) / CALENDAR_DAYS_PER_YEAR);

  const npv = (r) => amounts.reduce((s, a, i) => s + a / Math.pow(1 + r, years[i]), 0);
  const dnpv = (r) => amounts.reduce((s, a, i) => (years[i] === 0 ? s : s - (a * years[i]) / Math.pow(1 + r, years[i] + 1)), 0);

  const TOL = 1e-7;
  let r = 0.1;
  let converged = false;
  for (let i = 0; i < 50; i++) {
    const f = npv(r);
    if (Math.abs(f) < TOL) { converged = true; break; }
    const df = dnpv(r);
    if (!Number.isFinite(df) || df === 0) break;
    const next = r - f / df;
    if (!Number.isFinite(next) || next <= -0.999999) break;
    if (Math.abs(next - r) < TOL) { r = next; converged = true; break; }
    r = next;
  }

  if (!converged) {
    let lo = -0.9999;
    let hi = 10;
    let flo = npv(lo);
    let fhi = npv(hi);
    if (Number.isFinite(flo) && Number.isFinite(fhi) && flo * fhi < 0) {
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        const fmid = npv(mid);
        if (Math.abs(fmid) < TOL) { r = mid; converged = true; break; }
        if (flo * fmid < 0) { hi = mid; fhi = fmid; } else { lo = mid; flo = fmid; }
        r = mid;
      }
      if (!converged) converged = Math.abs(npv(r)) < 1e-4;
    }
  }

  return converged && Number.isFinite(r) ? r : null;
}

/**
 * Builds the cash-flow series XIRR needs for a whole backtest: an initial
 * outflow of the starting equity, an inflow of the ending equity, plus any
 * external deposit/withdrawal markers found on the trade ledger in between.
 * Buy/sell fills are strategy-internal and are deliberately NOT cash flows
 * here (see module header).
 */
function buildXirrCashflows(equityCurve, trades) {
  if (!Array.isArray(equityCurve) || equityCurve.length < 2) return null;
  const flows = [{ date: equityCurve[0].date, amount_cents: -equityCurve[0].equity_cents }];
  for (const t of trades || []) {
    if (!t || !Number.isFinite(t.amount_cents)) continue;
    if (t.type === 'deposit') flows.push({ date: t.date, amount_cents: -Math.abs(t.amount_cents) });
    else if (t.type === 'withdrawal') flows.push({ date: t.date, amount_cents: Math.abs(t.amount_cents) });
  }
  const last = equityCurve[equityCurve.length - 1];
  flows.push({ date: last.date, amount_cents: last.equity_cents });
  return flows;
}

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------
function sliceCurve(curve, predicate) {
  return Array.isArray(curve) ? curve.filter(predicate) : [];
}

/** Non-recursive core so in-sample/holdout slices don't re-trigger themselves. */
function computeCore(equityCurve, trades, benchmark) {
  return {
    cagr: cagr(equityCurve),
    maxDrawdown: maxDrawdown(equityCurve),
    sharpe: sharpeRatio(equityCurve),
    sortino: sortinoRatio(equityCurve),
    calmar: calmarRatio(equityCurve),
    volatility: volatility(equityCurve),
    winRate: winRate(trades),
    profitFactor: profitFactor(trades),
    turnover: turnover(trades, equityCurve),
    totalCostsCents: totalCosts(trades),
    beta: beta(equityCurve, benchmark),
    alpha: alpha(equityCurve, benchmark),
    trackingError: trackingError(equityCurve, benchmark),
    twr: timeWeightedReturn(equityCurve, trades),
    xirr: xirr(buildXirrCashflows(equityCurve, trades)),
  };
}

/**
 * @param {Array<{date: string, equity_cents: number}>} equityCurve
 * @param {Array<object>} [trades]
 * @param {Array<{date: string, equity_cents: number}>|null} [benchmark]
 * @param {string|null} [splitDate] 'YYYY-MM-DD'; when given, adds inSample/holdout/inSampleHoldoutGap.
 * @returns {{
 *   cagr: number|null, maxDrawdown: {pct: number|null, startDate: string|null, endDate: string|null},
 *   sharpe: number|null, sortino: number|null, calmar: number|null, volatility: number|null,
 *   winRate: number|null, profitFactor: number|null, turnover: number|null, totalCostsCents: number,
 *   beta: number|null, alpha: number|null, trackingError: number|null, twr: number|null, xirr: number|null,
 *   inSample: object|null, holdout: object|null,
 *   inSampleHoldoutGap: {cagrGap: number|null, sharpeGap: number|null}|null
 * }}
 */
function metrics(equityCurve, trades = [], benchmark = null, splitDate = null) {
  const core = computeCore(equityCurve, trades, benchmark);
  let inSample = null;
  let holdout = null;
  let gap = null;
  if (splitDate) {
    const split = dateKey(splitDate);
    const inCurve = sliceCurve(equityCurve, (e) => dateKey(e.date) <= split);
    const outCurve = sliceCurve(equityCurve, (e) => dateKey(e.date) >= split);
    const inTrades = sliceCurve(trades, (t) => dateKey(t.date) <= split);
    const outTrades = sliceCurve(trades, (t) => dateKey(t.date) >= split);
    inSample = computeCore(inCurve, inTrades, benchmark);
    holdout = computeCore(outCurve, outTrades, benchmark);
    gap = {
      cagrGap: inSample.cagr !== null && holdout.cagr !== null ? holdout.cagr - inSample.cagr : null,
      sharpeGap: inSample.sharpe !== null && holdout.sharpe !== null ? holdout.sharpe - inSample.sharpe : null,
    };
  }
  return { ...core, inSample, holdout, inSampleHoldoutGap: gap };
}

/** Standalone entry point mirroring metrics()'s inSample/holdout/gap fields, for direct testing. */
function inSampleHoldoutGap(equityCurve, trades, benchmark, splitDate) {
  return metrics(equityCurve, trades, benchmark, splitDate).inSampleHoldoutGap;
}

module.exports = {
  CALENDAR_DAYS_PER_YEAR,
  TRADING_DAYS_PER_YEAR,
  cagr,
  maxDrawdown,
  volatility,
  sharpeRatio,
  sortinoRatio,
  calmarRatio,
  winRate,
  profitFactor,
  turnover,
  totalCosts,
  beta,
  alpha,
  trackingError,
  timeWeightedReturn,
  xirr,
  buildXirrCashflows,
  inSampleHoldoutGap,
  metrics,
};
