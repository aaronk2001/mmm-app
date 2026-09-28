import { describe, it, expect } from 'vitest';
import {
  cagr, maxDrawdown, volatility, sharpeRatio, sortinoRatio, calmarRatio,
  winRate, profitFactor, turnover, totalCosts,
  beta, alpha, trackingError,
  timeWeightedReturn, xirr, buildXirrCashflows,
  inSampleHoldoutGap, metrics,
} from '../server/backtest/metrics.js';
import { runBacktest } from '../server/backtest/engine.js';
import { buyAndHold } from '../server/backtest/strategies.js';

// ── CAGR ──────────────────────────────────────────────────────────────────
describe('cagr', () => {
  it('reports 10%/yr for a 3-year 1.1^3 compounding curve', () => {
    // 1,000,000 -> 1,331,000 cents over 2021-01-01..2024-01-01.
    // Jan1'21->Jan1'24 spans 2021/2022/2023, none leap-affected in that
    // range: 365*3 = 1095 days exactly -> years = 1095/365 = 3.
    // (1,331,000/1,000,000)^(1/3) - 1 = 1.331^(1/3) - 1 = 1.1 - 1 = 0.10.
    const curve = [
      { date: '2021-01-01', equity_cents: 1000000 },
      { date: '2024-01-01', equity_cents: 1331000 },
    ];
    expect(cagr(curve)).toBeCloseTo(0.10, 9);
  });

  it('returns null with fewer than 2 points', () => {
    expect(cagr([{ date: '2021-01-01', equity_cents: 1000 }])).toBeNull();
    expect(cagr([])).toBeNull();
  });

  it('returns null when starting equity is not positive', () => {
    const curve = [{ date: '2021-01-01', equity_cents: 0 }, { date: '2022-01-01', equity_cents: 1000 }];
    expect(cagr(curve)).toBeNull();
  });

  it('returns null when start and end date are the same (0 elapsed days)', () => {
    const curve = [{ date: '2021-01-01', equity_cents: 1000 }, { date: '2021-01-01', equity_cents: 2000 }];
    expect(cagr(curve)).toBeNull();
  });
});

// ── Max drawdown ─────────────────────────────────────────────────────────
describe('maxDrawdown', () => {
  it('finds the 50% peak-to-trough decline and its dates', () => {
    // peak sequence: 100k,150k,150k,150k. dd: 0,0,-50%,-40%. Worst is -50%
    // from the day-02 peak to the day-03 trough.
    const curve = [
      { date: '2024-01-01', equity_cents: 100000 },
      { date: '2024-01-02', equity_cents: 150000 },
      { date: '2024-01-03', equity_cents: 75000 },
      { date: '2024-01-04', equity_cents: 90000 },
    ];
    const dd = maxDrawdown(curve);
    expect(dd.pct).toBeCloseTo(-0.5, 9);
    expect(dd.startDate).toBe('2024-01-02');
    expect(dd.endDate).toBe('2024-01-03');
  });

  it('returns an all-null shape with fewer than 2 points', () => {
    expect(maxDrawdown([{ date: '2024-01-01', equity_cents: 100 }])).toEqual({ pct: null, startDate: null, endDate: null });
    expect(maxDrawdown([])).toEqual({ pct: null, startDate: null, endDate: null });
  });

  it('is 0 (no decline) on a monotonically rising curve', () => {
    const curve = [{ date: '2024-01-01', equity_cents: 100 }, { date: '2024-01-02', equity_cents: 200 }];
    expect(maxDrawdown(curve).pct).toBe(0);
  });

  // I1: a total wipeout must report -100%, not -50%. The old code's
  // `if (!(point.equity_cents > 0)) continue;` skipped non-positive points
  // for TROUGH measurement too, so a 100000 -> 50000 -> 0 curve stopped
  // measuring drawdown at the last positive reading (-50%) instead of
  // against the zero balance (-100%). Only the peak needs a positive seed.
  it('reports -100% (not -50%) on a total wipeout, once a peak is established', () => {
    const curve = [
      { date: '2024-01-01', equity_cents: 100000 },
      { date: '2024-01-02', equity_cents: 50000 },
      { date: '2024-01-03', equity_cents: 0 },
    ];
    const dd = maxDrawdown(curve);
    expect(dd.pct).toBe(-1);
    expect(dd.startDate).toBe('2024-01-01');
    expect(dd.endDate).toBe('2024-01-03');
  });
});

