'use strict';

// Backtest engine. Clean-room from docs/superpowers/plans/2026-09-18-sprintB-backtester.md
// §Track 1 — see docs/references.md for provenance. Pure; no I/O, no
// Math.random, no wall-clock reads: same config in, same result out.
//
// Money is integer cents throughout. Bars arrive as dollar floats (the
// natural shape of a price feed / CSV) and are converted to cents at the
// boundary; the equity curve and trade ledger this module returns carry only
// integer cents. Dates are compared as local 'YYYY-MM-DD' strings — the
// engine never constructs a Date object, so there is nothing for UTC/local
// parsing to silently disagree about.
//
// Event order per bar i (mirrors the brief, with one deliberate deviation —
// see the corporate-actions comment below):
//   corporate actions -> mark -> cash flows -> strategy.onBar(view) ->
//   target weights -> risk clamp -> orders -> fill at bar (i+1)'s open.
//
// The strategy only ever sees bars[0..i] through the view (currentIndex =
// i+1); it never sees bar i+1, so it cannot know the price its own order
// will fill at. The engine, deciding order SIZE, prices that decision off
// bar i's close (the most recent bar the strategy itself could have seen) —
// the same figure used to mark equity for bar i's curve point — and the fill
// itself always uses the real bar (i+1).open, unreachable through the view.

const { createUniverseView } = require('./view');
const crypto = require('crypto');

const DEFAULT_SLIPPAGE_BPS = 10; // 0.10%, matches paper-store.js SLIPPAGE_RATE
const DEFAULT_COMMISSION_CENTS = 100; // $1 flat, matches paper-store.js COMMISSION_CENTS
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const toCents = (dollars) => Math.round(dollars * 100);

/**
 * Long-only risk clamp: caps each symbol's weight at maxWeightPerAsset, then
 * scales the whole vector down (never up) if gross exposure exceeds 100%.
 * Idempotent: every value written is already within bounds after one pass,
 * so a second pass is a no-op (the >1 rescale test uses an epsilon so a
 * float-rounded ~1.0 total from the first pass never re-triggers rescaling).
 * @param {Object<string, number>} weights
 * @param {{maxWeightPerAsset?: number}} [opts]
 * @returns {Object<string, number>}
 */
function clampWeights(weights, { maxWeightPerAsset = 1 } = {}) {
  const EPS = 1e-9;
  const out = {};
  for (const [sym, w] of Object.entries(weights)) {
    out[sym] = Math.max(0, Math.min(maxWeightPerAsset, Number(w) || 0));
  }
  const total = Object.values(out).reduce((s, w) => s + w, 0);
  if (total > 1 + EPS) {
    const scale = 1 / total;
    for (const sym of Object.keys(out)) out[sym] *= scale;
  }
  return out;
}

function validateConfig(config) {
  const symbols = Object.keys(config.bars || {});
  if (symbols.length === 0) throw new Error('runBacktest: config.bars must have at least one symbol');
  if (!config.strategy || typeof config.strategy.onBar !== 'function') {
    throw new Error('runBacktest: config.strategy.onBar must be a function');
  }
  if (!Number.isInteger(config.initialCashCents) || config.initialCashCents < 0) {
    throw new Error('runBacktest: config.initialCashCents must be a non-negative integer');
  }
  const n = config.bars[symbols[0]].length;
  if (n === 0) throw new Error('runBacktest: bar arrays must not be empty');
  for (const s of symbols) {
    const arr = config.bars[s];
    if (!Array.isArray(arr) || arr.length !== n) {
      throw new Error(`runBacktest: symbol "${s}" has ${arr && arr.length} bars, expected ${n}`);
    }
    arr.forEach((b, i) => {
      if (!YMD_RE.test(String(b.date))) throw new Error(`runBacktest: bad date "${b.date}" for "${s}"[${i}]`);
      if (b.date !== config.bars[symbols[0]][i].date) {
        throw new Error(`runBacktest: date mismatch at index ${i}: "${s}"=${b.date} vs "${symbols[0]}"=${config.bars[symbols[0]][i].date}`);
      }
    });
  }
  return { symbols, n };
}

