// House test style per tests/strategy-gate.test.mjs: small pure fixtures,
// both sides of thresholds, hand-computed expected values. NEXUS's
// test_backtest.py informed the shape of a few of these cases (per the
// sprint brief) but was never opened; nothing here references it directly.
import { describe, it, expect } from 'vitest';
import { runBacktest, clampWeights } from '../server/backtest/engine.js';
import { createBarView, createUniverseView, LookAheadError } from '../server/backtest/view.js';

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
// open defaults to the previous bar's close (no gap) unless overridden.
function barsFromCloses(closes, dates, overrides = {}) {
  return closes.map((close, i) => {
    const open = overrides.opens ? overrides.opens[i] : (i === 0 ? close : closes[i - 1]);
    const bar = { date: dates[i], open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1000 };
    if (overrides.splits && overrides.splits[i] && overrides.splits[i] !== 1) bar.split = overrides.splits[i];
    if (overrides.dividends && overrides.dividends[i]) bar.dividend = overrides.dividends[i];
    return bar;
  });
}
const buyAndHold = (symbol) => ({
  onBar(view, ctx) {
    const pos = ctx.positions[symbol];
    if (pos && pos.qty > 0) return null;
    return { weights: { [symbol]: 1 } };
  },
});

describe('view.js — look-ahead guard', () => {
  it('exposes bars strictly before currentIndex', () => {
    const bars = [{ close: 1 }, { close: 2 }, { close: 3 }];
    const v = createBarView(bars, 2);
    expect(v.length).toBe(2);
    expect(v.bars[0].close).toBe(1);
    expect(v.bars[1].close).toBe(2);
  });

  it('throws (never undefined/NaN) reaching for its own current-index bar', () => {
    const bars = [{ close: 1 }, { close: 2 }, { close: 3 }];
    const v = createBarView(bars, 2);
    expect(() => v.bars[2].close).toThrow(LookAheadError);
    expect(() => v.bar(2)).toThrow(LookAheadError);
  });

  it('throws reaching for any future bar, not just the current one', () => {
    const bars = [{ close: 1 }, { close: 2 }, { close: 3 }, { close: 4 }];
    const v = createBarView(bars, 1);
    expect(() => v.bars[3].close).toThrow(LookAheadError);
  });

  it('array methods reached through the view stay bounded (no leak via slice/iteration)', () => {
    const bars = [{ close: 1 }, { close: 2 }, { close: 3 }];
    const v = createBarView(bars, 2);
    expect(v.bars.slice(0).map((b) => b.close)).toEqual([1, 2]);
    expect([...v.bars].map((b) => b.close)).toEqual([1, 2]);
    expect(v.bars.length).toBe(2);
  });

  it('is read-only', () => {
    const v = createBarView([{ close: 1 }], 1);
    expect(() => { v.bars[0] = { close: 99 }; }).toThrow();
  });

  it('createUniverseView guards every symbol independently at the same index', () => {
    const bars = { A: [{ close: 1 }, { close: 2 }], B: [{ close: 10 }, { close: 20 }] };
    const v = createUniverseView(bars, ['A', 'B'], 1);
    expect(v.bars.A[0].close).toBe(1);
    expect(v.bars.B[0].close).toBe(10);
    expect(() => v.bars.A[1].close).toThrow(LookAheadError);
    expect(() => v.bars.B[1].close).toThrow(LookAheadError);
  });

  it('engine integration: a strategy touching its own decision bar throws out of runBacktest', () => {
    const dates = dateSeq(5);
    const bars = { X: barsFromCloses([10, 11, 12, 13, 14], dates) };
    const peeking = { onBar: (view) => { void view.bars.X[view.currentIndex].close; return null; } };
    // Asserted by message/name rather than instanceof: vitest's CJS/ESM
    // interop can load view.js as two distinct module instances (one via
    // engine.js's require, one via this file's import), so a cross-module
    // instanceof check is not reliable even though it is the same class.
    expect(() => runBacktest({ bars, strategy: peeking, initialCashCents: 100000 })).toThrow(/look-ahead violation/);
  });

  // Hostile tests — the proxy traps `get`/`has`/`set` but a descriptor read
  // reaches straight past those into the raw target unless `getOwnPropertyDescriptor`
  // and `ownKeys` are trapped too. These four routes were the actual hole
  // (verified against the pre-fix code: gOPD/gOPDs leaked bar[5], Object.keys
  // reported all 6 real indices instead of the visible 3).
  it('blocks a future bar reached via Object.getOwnPropertyDescriptor', () => {
    const bars = [{ close: 100 }, { close: 200 }, { close: 300 }, { close: 400 }, { close: 500 }, { close: 350 }];
    const v = createBarView(bars, 3);
    expect(() => Object.getOwnPropertyDescriptor(v.bars, '5')).toThrow(LookAheadError);
  });

  it('never dumps a future bar via Object.getOwnPropertyDescriptors or Object.keys', () => {
    const bars = [{ close: 100 }, { close: 200 }, { close: 300 }, { close: 400 }, { close: 500 }, { close: 350 }];
    const v = createBarView(bars, 3);
    const all = Object.getOwnPropertyDescriptors(v.bars);
    expect(Object.prototype.hasOwnProperty.call(all, '5')).toBe(false);
    expect(all['2'].value.close).toBe(300);
    // Object.keys must report only the visible window, not the real run length.
    expect(Object.keys(v.bars)).toEqual(['0', '1', '2']);
  });

  it('rejects delete on the bar view', () => {
    const v = createBarView([{ close: 1 }, { close: 2 }], 2);
    expect(() => { delete v.bars[0]; }).toThrow(/read-only/);
  });

  it('rejects defineProperty on the bar view', () => {
    const v = createBarView([{ close: 1 }, { close: 2 }], 2);
    expect(() => Object.defineProperty(v.bars, '0', { value: { close: 999 } })).toThrow(/read-only/);
  });

  it('regression: visible-window operations still behave normally after the descriptor-trap fix', () => {
    const bars = [{ close: 1 }, { close: 2 }, { close: 3 }, { close: 4 }, { close: 5 }, { close: 6 }];
    const v = createBarView(bars, 3);
    const B = v.bars;
    expect(B[2].close).toBe(3);
    expect(B.length).toBe(3);
    expect(B.slice().map((b) => b.close)).toEqual([1, 2, 3]);
    expect([...B].map((b) => b.close)).toEqual([1, 2, 3]);
    expect(B.map((b) => b.close)).toEqual([1, 2, 3]);
    expect(B.at(-1).close).toBe(3);
    expect(B.reduce((s, b) => s + b.close, 0)).toBe(6);
    expect(JSON.parse(JSON.stringify(B))).toEqual([{ close: 1 }, { close: 2 }, { close: 3 }]);
    expect({ ...B }).toEqual({ 0: { close: 1 }, 1: { close: 2 }, 2: { close: 3 } });
  });
});