// ── Volatility / Sharpe / Sortino / Calmar ──────────────────────────────
describe('volatility and sharpeRatio', () => {
  // Returns [0.02, 0.04, 0.03]: mean 0.03, deviations [-0.01, 0.01, 0],
  // sum of squares 0.0002, sample variance (n-1=2) 0.0001, stdev 0.01.
  // Curve chosen so those returns fall out exactly:
  // 1,000,000 -> 1,020,000 (+2%) -> 1,060,800 (+4%) -> 1,092,624 (+3%).
  const curve = [
    { date: '2024-01-01', equity_cents: 1000000 },
    { date: '2024-01-02', equity_cents: 1020000 },
    { date: '2024-01-03', equity_cents: 1060800 },
    { date: '2024-01-04', equity_cents: 1092624 },
  ];

  it('annualizes stdev by sqrt(252): 0.01 * 15.874507866... = 0.1587450787', () => {
    expect(volatility(curve)).toBeCloseTo(0.01 * Math.sqrt(252), 9);
  });

  it('computes Sharpe = (mean/stdev) * sqrt(252) = 3 * sqrt(252) = 47.623523...', () => {
    expect(sharpeRatio(curve)).toBeCloseTo(3 * Math.sqrt(252), 6);
  });

  it('returns null for both with fewer than 2 returns (1 point)', () => {
    expect(volatility([{ date: '2024-01-01', equity_cents: 100 }])).toBeNull();
    expect(sharpeRatio([{ date: '2024-01-01', equity_cents: 100 }])).toBeNull();
  });

  it('volatility is 0 (a well-defined value) but Sharpe is null on zero-variance returns', () => {
    // Both period returns are exactly +10%, so stdev is genuinely 0 — that's
    // a real, known answer for volatility, not missing data. Sharpe divides
    // by that same stdev, which IS undefined (0/0-shaped), so it must guard.
    const flat = [
      { date: '2024-01-01', equity_cents: 1000000 },
      { date: '2024-01-02', equity_cents: 1100000 },
      { date: '2024-01-03', equity_cents: 1210000 },
    ];
    expect(volatility(flat)).toBe(0);
    expect(sharpeRatio(flat)).toBeNull();
  });
});

describe('sortinoRatio', () => {
  it('matches a hand-derived closed form for returns [0.10, -0.10, 0.10]', () => {
    // mean = 0.10/3 = 1/30. Only the -0.10 period is below target 0, so
    // downside deviation = sqrt((0.10^2)/3) = sqrt(0.01/3) = 1/(10*sqrt(3)).
    // ratio = (1/30) / (1/(10*sqrt3)) = (10*sqrt3)/30 = sqrt(3)/3 = 1/sqrt(3).
    // Annualized: (1/sqrt(3)) * sqrt(252) = sqrt(252/3) = sqrt(84) = 2*sqrt(21).
    const curve = [
      { date: '2024-01-01', equity_cents: 1000000 },
      { date: '2024-01-02', equity_cents: 1100000 },
      { date: '2024-01-03', equity_cents: 990000 },
      { date: '2024-01-04', equity_cents: 1089000 },
    ];
    expect(sortinoRatio(curve)).toBeCloseTo(2 * Math.sqrt(21), 9);
  });

  it('returns null when no period is below target (undefined downside deviation)', () => {
    const curve = [
      { date: '2024-01-01', equity_cents: 1000000 },
      { date: '2024-01-02', equity_cents: 1100000 },
      { date: '2024-01-03', equity_cents: 1210000 },
    ];
    expect(sortinoRatio(curve)).toBeNull();
  });

  it('returns null with fewer than 2 returns', () => {
    expect(sortinoRatio([{ date: '2024-01-01', equity_cents: 100 }])).toBeNull();
  });
});

