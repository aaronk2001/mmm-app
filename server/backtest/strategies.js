'use strict';

// Strategy factories for the backtest engine. Every strategy is a pure
// function of (view, ctx) -> target weights; none hold mutable state across
// bars, so re-running the same config through engine.js is byte-identical by
// construction. `personaBlend` is cut — it depended on the Desk, which does
// not exist in this build.

function sma(closes, period) {
  if (closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i];
  return sum / period;
}

function ema(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let prev = sma(closes.slice(0, period), period);
  for (let i = period; i < closes.length; i++) prev = closes[i] * k + prev * (1 - k);
  return prev;
}

function closesOf(view, symbol) {
  const arr = view.bars[symbol];
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i].close;
  return out;
}

/**
 * Puts 100% of equity into `symbol` the first time it holds none, then never
 * rebalances again (true buy-and-hold — no drift correction).
 * @param {string} symbol
 * @returns {{name: string, onBar: function(object, object): (object|null)}}
 */
function buyAndHold(symbol) {
  return {
    name: 'buyAndHold',
    onBar(view, ctx) {
      const pos = ctx.positions[symbol];
      if (pos && pos.qty > 0) return null;
      return { weights: { [symbol]: 1 } };
    },
  };
}

/**
 * Every `everyNBars` bars, buys `amountCents` more of `symbol` (added to
 * whatever weight it already holds).
 * @param {{symbol: string, amountCents: number, everyNBars: number}} params
 * @returns {{name: string, onBar: function(object, object): (object|null)}}
 */
function dca({ symbol, amountCents, everyNBars }) {
  return {
    name: 'dca',
    onBar(view, ctx) {
      if (!everyNBars || everyNBars <= 0 || view.currentIndex % everyNBars !== 0) return null;
      if (ctx.equityCents <= 0) return null;
      const pos = ctx.positions[symbol];
      const currentWeight = pos ? (pos.qty * pos.priceCents) / ctx.equityCents : 0;
      const deltaWeight = amountCents / ctx.equityCents;
      return { weights: { [symbol]: currentWeight + deltaWeight } };
    },
  };
}

/**
 * Rebalances to a fixed target-weight vector every `everyNBars` bars; drifts
 * with the market in between.
 * @param {{weights: Object<string, number>, everyNBars: number}} params
 * @returns {{name: string, onBar: function(object, object): (object|null)}}
 */
function fixedWeightRebalance({ weights, everyNBars }) {
  return {
    name: 'fixedWeightRebalance',
    onBar(view) {
      if (!everyNBars || everyNBars <= 0 || view.currentIndex % everyNBars !== 0) return null;
      return { weights: { ...weights } };
    },
  };
}

/**
 * Long while the fast SMA is above the slow SMA, flat otherwise. Uses only
 * bars visible on the view (i.e. never its own decision bar's close).
 * @param {{symbol: string, fastPeriod: number, slowPeriod: number}} params
 * @returns {{name: string, onBar: function(object, object): (object|null)}}
 */
function smaCross({ symbol, fastPeriod, slowPeriod }) {
  return {
    name: 'smaCross',
    onBar(view) {
      const closes = closesOf(view, symbol);
      const fast = sma(closes, fastPeriod);
      const slow = sma(closes, slowPeriod);
      if (fast == null || slow == null) return null;
      return { weights: { [symbol]: fast > slow ? 1 : 0 } };
    },
  };
}

/**
 * Same as smaCross but with exponential moving averages.
 * @param {{symbol: string, fastPeriod: number, slowPeriod: number}} params
 * @returns {{name: string, onBar: function(object, object): (object|null)}}
 */
function emaCross({ symbol, fastPeriod, slowPeriod }) {
  return {
    name: 'emaCross',
    onBar(view) {
      const closes = closesOf(view, symbol);
      const fast = ema(closes, fastPeriod);
      const slow = ema(closes, slowPeriod);
      if (fast == null || slow == null) return null;
      return { weights: { [symbol]: fast > slow ? 1 : 0 } };
    },
  };
}

module.exports = { buyAndHold, dca, fixedWeightRebalance, smaCross, emaCross, sma, ema };