describe('clampWeights — risk clamp', () => {
  it('caps a single asset at maxWeightPerAsset', () => {
    expect(clampWeights({ A: 1.5 }, { maxWeightPerAsset: 0.6 })).toEqual({ A: 0.6 });
  });

  it('floors negative weights at 0', () => {
    expect(clampWeights({ A: -0.2 })).toEqual({ A: 0 });
  });

  it('scales down proportionally when gross exposure exceeds 100%', () => {
    const out = clampWeights({ A: 0.8, B: 0.8 });
    expect(out.A).toBeCloseTo(0.5, 9);
    expect(out.B).toBeCloseTo(0.5, 9);
  });

  it('leaves an already-valid vector untouched', () => {
    expect(clampWeights({ A: 0.4, B: 0.3 })).toEqual({ A: 0.4, B: 0.3 });
  });

  it('is idempotent: clamp(clamp(w)) === clamp(w)', () => {
    const cases = [{ A: 1.5 }, { A: 0.8, B: 0.9 }, { A: -1, B: 2 }, { A: 0.3, B: 0.3, C: 0.3, D: 0.3 }];
    for (const w of cases) {
      const once = clampWeights(w, { maxWeightPerAsset: 0.7 });
      const twice = clampWeights(once, { maxWeightPerAsset: 0.7 });
      expect(twice).toEqual(once);
    }
  });
});