describe('calmarRatio', () => {
  it('is CAGR / |maxDD| = 0.10 / 0.50 = 0.20', () => {
    // 2021-01-01: 1,000,000 (peak). 2021-07-01: 500,000 (-50% dd, trough).
    // 2023-01-01: 1,210,000 (new peak; recovers past the old one).
    // CAGR over the full span (730 days = 2 exact years since 2021 & 2022
    // are both non-leap): (1,210,000/1,000,000)^(1/2)-1 = sqrt(1.21)-1 = 0.10.
    const curve = [
      { date: '2021-01-01', equity_cents: 1000000 },
      { date: '2021-07-01', equity_cents: 500000 },
      { date: '2023-01-01', equity_cents: 1210000 },
    ];
    expect(calmarRatio(curve)).toBeCloseTo(0.20, 9);
  });

  it('returns null when there is no drawdown to divide by', () => {
    const curve = [{ date: '2021-01-01', equity_cents: 1000000 }, { date: '2022-01-01', equity_cents: 1100000 }];
    expect(calmarRatio(curve)).toBeNull();
  });
});

// ── Trade-ledger metrics ─────────────────────────────────────────────────
// Trade shape here matches the REAL, landed server/backtest/engine.js Trade
// record (confirmed by reading it): {symbol, side, qty, priceCents,
// grossCents, commissionCents, slippageCents, cashDeltaCents, date} — one
// fill leg per entry, no pnl_cents. winRate/profitFactor must reconstruct
// realized P&L via average-cost replay (same accounting engine.js itself
// uses for avgCostCents).
describe('winRate and profitFactor (average-cost reconstruction from real fills)', () => {
  // The cost basis is fee-inclusive, like engine.js's: each buy's $1
  // commission is part of what its shares cost, so a round trip's P&L
  // carries both commissions (it used to carry only the sell's).
  // Symbol X: buy 10 @ $10.00 +$1 (basis 10100), buy 10 @ $12.00 +$1 (basis
  // 10100+12100 = 22200, avgCost 1110), sell all 20 @ $13.00 -> proceeds
  // 26000-100=25900, pnl = 25900-22200 = +3700 (win).
  // Then buy 5 @ $10.00 +$1 (basis 5100), sell 5 @ $9.00 -> proceeds
  // 4500-100=4400, pnl = 4400-5100 = -700 (loss).
  const trades = [
    { symbol: 'X', side: 'buy', qty: 10, priceCents: 1000, grossCents: 10000, commissionCents: 100, slippageCents: 0, cashDeltaCents: -10100, date: '2024-01-01' },
    { symbol: 'X', side: 'buy', qty: 10, priceCents: 1200, grossCents: 12000, commissionCents: 100, slippageCents: 0, cashDeltaCents: -12100, date: '2024-01-02' },
    { symbol: 'X', side: 'sell', qty: 20, priceCents: 1300, grossCents: 26000, commissionCents: 100, slippageCents: 0, cashDeltaCents: 25900, date: '2024-01-03' },
    { symbol: 'X', side: 'buy', qty: 5, priceCents: 1000, grossCents: 5000, commissionCents: 100, slippageCents: 0, cashDeltaCents: -5100, date: '2024-01-04' },
    { symbol: 'X', side: 'sell', qty: 5, priceCents: 900, grossCents: 4500, commissionCents: 100, slippageCents: 0, cashDeltaCents: 4400, date: '2024-01-05' },
  ];

  it('winRate = 1 win / 2 closed round-trips = 0.5', () => {
    expect(winRate(trades)).toBe(0.5);
  });

  it('profitFactor = gross profit 3700 / gross loss 700', () => {
    expect(profitFactor(trades)).toBeCloseTo(3700 / 700, 9);
  });

  it('a round trip that nets a loss only once BOTH commissions count is a loss, not a win', () => {
    // buy 150 @ $100.00 (+$1), sell 150 @ $100.01 (-$1): +$1.50 gross, -$0.50 net.
    const roundTrip = [
      { symbol: 'Y', side: 'buy', qty: 150, priceCents: 10000, grossCents: 1_500_000, commissionCents: 100, cashDeltaCents: -1_500_100, date: '2024-01-01' },
      { symbol: 'Y', side: 'sell', qty: 150, priceCents: 10001, grossCents: 1_500_150, commissionCents: 100, cashDeltaCents: 1_500_050, date: '2024-01-02' },
    ];
    expect(winRate(roundTrip)).toBe(0);
  });

  it('both return null on an empty trade list', () => {
    expect(winRate([])).toBeNull();
    expect(profitFactor([])).toBeNull();
  });

  it('ignores buy fills, which never carry a realized P&L on their own', () => {
    expect(winRate([trades[0], trades[1]])).toBeNull(); // two opens, no closes yet
  });

  it('trusts an explicit finite pnl_cents instead of re-deriving it', () => {
    expect(winRate([{ pnl_cents: 100 }, { pnl_cents: -50 }])).toBe(0.5);
  });

  it('profitFactor returns null on an all-losses ledger', () => {
    expect(profitFactor([{ pnl_cents: -100 }, { pnl_cents: -200 }])).toBeNull();
  });

  it('profitFactor returns null on an all-wins ledger (no loss denominator)', () => {
    expect(profitFactor([{ pnl_cents: 100 }, { pnl_cents: 200 }])).toBeNull();
  });
});