function hashResult(result) {
  return crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
}

/**
 * @typedef {{date: string, equity_cents: number}} EquityPoint
 * @typedef {{id: number, symbol: string, side: ('buy'|'sell'), qty: number, date: string, priceCents: number, grossCents: number, commissionCents: number, slippageCents: number, cashDeltaCents: number, decisionIndex: number, pnl_cents?: number}} Trade
 *   pnl_cents is present on 'sell' fills only — realized P&L against the
 *   split-adjusted average cost held at the moment of the sell (correct
 *   across corporate actions, unlike a downstream replay of the ledger that
 *   doesn't know about splits). Absent on 'buy' fills (no realized P&L to
 *   report; they only open/add to a position).
 */

/**
 * Runs a deterministic, look-ahead-free backtest over one or more aligned
 * per-symbol bar series.
 * @param {object} config
 * @param {Object<string, Array<{date: string, open: number, high: number, low: number, close: number, volume?: number, split?: number, dividend?: number}>>} config.bars
 *   Dollar-denominated OHLC bars per symbol, one array per symbol, all the
 *   same length with identical dates at each index. `split` (default 1) is
 *   the multiplier effective AT this bar (e.g. 2 for a 2:1 split); `dividend`
 *   (default 0) is a per-share cash dividend paid at this bar, both dollars.
 * @param {{onBar: function(object, object): ({weights: Object<string, number>}|null|undefined)}} config.strategy
 *   `onBar(view, ctx)` returns a full-or-partial target-weight map (symbols
 *   omitted from it keep their current weight) or null/undefined for no change.
 * @param {number} config.initialCashCents
 * @param {number} [config.slippageBps=10]  applied against the side that hurts.
 * @param {number} [config.commissionCents=100]  flat, charged on every fill.
 * @param {number} [config.maxWeightPerAsset=1]  risk-clamp cap per symbol.
 * @returns {{equityCurve: EquityPoint[], trades: Trade[], finalCashCents: number, finalPositions: Object<string, {qty: number, avgCostCents: number}>, resultHash: string}}
 */