describe('runBacktest — golden math', () => {
  it('a series compounding 10%/yr yields ~10% CAGR', () => {
    const years = 6;
    const closes = [100];
    for (let i = 1; i <= years; i++) closes.push(closes[i - 1] * 1.10);
    const dates = dateSeq(closes.length);
    const bars = { X: barsFromCloses(closes, dates) };
    const { equityCurve } = runBacktest({
      bars, strategy: buyAndHold('X'), initialCashCents: 1_000_000, slippageBps: 0, commissionCents: 0,
    });
    // Bar 0: not yet invested (decision fills at bar 1's open). From bar 1
    // onward equity tracks price 1:1 (fully invested, no further trades).
    const first = equityCurve[1].equity_cents;
    const last = equityCurve[equityCurve.length - 1].equity_cents;
    const periods = equityCurve.length - 2; // bar1 -> bar(N-1)
    const cagr = Math.pow(last / first, 1 / periods) - 1;
    expect(cagr).toBeCloseTo(0.10, 3);
  });

  it('a -50% then +100% series reports 50% max drawdown and 0% total return', () => {
    const dates = dateSeq(3);
    const closes = [100, 50, 100];
    const opens = [100, 100, 50]; // bar1 opens flat off bar0's close -> exact -50% fill
    const bars = { X: barsFromCloses(closes, dates, { opens }) };
    const { equityCurve } = runBacktest({
      bars, strategy: buyAndHold('X'), initialCashCents: 1_000_000, slippageBps: 0, commissionCents: 0,
    });
    const values = equityCurve.map((p) => p.equity_cents);
    expect(values).toEqual([1_000_000, 500_000, 1_000_000]);
    let peak = -Infinity; let maxDrawdown = 0;
    for (const v of values) { peak = Math.max(peak, v); maxDrawdown = Math.min(maxDrawdown, (v - peak) / peak); }
    const totalReturn = (values[values.length - 1] - values[0]) / values[0];
    expect(maxDrawdown).toBeCloseTo(-0.5, 9);
    expect(totalReturn).toBeCloseTo(0, 9);
  });
});

describe('runBacktest — ledger invariants', () => {
  it('cash + marked positions equals the reported equity at every bar', () => {
    const dates = dateSeq(9);
    const closesA = [50, 51, 52, 53, 54, 55, 56, 57, 58];
    const closesB = [20, 22, 19, 21, 23, 18, 25, 24, 26];
    const bars = { A: barsFromCloses(closesA, dates), B: barsFromCloses(closesB, dates) };
    const strategy = { onBar: () => ({ weights: { A: 0.5, B: 0.5 } }) }; // rebalance every bar
    const { equityCurve, trades } = runBacktest({ bars, strategy, initialCashCents: 200_000 });

    let cash = 200_000;
    const qty = { A: 0, B: 0 };
    let ti = 0;
    for (let i = 0; i < dates.length; i++) {
      while (ti < trades.length && trades[ti].date === dates[i]) {
        const t = trades[ti];
        cash += t.cashDeltaCents;
        qty[t.symbol] += t.side === 'buy' ? t.qty : -t.qty;
        ti++;
      }
      const reconstructed = cash + qty.A * Math.round(closesA[i] * 100) + qty.B * Math.round(closesB[i] * 100);
      expect(reconstructed).toBe(equityCurve[i].equity_cents);
    }
    expect(ti).toBe(trades.length); // every trade was traceable to a bar date
  });

  it('every fill traces to an order that differed from the current position', () => {
    const dates = dateSeq(4);
    const bars = { X: barsFromCloses([10, 10, 10, 10], dates) };
    const strategy = { onBar: () => ({ weights: { X: 1 } }) }; // same target every bar
    const { trades } = runBacktest({ bars, strategy, initialCashCents: 100_000 });
    expect(trades.length).toBe(1); // only the initial buy; flat price + flat target => no rebalancing after
  });
});