describe('turnover', () => {
  it('is total notional traded / average equity = 210,000 / 1,050,000 = 0.2', () => {
    const trades = [
      { side: 'buy', qty: 10, priceCents: 10000 },
      { side: 'sell', qty: 10, priceCents: 11000 },
    ];
    const curve = [{ date: '2024-01-01', equity_cents: 1000000 }, { date: '2024-01-02', equity_cents: 1100000 }];
    expect(turnover(trades, curve)).toBeCloseTo(0.2, 9);
  });

  it('returns null with no fills', () => {
    const curve = [{ date: '2024-01-01', equity_cents: 1000000 }];
    expect(turnover([], curve)).toBeNull();
    expect(turnover([{ type: 'deposit', amount_cents: 100 }], curve)).toBeNull();
  });

  it('returns null with no equity curve to average', () => {
    expect(turnover([{ qty: 1, priceCents: 100 }], [])).toBeNull();
  });

  it('also accepts legacy shares/price_cents naming', () => {
    const trades = [{ shares: 10, price_cents: 10000 }, { shares: 10, price_cents: 11000 }];
    const curve = [{ date: '2024-01-01', equity_cents: 1000000 }, { date: '2024-01-02', equity_cents: 1100000 }];
    expect(turnover(trades, curve)).toBeCloseTo(0.2, 9);
  });
});

describe('totalCosts', () => {
  it('sums commission + slippage across all trades in cents', () => {
    const trades = [
      { commissionCents: 100, slippageCents: 50 },
      { commissionCents: 100, slippageCents: 75 },
    ];
    expect(totalCosts(trades)).toBe(325);
  });

  it('is 0 (not null) with no trades', () => {
    expect(totalCosts([])).toBe(0);
    expect(totalCosts(undefined)).toBe(0);
  });
});