function runBacktest(config) {
  const { symbols, n: N } = validateConfig(config);
  const {
    strategy,
    initialCashCents,
    slippageBps = DEFAULT_SLIPPAGE_BPS,
    commissionCents = DEFAULT_COMMISSION_CENTS,
    maxWeightPerAsset = 1,
  } = config;

  const bars = {};
  for (const s of symbols) bars[s] = config.bars[s].map((b) => Object.freeze({ split: 1, dividend: 0, ...b }));

  let cashCents = initialCashCents;
  const qty = {};
  const avgCostCents = {};
  for (const s of symbols) { qty[s] = 0; avgCostCents[s] = 0; }

  const equityCurve = [];
  const trades = [];
  let nextId = 1;

  for (let i = 0; i < N; i++) {
    // Corporate actions BEFORE mark. The brief lists mark before corporate
    // actions, but a split is only equity-invariant if shares are already
    // split-adjusted when marked against this same bar's (already
    // post-split) close — see docs/references.md for the full note.
    for (const s of symbols) {
      const split = bars[s][i].split;
      if (split && split !== 1 && qty[s] !== 0) {
        qty[s] *= split;
        avgCostCents[s] /= split;
      }
    }

    // Mark using bar i's close — fully known/historical at this point.
    let markedEquityCents = cashCents;
    for (const s of symbols) markedEquityCents += qty[s] * toCents(bars[s][i].close);
    equityCurve.push({ date: bars[symbols[0]][i].date, equity_cents: Math.round(markedEquityCents) });

    // Cash flows: per-share dividends declared at bar i.
    for (const s of symbols) {
      const div = bars[s][i].dividend;
      if (div && qty[s] !== 0) cashCents += Math.round(toCents(div) * qty[s]);
    }

    if (i + 1 >= N) continue; // no next bar to fill an order into

    let ctxEquityCents = cashCents;
    for (const s of symbols) ctxEquityCents += qty[s] * toCents(bars[s][i].close);

    const positions = {};
    const currentWeights = {};
    for (const s of symbols) {
      const priceCents = toCents(bars[s][i].close);
      positions[s] = { qty: qty[s], avgCostCents: avgCostCents[s], priceCents };
      currentWeights[s] = ctxEquityCents > 0 ? (qty[s] * priceCents) / ctxEquityCents : 0;
    }

    const ctx = { currentIndex: i + 1, currentDate: bars[symbols[0]][i + 1].date, cashCents, equityCents: ctxEquityCents, positions };
    const view = { ...createUniverseView(bars, symbols, i + 1), currentDate: ctx.currentDate };

    const result = strategy.onBar(view, ctx);
    const requested = result && result.weights ? result.weights : {};
    const clamped = clampWeights({ ...currentWeights, ...requested }, { maxWeightPerAsset });

    const orders = [];
    for (const s of symbols) {
      const priceCents = toCents(bars[s][i].close);
      if (priceCents <= 0) continue;
      const desiredQty = Math.floor((clamped[s] * ctxEquityCents) / priceCents);
      const deltaQty = desiredQty - qty[s];
      if (deltaQty !== 0) orders.push({ symbol: s, qty: deltaQty });
    }
    // Sells first (they always fit — long-only sizing never sells more than
    // held) so their proceeds are available to fund the same bar's buys;
    // deterministic tie-break by symbol name.
    orders.sort((a, b) => {
      const aSell = a.qty < 0, bSell = b.qty < 0;
      if (aSell !== bSell) return aSell ? -1 : 1;
      return a.symbol.localeCompare(b.symbol);
    });

    for (const order of orders) {
      const side = order.qty > 0 ? 'buy' : 'sell';
      let qtyAbs = Math.abs(order.qty);
      const openCents = toCents(bars[order.symbol][i + 1].open);
      const slipPerShare = Math.round(openCents * (slippageBps / 10000));
      const fillPriceCents = side === 'buy' ? openCents + slipPerShare : Math.max(0, openCents - slipPerShare);
      if (fillPriceCents <= 0) continue;

      if (side === 'buy') {
        const affordableQty = Math.max(0, Math.floor((cashCents - commissionCents) / fillPriceCents));
        qtyAbs = Math.min(qtyAbs, affordableQty);
        if (qtyAbs <= 0) continue;
      }

      const grossCents = fillPriceCents * qtyAbs;
      const slippageCents = slipPerShare * qtyAbs;
      const trade = {
        id: nextId++, symbol: order.symbol, side, qty: qtyAbs,
        date: bars[order.symbol][i + 1].date, priceCents: fillPriceCents,
        grossCents, commissionCents, slippageCents, decisionIndex: i,
      };

      if (side === 'buy') {
        const costCents = grossCents + commissionCents;
        cashCents -= costCents;
        const priorQty = qty[order.symbol];
        const priorCostCents = avgCostCents[order.symbol] * priorQty;
        qty[order.symbol] = priorQty + qtyAbs;
        avgCostCents[order.symbol] = (priorCostCents + grossCents) / qty[order.symbol];
        trade.cashDeltaCents = -costCents;
      } else {
        const proceedsCents = grossCents - commissionCents;
        cashCents += proceedsCents;
        qty[order.symbol] -= qtyAbs;
        // Realized P&L against the split-adjusted avgCostCents held at this
        // moment — BEFORE it gets reset to 0 below. This is what metrics.js
        // trusts directly instead of replaying (split-blind) average-cost
        // accounting from the fill ledger alone.
        trade.pnl_cents = Math.round(proceedsCents - avgCostCents[order.symbol] * qtyAbs);
        if (qty[order.symbol] === 0) avgCostCents[order.symbol] = 0;
        trade.cashDeltaCents = proceedsCents;
      }
      trades.push(trade);
    }
  }

  const finalPositions = {};
  for (const s of symbols) finalPositions[s] = { qty: qty[s], avgCostCents: avgCostCents[s] };

  const result = { equityCurve, trades, finalCashCents: Math.round(cashCents), finalPositions };
  return { ...result, resultHash: hashResult(result) };
}

module.exports = { runBacktest, clampWeights, DEFAULT_SLIPPAGE_BPS, DEFAULT_COMMISSION_CENTS };