describe('runBacktest — costs bite', () => {
  it('a zero-alpha strategy that churns on costs finishes below buy-and-hold', () => {
    const dates = dateSeq(10);
    const closes = [100, 101, 99, 102, 98, 103, 97, 104, 96, 105];
    const bars = { X: barsFromCloses(closes, dates) };
    const config = { initialCashCents: 1_000_000, slippageBps: 10, commissionCents: 100 };

    const holdResult = runBacktest({ ...config, bars, strategy: buyAndHold('X') });
    // Toggles 100% <-> 90% invested every bar — pure noise with zero
    // informational edge (the toggle is uncorrelated with the price path),
    // but it forces a real round-trip trade each bar, so only cost drag
    // should separate it from buy-and-hold.
    const churner = { onBar: (view) => ({ weights: { X: view.currentIndex % 2 === 0 ? 1 : 0.9 } }) };
    const churnResult = runBacktest({ ...config, bars, strategy: churner });

    const holdFinal = holdResult.equityCurve[holdResult.equityCurve.length - 1].equity_cents;
    const churnFinal = churnResult.equityCurve[churnResult.equityCurve.length - 1].equity_cents;
    expect(churnResult.trades.length).toBeGreaterThan(holdResult.trades.length);
    expect(churnFinal).toBeLessThan(holdFinal);
  });
});

describe('runBacktest — split invariance', () => {
  it('a 2:1 split with a flat underlying price leaves equity unchanged', () => {
    const dates = dateSeq(5);
    // Raw economic price is flat (110) across the split point; the nominal
    // close halves only because of the split itself.
    const closes = [100, 105, 110, 55, 55];
    const splits = [1, 1, 1, 2, 1];
    const bars = { X: barsFromCloses(closes, dates, { splits }) };
    const { equityCurve } = runBacktest({
      bars, strategy: buyAndHold('X'), initialCashCents: 1_000_000, slippageBps: 0, commissionCents: 0,
    });
    expect(equityCurve[3].equity_cents).toBe(equityCurve[2].equity_cents);
  });
});