// ── Beta / alpha / tracking error ────────────────────────────────────────
describe('beta, alpha, trackingError', () => {
  // Benchmark returns: [0.05, -0.02, 0.03] -> mean 0.02.
  // Portfolio returns constructed as 2*benchmark + 0.01 (true beta=2,
  // true daily alpha=0.01): [0.11, -0.03, 0.07] -> mean 0.05.
  // Adding a constant doesn't change deviations from the mean, so beta is
  // unaffected by the +0.01 offset:
  //   port deviations from mean 0.05: [0.06, -0.08, 0.02]
  //   bench deviations from mean 0.02: [0.03, -0.04, 0.01]
  //   cov (n=3) = (0.06*0.03 + -0.08*-0.04 + 0.02*0.01)/3
  //             = (0.0018 + 0.0032 + 0.0002)/3 = 0.0052/3
  //   var_bench (n=3) = (0.03^2 + 0.04^2 + 0.01^2)/3 = 0.0026/3
  //   beta = cov/var = 0.0052/0.0026 = 2 exactly.
  // alpha_daily = mean_port - beta*mean_bench = 0.05 - 2*0.02 = 0.01.
  // alpha_annual = 0.01 * 252 = 2.52.
  // tracking error: diffs = port - bench = [0.06, -0.01, 0.04], mean 0.03,
  // sample variance (ddof=1) = ((0.03)^2+(-0.04)^2+(0.01)^2)/2 = 0.0026/2 = 0.0013
  // stdev = sqrt(0.0013) ~= 0.036055513, annualized *sqrt(252) ~= 0.572345.
  const equityCurve = [
    { date: '2024-01-01', equity_cents: 1000000 },
    { date: '2024-01-02', equity_cents: 1110000 },
    { date: '2024-01-03', equity_cents: 1076700 },
    { date: '2024-01-04', equity_cents: 1152069 },
  ];
  const benchmark = [
    { date: '2024-01-01', equity_cents: 1000000 },
    { date: '2024-01-02', equity_cents: 1050000 },
    { date: '2024-01-03', equity_cents: 1029000 },
    { date: '2024-01-04', equity_cents: 1059870 },
  ];

  it('beta is exactly 2', () => {
    expect(beta(equityCurve, benchmark)).toBeCloseTo(2, 9);
  });

  it('alpha (annualized) is 2.52', () => {
    expect(alpha(equityCurve, benchmark)).toBeCloseTo(2.52, 9);
  });

  it('trackingError (annualized) matches sqrt(0.0013)*sqrt(252)', () => {
    expect(trackingError(equityCurve, benchmark)).toBeCloseTo(Math.sqrt(0.0013) * Math.sqrt(252), 9);
  });

  it('all three return null with no benchmark', () => {
    expect(beta(equityCurve, null)).toBeNull();
    expect(alpha(equityCurve, undefined)).toBeNull();
    expect(trackingError(equityCurve, [])).toBeNull();
  });

  it('all three return null with too few aligned points', () => {
    const thin = [{ date: '2024-01-01', equity_cents: 1000 }];
    expect(beta(equityCurve, thin)).toBeNull();
    expect(alpha(equityCurve, thin)).toBeNull();
    expect(trackingError(equityCurve, thin)).toBeNull();
  });

  it('beta returns null on a constant (zero-variance) benchmark', () => {
    const constBench = [
      { date: '2024-01-01', equity_cents: 1000000 },
      { date: '2024-01-02', equity_cents: 1000000 },
      { date: '2024-01-03', equity_cents: 1000000 },
    ];
    expect(beta(equityCurve, constBench)).toBeNull();
  });
});

// ── TWR ───────────────────────────────────────────────────────────────────
describe('timeWeightedReturn', () => {
  it('filters out a mid-period deposit that would otherwise inflate simple return', () => {
    // Day0: 1000 (start). Day1: a $500 deposit lands with 0% market move,
    // so equity_cents after the deposit is 1000+500=1500 -> period return
    // = (1500-500)/1000 - 1 = 0. Day2: market +10% on the 1500 base, no
    // more deposits -> equity 1650, period return = 1650/1500 - 1 = 0.10.
    // TWR = 1.0 * 1.10 - 1 = 0.10, whereas naive (1650-1000)/1000 = 0.65.
    const curve = [
      { date: '2024-01-01', equity_cents: 1000 },
      { date: '2024-01-02', equity_cents: 1500 },
      { date: '2024-01-03', equity_cents: 1650 },
    ];
    const trades = [{ date: '2024-01-02', type: 'deposit', amount_cents: 500 }];
    expect(timeWeightedReturn(curve, trades)).toBeCloseTo(0.10, 9);
  });

  it('equals simple compounded return when there are no external cash flows', () => {
    const curve = [
      { date: '2024-01-01', equity_cents: 1000000 },
      { date: '2024-01-02', equity_cents: 1100000 },
      { date: '2024-01-03', equity_cents: 1210000 },
    ];
    expect(timeWeightedReturn(curve, [])).toBeCloseTo(0.21, 9);
  });

  it('returns null with fewer than 2 points', () => {
    expect(timeWeightedReturn([{ date: '2024-01-01', equity_cents: 1000 }], [])).toBeNull();
  });

  it('returns null when a base equity reading is not positive', () => {
    const curve = [{ date: '2024-01-01', equity_cents: 0 }, { date: '2024-01-02', equity_cents: 100 }];
    expect(timeWeightedReturn(curve, [])).toBeNull();
  });
});

