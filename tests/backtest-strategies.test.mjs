import { describe, it, expect } from 'vitest';
import { buyAndHold, dca, fixedWeightRebalance, smaCross, emaCross } from '../server/backtest/strategies.js';
import { runBacktest } from '../server/backtest/engine.js';
import { createUniverseView } from '../server/backtest/view.js';

function ymd(y, m, d) {
  const dt = new Date(y, m - 1, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function dateSeq(n, y = 2020, m = 1, d = 1) {
  const dt = new Date(y, m - 1, d);
  const out = [];
  for (let i = 0; i < n; i++) { out.push(ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())); dt.setDate(dt.getDate() + 1); }
  return out;
}
function barsFromCloses(closes, dates) {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    return { date: dates[i], open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1000 };
  });
}
function view(closes, currentIndex, symbol = 'X') {
  return createUniverseView({ [symbol]: closes.map((close) => ({ close })) }, [symbol], currentIndex);
}

describe('buyAndHold', () => {
  it('requests full weight when it holds nothing yet', () => {
    const r = buyAndHold('X').onBar(view([], 0), { positions: { X: undefined } });
    expect(r).toEqual({ weights: { X: 1 } });
  });

  it('returns null once a position is already held (no drift correction)', () => {
    const r = buyAndHold('X').onBar(view([], 0), { positions: { X: { qty: 10 } } });
    expect(r).toBeNull();
  });

  it('end to end: invests ~100% by the second bar and never trades again', () => {
    const dates = dateSeq(6);
    const bars = { X: barsFromCloses([100, 101, 103, 99, 108, 110], dates) };
    const { trades, finalPositions } = runBacktest({ bars, strategy: buyAndHold('X'), initialCashCents: 100_000 });
    expect(trades.length).toBe(1);
    expect(trades[0].side).toBe('buy');
    expect(finalPositions.X.qty).toBeGreaterThan(0);
  });
});

describe('dca', () => {
  const strat = () => dca({ symbol: 'X', amountCents: 10_000, everyNBars: 3 });

  it('triggers only on multiples of everyNBars', () => {
    const ctx = { equityCents: 100_000, positions: { X: undefined } };
    expect(strat().onBar(view([], 0), ctx)).not.toBeNull();
    expect(strat().onBar(view([], 1), ctx)).toBeNull();
    expect(strat().onBar(view([], 2), ctx)).toBeNull();
    expect(strat().onBar(view([], 3), ctx)).not.toBeNull();
  });

  it('adds amountCents/equityCents to whatever weight it already holds', () => {
    const ctx = { equityCents: 100_000, positions: { X: { qty: 50, priceCents: 200 } } }; // current weight = 10000/100000 = 0.1
    const r = strat().onBar(view([], 0), ctx);
    expect(r.weights.X).toBeCloseTo(0.1 + 10_000 / 100_000, 9);
  });

  it('end to end: builds the position in tranches, one buy per trigger bar', () => {
    const dates = dateSeq(10);
    const bars = { X: barsFromCloses([100, 100, 100, 100, 100, 100, 100, 100, 100, 100], dates) };
    const { trades } = runBacktest({
      bars, strategy: dca({ symbol: 'X', amountCents: 10_000, everyNBars: 3 }), initialCashCents: 200_000,
    });
    // triggers at currentIndex 0,3,6,9 -> fills at bars 1,4,7 (index 9 has no next bar)
    expect(trades.length).toBe(3);
    expect(trades.every((t) => t.side === 'buy')).toBe(true);
  });
});

describe('fixedWeightRebalance', () => {
  it('emits the configured weights only on rebalance bars', () => {
    const strat = fixedWeightRebalance({ weights: { A: 0.6, B: 0.4 }, everyNBars: 2 });
    expect(strat.onBar(view([], 0))).toEqual({ weights: { A: 0.6, B: 0.4 } });
    expect(strat.onBar(view([], 1))).toBeNull();
    expect(strat.onBar(view([], 2))).toEqual({ weights: { A: 0.6, B: 0.4 } });
  });

  it('end to end: keeps two symbols close to their target split after rebalancing', () => {
    const dates = dateSeq(6);
    const bars = {
      A: barsFromCloses([50, 55, 60, 58, 62, 61], dates),
      B: barsFromCloses([20, 19, 22, 21, 18, 19], dates),
    };
    const { equityCurve, finalPositions } = runBacktest({
      bars, strategy: fixedWeightRebalance({ weights: { A: 0.5, B: 0.5 }, everyNBars: 1 }), initialCashCents: 100_000,
    });
    const lastEquity = equityCurve[equityCurve.length - 1].equity_cents;
    const aValue = finalPositions.A.qty * Math.round(61 * 100);
    const bValue = finalPositions.B.qty * Math.round(19 * 100);
    expect(aValue / lastEquity).toBeCloseTo(0.5, 1);
    expect(bValue / lastEquity).toBeCloseTo(0.5, 1);
  });
});

describe('smaCross', () => {
  const closes = [10, 20, 10, 5, 30, 40];

  it('returns null before enough history for the slow SMA', () => {
    const s = smaCross({ symbol: 'X', fastPeriod: 2, slowPeriod: 3 });
    expect(s.onBar(view(closes, 2))).toBeNull();
  });

  it('goes flat when the fast SMA is below the slow SMA', () => {
    // visible closes [10,20,10,5]: sma2=7.5, sma3=11.67 -> fast < slow
    const s = smaCross({ symbol: 'X', fastPeriod: 2, slowPeriod: 3 });
    expect(s.onBar(view(closes, 4))).toEqual({ weights: { X: 0 } });
  });

  it('goes long when the fast SMA is above the slow SMA', () => {
    // visible closes [10,20,10,5,30]: sma2=17.5, sma3=15 -> fast > slow
    const s = smaCross({ symbol: 'X', fastPeriod: 2, slowPeriod: 3 });
    expect(s.onBar(view(closes, 5))).toEqual({ weights: { X: 1 } });
  });

  it('never reads its own decision bar (uses only bars visible on the view)', () => {
    const s = smaCross({ symbol: 'X', fastPeriod: 2, slowPeriod: 3 });
    expect(() => s.onBar(view(closes, 5))).not.toThrow();
  });
});

describe('emaCross', () => {
  it('returns null before enough history, then long on a strong uptrend', () => {
    const closes = [10, 10, 10, 10, 20, 40, 60, 80];
    const s = emaCross({ symbol: 'X', fastPeriod: 2, slowPeriod: 4 });
    expect(s.onBar(view(closes, 3))).toBeNull();
    const r = s.onBar(view(closes, 8));
    expect(r).toEqual({ weights: { X: 1 } });
  });

  it('end to end: crosses from flat to long and trades exactly once at the flip', () => {
    const dates = dateSeq(9);
    const closes = [10, 10, 10, 10, 20, 40, 60, 80, 100];
    const bars = { X: barsFromCloses(closes, dates) };
    const { trades } = runBacktest({
      bars, strategy: emaCross({ symbol: 'X', fastPeriod: 2, slowPeriod: 4 }), initialCashCents: 100_000,
    });
    expect(trades.length).toBe(1);
    expect(trades[0].side).toBe('buy');
  });
});