describe('runBacktest — determinism', () => {
  it('the same config run twice produces the same result hash', () => {
    const dates = dateSeq(12);
    const closes = [100, 102, 101, 105, 103, 108, 107, 111, 109, 115, 113, 118];
    const buildConfig = () => ({
      bars: { X: barsFromCloses(closes, dates) },
      strategy: { onBar: (view, ctx) => (view.currentIndex % 3 === 0 ? { weights: { X: (ctx.currentIndex % 6) / 6 } } : null) },
      initialCashCents: 500_000,
    });
    const a = runBacktest(buildConfig());
    const b = runBacktest(buildConfig());
    expect(a.resultHash).toBe(b.resultHash);
    expect(a.resultHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('runBacktest — config validation', () => {
  it('rejects mismatched dates across symbols', () => {
    const bars = {
      A: barsFromCloses([1, 2], dateSeq(2)),
      B: barsFromCloses([1, 2], dateSeq(2, 2021)),
    };
    expect(() => runBacktest({ bars, strategy: buyAndHold('A'), initialCashCents: 1000 })).toThrow(/date mismatch/);
  });

  it('rejects a non-integer initialCashCents', () => {
    const bars = { A: barsFromCloses([1, 2], dateSeq(2)) };
    expect(() => runBacktest({ bars, strategy: buyAndHold('A'), initialCashCents: 10.5 })).toThrow();
  });
});

// ── #5: null means hold — no phantom fills from float round-trips ───────────
// Re-deriving a held quantity from its own weight, floor((q*p/E) * E / p),
// lands one share short for many (q, p, E) — e.g. q=5, p=11926¢,
// E=10000035¢ -> 4 — which fired a 1-share sell (commission + slippage, and a
// "closed trade" in win rate) on bars where the strategy asked for nothing.
describe('runBacktest — null / omitted weights hold positions exactly', () => {
  function lcg(seed) {
    let s = seed;
    return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  }
  function randomWalk(n, p0, rnd) {
    const dates = dateSeq(n);
    const out = [];
    let p = p0;
    for (let i = 0; i < n; i++) {
      const open = p;
      p = Math.max(0.5, p * (1 + (rnd() - 0.5) * 0.04));
      const o = Math.round(open * 100) / 100;
      const c = Math.round(p * 100) / 100;
      out.push({ date: dates[i], open: o, high: Math.max(o, c), low: Math.min(o, c), close: c, volume: 1000 });
    }
    return out;
  }
  const rebalanceEvery = (weights, n) => ({ onBar: (view) => (view.currentIndex % n === 0 ? { weights: { ...weights } } : null) });

  it('a periodic rebalancer only ever trades on its rebalance bars (seeded, 40 runs)', () => {
    const rnd = lcg(7);
    let fills = 0;
    for (let k = 0; k < 40; k++) {
      const bars = { A: randomWalk(252, 20 + rnd() * 100, rnd), B: randomWalk(252, 50 + rnd() * 200, rnd) };
      const { trades } = runBacktest({ bars, strategy: rebalanceEvery({ A: 0.5, B: 0.5 }, 21), initialCashCents: 10_000_000 });
      for (const t of trades) expect((t.decisionIndex + 1) % 21).toBe(0);
      fills += trades.length;
    }
    expect(fills).toBeGreaterThan(0);
  });

  it('buy-and-hold makes exactly one fill (seeded, 150 runs)', () => {
    // Seed 7 includes a run where the old engine fired a phantom 1-share sell.
    const rnd = lcg(7);
    for (let k = 0; k < 150; k++) {
      const bars = { X: randomWalk(250, 5 + rnd() * 400, rnd) };
      const { trades } = runBacktest({ bars, strategy: buyAndHold('X'), initialCashCents: Math.round(1e6 + rnd() * 1e7) });
      expect(trades).toHaveLength(1);
    }
  });

  it('a symbol the strategy leaves out of its weights keeps its exact share count', () => {
    const rnd = lcg(23);
    const bars = { A: randomWalk(120, 40, rnd), B: randomWalk(120, 119.26, rnd) };
    // Names both once, then only ever A: B must never trade again.
    const strategy = { onBar: (view) => (view.currentIndex === 1 ? { weights: { A: 0.3, B: 0.3 } } : { weights: { A: 0.3 } }) };
    const { trades } = runBacktest({ bars, strategy, initialCashCents: 10_000_035 });
    const bFills = trades.filter((t) => t.symbol === 'B');
    expect(bFills).toHaveLength(1);
    expect(bFills[0].side).toBe('buy');
  });

  it('the risk clamp still trims an unnamed symbol when a request pushes gross exposure over 100%', () => {
    const dates = dateSeq(6);
    const bars = { A: barsFromCloses([10, 10, 10, 10, 10, 10], dates), B: barsFromCloses([10, 10, 10, 10, 10, 10], dates) };
    const strategy = { onBar: (view) => (view.currentIndex === 1 ? { weights: { B: 0.5 } } : view.currentIndex === 3 ? { weights: { A: 1 } } : null) };
    const { trades } = runBacktest({ bars, strategy, initialCashCents: 100_000, slippageBps: 0, commissionCents: 0 });
    // A:1 + B's held 0.5 = 1.5 gross -> rescaled to A 2/3, B 1/3: B is sold down.
    expect(trades.some((t) => t.symbol === 'B' && t.side === 'sell')).toBe(true);
  });
});

// ── #6: fee-inclusive cost basis ───────────────────────────────────────────
describe('runBacktest — realized P&L includes the buy commission', () => {
  it('a round trip that loses 50¢ net reports pnl_cents -50 (it used to report +50, a "win")', () => {
    const px = [100, 100, 100, 100.01, 100.01, 100.01];
    const dates = dateSeq(px.length);
    const bars = { A: px.map((p, i) => ({ date: dates[i], open: p, high: p, low: p, close: p })) };
    const strategy = { onBar: (view) => (view.currentIndex === 1 ? { weights: { A: 1 } } : view.currentIndex === 4 ? { weights: { A: 0 } } : null) };
    const initialCashCents = 1_500_100;
    const r = runBacktest({ bars, strategy, initialCashCents, slippageBps: 0, commissionCents: 100 });
    const sell = r.trades.find((t) => t.side === 'sell');
    expect(r.trades.map((t) => [t.side, t.qty, t.priceCents])).toEqual([['buy', 150, 10000], ['sell', 150, 10001]]);
    expect(sell.pnl_cents).toBe(-50);
    // Flat to flat: realized P&L is exactly the cash the round trip made.
    expect(r.finalCashCents - initialCashCents).toBe(sell.pnl_cents);
  });
});