// ── XIRR ──────────────────────────────────────────────────────────────────
describe('xirr', () => {
  it('solves a hand-computable 3-flow case via the quadratic formula', () => {
    // -1000 @ 2021-01-01, -1000 @ 2022-01-01 (exactly 1yr later, both
    // 2021/2022 non-leap so day-count is exact), +2200 @ 2023-01-01 (2yr).
    // NPV(r)=0: -1000 - 1000/(1+r) + 2200/(1+r)^2 = 0. Let x=1+r, multiply
    // by x^2: -1000x^2 - 1000x + 2200 = 0 -> x^2 + x - 2.2 = 0.
    // x = (-1 + sqrt(1 + 8.8)) / 2 = (-1 + sqrt(9.8)) / 2 ~= 1.0652475842.
    // r = x - 1 ~= 0.0652475842.
    const cashflows = [
      { date: '2021-01-01', amount_cents: -100000 },
      { date: '2022-01-01', amount_cents: -100000 },
      { date: '2023-01-01', amount_cents: 220000 },
    ];
    const expected = (-1 + Math.sqrt(9.8)) / 2 - 1;
    expect(xirr(cashflows)).toBeCloseTo(expected, 6);
  });

  it('reduces to the lump-sum IRR (= CAGR) with only 2 flows', () => {
    // -1,000,000 @ t0, +1,210,000 @ t0+2yr -> (1+r)^2 = 1.21 -> r = 0.10.
    const cashflows = [
      { date: '2021-01-01', amount_cents: -1000000 },
      { date: '2023-01-01', amount_cents: 1210000 },
    ];
    expect(xirr(cashflows)).toBeCloseTo(0.10, 6);
  });

  it('returns null with fewer than 2 cash flows', () => {
    expect(xirr([{ date: '2021-01-01', amount_cents: -100 }])).toBeNull();
    expect(xirr([])).toBeNull();
    expect(xirr(null)).toBeNull();
  });

  it('returns null when all flows share a sign (no real root)', () => {
    expect(xirr([{ date: '2021-01-01', amount_cents: -100 }, { date: '2022-01-01', amount_cents: -200 }])).toBeNull();
  });

  it('reports a clean 0 (not -0.00% dust like -7.3e-11) on a perfectly flat curve (M4)', () => {
    const cashflows = [
      { date: '2021-01-01', amount_cents: -1000000 },
      { date: '2022-01-01', amount_cents: 1000000 },
    ];
    const r = xirr(cashflows);
    expect(r).toBe(0);
    expect(Object.is(r, -0)).toBe(false);
  });

  it('never hangs on a pathological series and fails closed to null', () => {
    // All-zero amounts: NPV(r) is identically 0 for every r, so there's no
    // sign requirement to fail on the has-both-signs check... use instead a
    // series with both signs but a huge outflow making convergence require
    // the bisection fallback path; assert it still returns within this test's timeout.
    const cashflows = [
      { date: '2021-01-01', amount_cents: -1 },
      { date: '2021-01-02', amount_cents: 1000000000 },
    ];
    const r = xirr(cashflows);
    expect(r === null || Number.isFinite(r)).toBe(true);
  });
});

describe('buildXirrCashflows', () => {
  it('brackets the equity curve with -start/+end and folds in deposit/withdrawal markers', () => {
    const curve = [{ date: '2021-01-01', equity_cents: 100000 }, { date: '2023-01-01', equity_cents: 220000 }];
    const trades = [{ date: '2022-01-01', type: 'deposit', amount_cents: 100000 }];
    expect(buildXirrCashflows(curve, trades)).toEqual([
      { date: '2021-01-01', amount_cents: -100000 },
      { date: '2022-01-01', amount_cents: -100000 },
      { date: '2023-01-01', amount_cents: 220000 },
    ]);
  });

  it('returns null with fewer than 2 equity points', () => {
    expect(buildXirrCashflows([{ date: '2021-01-01', equity_cents: 100 }], [])).toBeNull();
  });
});

// ── metrics() composite ───────────────────────────────────────────────────
describe('metrics', () => {
  const equityCurve = [
    { date: '2021-01-01', equity_cents: 1000000 },
    { date: '2021-07-01', equity_cents: 500000 },
    { date: '2023-01-01', equity_cents: 1210000 },
  ];
  const trades = [{ pnl_cents: 5000 }, { pnl_cents: -2000 }];

  it('assembles every metric into one shape', () => {
    const m = metrics(equityCurve, trades, null);
    expect(m.cagr).toBeCloseTo(0.10, 9);
    expect(m.maxDrawdown).toEqual({ pct: -0.5, startDate: '2021-01-01', endDate: '2021-07-01' });
    expect(m.calmar).toBeCloseTo(0.20, 9);
    expect(m.winRate).toBe(0.5);
    expect(m.totalCostsCents).toBe(0);
    expect(m.beta).toBeNull();
    expect(m.alpha).toBeNull();
    expect(m.trackingError).toBeNull();
    expect(m.inSample).toBeNull();
    expect(m.holdout).toBeNull();
    expect(m.inSampleHoldoutGap).toBeNull();
  });

  it('defaults trades/benchmark/splitDate so metrics(equityCurve) alone does not throw', () => {
    expect(() => metrics(equityCurve)).not.toThrow();
  });

  it('computes an XIRR reconciling to the 2-flow lump-sum case when there are no deposits', () => {
    const m = metrics(equityCurve.slice(0, 1).concat(equityCurve.slice(-1)), []);
    // start 1,000,000 @ 2021-01-01, end 1,210,000 @ 2023-01-01, no deposits.
    expect(m.xirr).toBeCloseTo(0.10, 6);
  });

  it('splits in-sample/holdout on splitDate and reports the CAGR/Sharpe gap', () => {
    // In-sample 2021-01-01..2022-01-01: 1,000,000->1,100,000, exactly 1yr -> CAGR 0.10.
    // Holdout 2022-01-01..2023-01-01: 1,100,000->1,331,000, exactly 1yr -> CAGR 0.21.
    const curve = [
      { date: '2021-01-01', equity_cents: 1000000 },
      { date: '2022-01-01', equity_cents: 1100000 },
      { date: '2023-01-01', equity_cents: 1331000 },
    ];
    const m = metrics(curve, [], null, '2022-01-01');
    expect(m.inSample.cagr).toBeCloseTo(0.10, 9);
    expect(m.holdout.cagr).toBeCloseTo(0.21, 9);
    expect(m.inSampleHoldoutGap.cagrGap).toBeCloseTo(0.11, 9);
  });

  it('inSampleHoldoutGap() standalone matches the field on metrics()', () => {
    const curve = [
      { date: '2021-01-01', equity_cents: 1000000 },
      { date: '2022-01-01', equity_cents: 1100000 },
      { date: '2023-01-01', equity_cents: 1331000 },
    ];
    expect(inSampleHoldoutGap(curve, [], null, '2022-01-01').cagrGap).toBeCloseTo(0.11, 9);
  });

  it('does not double-count a trade dated exactly on splitDate in both in-sample and holdout (M2)', () => {
    const curve = [
      { date: '2021-01-01', equity_cents: 1000000 },
      { date: '2022-01-01', equity_cents: 1100000 },
      { date: '2023-01-01', equity_cents: 1331000 },
    ];
    const splitTrades = [
      { date: '2021-06-01', pnl_cents: 1000 }, // strictly in-sample: a win
      { date: '2022-01-01', pnl_cents: -500 }, // exactly on splitDate: holdout-only now
      { date: '2022-06-01', pnl_cents: 2000 }, // strictly holdout: a win
    ];
    const m = metrics(curve, splitTrades, null, '2022-01-01');
    // In-sample sees only the 2021-06-01 win -> 100% win rate, no losses.
    expect(m.inSample.winRate).toBe(1);
    expect(m.inSample.profitFactor).toBeNull(); // no losses in-sample -> undefined ratio
    // Holdout sees the splitDate trade plus the later one: 1 win, 1 loss.
    expect(m.holdout.winRate).toBe(0.5);
    expect(m.holdout.profitFactor).toBeCloseTo(4, 9); // 2000 / 500
  });

  it('gap fields are null when a split leaves a side without enough points for that metric', () => {
    const curve = [{ date: '2021-01-01', equity_cents: 1000000 }, { date: '2022-01-01', equity_cents: 1100000 }];
    const m = metrics(curve, [], null, '2021-01-01');
    // holdout has 2021-01-01..2022-01-01 (fine), in-sample has only the
    // single 2021-01-01 point (<2) -> its cagr is null -> gap is null.
    expect(m.inSample.cagr).toBeNull();
    expect(m.inSampleHoldoutGap.cagrGap).toBeNull();
  });
});

// ── Integration against the real, landed Track 1 engine ────────────────
describe('metrics against a real runBacktest() output', () => {
  it('accepts engine.js\'s actual equityCurve/trades shape end-to-end without throwing', () => {
    const bars = { AAPL: [] };
    let price = 100;
    for (let i = 0; i < 30; i++) {
      const d = new Date(2024, 0, 1 + i);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      price *= 1.01; // steady 1%/bar drift so there are real fills and no all-NaN edge cases
      bars.AAPL.push({ date, open: price * 0.999, high: price * 1.002, low: price * 0.997, close: price });
    }
    const result = runBacktest({ bars, strategy: buyAndHold('AAPL'), initialCashCents: 1000000 });
    const m = metrics(result.equityCurve, result.trades, null);
    expect(m.cagr).not.toBeNaN();
    expect(Number.isFinite(m.totalCostsCents)).toBe(true);
    expect(m.maxDrawdown).toHaveProperty('pct');
    // buyAndHold never closes, so there's no realized round-trip to rate.
    expect(m.winRate).toBeNull();
  });

  // C2 regression: reconstructRealizedPnlCents used to replay average-cost
  // accounting WITHOUT engine.js's split adjustment (qty *= split;
  // avgCostCents /= split), so a ledger carrying post-split quantities
  // against a pre-split average cost fabricated a loss on an exactly
  // break-even trade. engine.js now emits the correct pnl_cents directly on
  // the sell trade (computed from its own split-adjusted avgCostCents at the
  // moment of the sell), and metrics.js trusts that field instead of
  // re-deriving it.
  it('reports an exact break-even (not a fabricated loss/0% win rate) across a 2:1 split', () => {
    const dates = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'];
    const bars = {
      X: [
        { date: dates[0], open: 100, high: 100, low: 100, close: 100 },
        { date: dates[1], open: 100, high: 100, low: 100, close: 100 },
        { date: dates[2], open: 50, high: 50, low: 50, close: 50, split: 2 },
        { date: dates[3], open: 50, high: 50, low: 50, close: 50 },
      ],
    };
    let step = 0;
    const strategy = {
      onBar() {
        step += 1;
        if (step === 1) return { weights: { X: 1 } }; // buy 100 @ $100, fills at bar[1].open
        if (step === 3) return { weights: { X: 0 } }; // sell 200 (post-split) @ $50, fills at bar[3].open
        return null;
      },
    };
    const result = runBacktest({ bars, strategy, initialCashCents: 1000000, commissionCents: 0, slippageBps: 0 });

    // The equity curve is correctly flat throughout — a split is
    // equity-invariant.
    for (const point of result.equityCurve) expect(point.equity_cents).toBe(1000000);

    const sell = result.trades.find((t) => t.side === 'sell');
    expect(sell.pnl_cents).toBe(0);

    const m = metrics(result.equityCurve, result.trades, null);
    expect(m.winRate).toBe(0); // an exact break-even close is not a "win"
    expect(m.profitFactor).toBeNull(); // no gross profit and no gross loss to ratio
  });
});
