# Quantitative Components: Backtest, Paper Trading, and Prediction-Market Math

## Abstract

MMM implements three quantitative surfaces: a deterministic backtest engine whose strategies physically cannot read future bars, a paper-trading gate that validates every simulated order against a fixed rulebook, and an odds layer for prediction markets and sportsbooks. The backtest produces an integer-cent equity curve and trade ledger, from which a metrics module derives standard performance statistics (CAGR, Sharpe, Sortino, Calmar, max drawdown, win rate, profit factor, turnover, beta, alpha, tracking error, TWR, XIRR, and in-sample/holdout splits). Paper trading moves no real money and has no brokerage integration; the betting surface is read-only. The odds math is mirrored in CommonJS (server) and ESM (browser), and a single test runs every assertion through both copies so they cannot drift.

## Goals and Non-Goals

**Goals**:
- Backtest: deterministic, auditable, look-ahead-free result per configuration (same config in, same output out); long-only, whole-share whole-market sizing.
- Metrics: precise definition of every ratio (annualization convention, null handling, formula) with hand-verified test fixtures, not production-quality statistical software.
- Paper trading: gatekeeping with conviction/position/sector/risk:reward rules; equity mark-to-cost until live quotes arrive.
- Odds: correct arbitrage detection and optimal stake-sizing; two-way markets only.

**Non-Goals**:
- Not a live trading system (paper-only forever; no brokerage SDK).
- Not a backtest optimizer (no grid search, no parameter sweep).
- Not a machine-learning or statistical inference system.
- Not three-way (soccer) market arbitrage scoring (explicitly excluded).
- Not leverage, short-selling, or fractional shares.
- Not calendar-aware annualization (XIRR and TWR use actual/365 day counts; volatility uses a fixed 252 trading days per year regardless of real data sampling).

## Backtest Engine

**File**: `server/backtest/engine.js`

The engine runs a strategy against aligned OHLC bars in a deterministic, pure-functional style. Every bar includes an optional `split` (default 1, applied before mark) and `dividend` (default 0, per-share, paid after mark). Dates are compared as 'YYYY-MM-DD' strings, never Date objects, to avoid UTC/local timezone creep.

### Event Order Per Bar

For bar i:
1. **Corporate actions**: apply split multiplier to shares and divide avg-cost by it (maintains equity invariant).
2. **Mark**: equity = cash + Σ(qty × price) using bar i's close, recorded in the curve.
3. **Cash flows**: dividend payouts (qty × per-share dividend).
4. **Strategy call**: `strategy.onBar(view, ctx)` returns a full or partial target-weight map (symbols omitted keep current weight; null/undefined = no change).
5. **Risk clamp**: cap each asset at `maxWeightPerAsset`, then scale down proportionally if gross exposure exceeds 100% (long-only). Idempotent in one pass.
6. **Ordering**: sell orders first (to free cash for buys), then buys, within each group sorted by symbol name (deterministic tie-break).
7. **Fill**: at bar (i+1)'s open with slippage applied against the side that hurts (buy = slippage added to open, sell = subtracted). Whole-share sizing only (floor-based). Buys capped to affordable quantity; unfunded buys are dropped.

### Look-Ahead Guard

**File**: `server/backtest/view.js`

The strategy receives a guarded proxy (`view.bars[symbol]`) that exposes only bars[0..i], never bar[i] or beyond. The Proxy traps five trap types to close metadata leaks:
- `get`/`has`: reject indices >= currentIndex.
- `getOwnPropertyDescriptor`/`ownKeys`: prevent descriptor-read bypass (Object.getOwnPropertyDescriptor was the original hole).
- `set`/`deleteProperty`/`defineProperty`: read-only.

Any access to a future bar throws `LookAheadError` immediately (never silently returns undefined/NaN, which is how subtle bugs hide).

### Trade Record

Each fill produces a Trade object (one leg, not a round-trip):
```
{
  id, symbol, side: 'buy'|'sell', qty (whole shares),
  date, priceCents (fill price), grossCents, commissionCents, slippageCents,
  cashDeltaCents (capital impact), decisionIndex (bar index that decided it),
  pnl_cents? (sell legs only; realized P&L using split-adjusted avg-cost at fill time)
}
```

The engine maintains per-symbol `avgCostCents` and applies the same average-cost accounting that the metrics engine uses to derive win-rate and profit-factor. On a buy, `avgCostCents = (prior*qty + gross) / newQty`. On a sell, `pnl_cents = proceeds - (avgCostCents * qty)` before resetting avgCostCents to 0 if quantity is fully closed.

### Slippage & Commission

- **Slippage** (default 10 bps): `slipPerShare = round(openCents × slippageBps / 10000)`; buy includes it, sell subtracts it.
- **Commission** (default $1 = 100 cents): flat per fill, charged on fills that go through (not order sizing).

### Determinism

**Invariant 1** `server/backtest/engine.js:85–87`: Result hash is SHA256(JSON.stringify(result)). Same config, same hash. Used for run-reuse caching.

## Metrics Engine

**File**: `server/backtest/metrics.js`

Converts an equity curve and trade ledger into 15 statistics. Two conventions govern annualization:

- **Calendar-time figures** (CAGR, XIRR): actual elapsed days / 365 per year. Chosen over 365.25 so date-arithmetic in tests is exact; error is <0.07%.
- **Return-series figures** (volatility, Sharpe, Sortino, Calmar, tracking error, alpha): assume daily sampling; annualize with √252 (or 252 for alpha's linear scale-up).

### Metric Definitions

**CAGR** (`server/backtest/metrics.js:134–143`):
```
cagr = (ending / starting)^(1 / (days / 365)) − 1
```
Null if < 2 points, starting equity ≤ 0, or elapsed days ≤ 0.

**Max Drawdown** (`server/backtest/metrics.js:157–195`):
Peak-to-trough decline. Peak must be positive; trough can be zero (total wipeout = −100%). Returns `{pct, startDate, endDate}`. Null shape if no positive peak ever established.

**Volatility** (`server/backtest/metrics.js:205–210`):
```
volatility = stdev(period_returns, ddof=1) × √252
```
Null if < 2 returns. Returns 0 (not null) if all returns are identical (well-defined, not missing data).

**Sharpe Ratio** (`server/backtest/metrics.js:217–224`):
```
sharpe = (mean(returns) / stdev) × √252
```
Risk-free rate fixed at 0. Null if < 2 returns or zero variance.

**Sortino Ratio** (`server/backtest/metrics.js:232–241`):
```
sortino = (mean(returns) / downside_stdev) × √252
```
Target return = 0 (any period with negative return is a loss). Uses all returns for the mean, only negative deviations for downside stdev (denominator = n, not n-1). Null if < 2 returns or zero downside deviation.

**Calmar Ratio** (`server/backtest/metrics.js:248–253`):
```
calmar = cagr / |max_drawdown_pct|
```
Null if either component is null or max drawdown is 0.

**Win Rate** (`server/backtest/metrics.js:318–323`):
Fraction of closed round-trips that were profitable. Reconstructs realized P&L from the trade ledger using the same average-cost accounting the engine used. Null if no closed trades.

**Profit Factor** (`server/backtest/metrics.js:333–340`):
```
profit_factor = sum(wins) / sum(|losses|)
```
Null if no closed trades, no losses, or no wins.

**Turnover** (`server/backtest/metrics.js:349–359`):
```
turnover = (sum of notional traded) / (average equity)
```
Notional = both buys and sells summed. Null if no fills or average equity ≤ 0.

**Total Costs** (`server/backtest/metrics.js:366–369`):
```
totalCosts = sum(commissionCents + slippageCents)
```
Returns 0 (not null) with no trades.

**Beta** (`server/backtest/metrics.js:405–417`):
```
beta = covariance(port_returns, bench_returns) / variance(bench_returns)
```
Aligns portfolio and benchmark by date key. Null if < 3 aligned points (need ≥2 returns), benchmark absent/empty, or zero benchmark variance.

**Alpha** (`server/backtest/metrics.js:424–430`):
```
alpha = (mean(port) − beta × mean(bench)) × 252
```
Linear scale-up (not compounded). Null if beta is null.

**Tracking Error** (`server/backtest/metrics.js:436–442`):
```
tracking_error = stdev(port_return − bench_return) × √252
```
Null if < 3 aligned points or benchmark absent.

**Time-Weighted Return** (`server/backtest/metrics.js:457–475`):
Geometrically links period returns, backing out external cash flows (`type: 'deposit'|'withdrawal'` on the trade ledger). Null if < 2 points or any non-positive equity reading encountered.

**XIRR** (`server/backtest/metrics.js:498–544`):
Solves for the annualized rate r that zeroes NPV of a cash-flow series. Cash flows are: initial outflow (starting equity), any deposit/withdrawal markers from the trade ledger, and final inflow (ending equity). Uses Newton's method from r₀=0.1 (50 iterations, 1e-7 tolerance on NPV), falling back to bisection over [−99.99%, +1000%] if Newton doesn't converge and a sign change exists in the bracket (200 iterations). Returns null if both fail, or if flows are all same-sign (no real root).

### In-Sample / Holdout Split

When `splitDate` is provided, the metrics engine slices the curve and trades into two periods:
- **In-sample**: date ≤ splitDate (inclusive).
- **Holdout**: date ≥ splitDate (inclusive—the boundary date is shared to anchor the period return starting at the split).

Trade slicing is exclusive on splitDate (to avoid double-counting trades that land exactly on the boundary): in-trades have date < splitDate, out-trades have date ≥ splitDate.

Gap metrics report `holdout.cagr − in_sample.cagr` and likewise for Sharpe, or null if either component is null.

### Null Handling

Every ratio/rate metric returns `null` (never NaN/Infinity) when its denominator is degenerate or inputs insufficient. Only `totalCosts` legitimately returns 0 (no trades = no costs, a known fact, not missing data).

### Trade Ledger Input Contract

The metrics engine accepts trade fills one-leg-at-a-time (the shape `engine.js` produces). It also tolerates external cash-flow markers `{date, type: 'deposit'|'withdrawal', amount_cents}` for TWR/XIRR (unused by the current engine.js, but forward-compatible). If a trade carries an explicit finite `pnl_cents`, that value is trusted; otherwise, realized P&L is reconstructed via average-cost replay (same logic the engine itself uses).

## Strategy Factories

**File**: `server/backtest/strategies.js`

Each factory returns `{name: string, onBar(view, ctx): {weights: ...} | null}`. Strategies are pure (no mutable state across bars) to ensure determinism.

- **Buy and Hold** (`symbol`): allocate 100% on first bar with no position, never rebalance.
- **DCA** (`{symbol, amountCents, everyNBars}`): every N bars, add a fixed dollar amount to the symbol's weight.
- **Fixed Weight Rebalance** (`{weights, everyNBars}`): every N bars, rebalance to a target weight vector.
- **SMA Cross** (`{symbol, fastPeriod, slowPeriod}`): 100% if fast SMA > slow SMA, else 0%.
- **EMA Cross** (`{symbol, fastPeriod, slowPeriod}`): 100% if fast EMA > slow EMA, else 0%.

## Paper-Trading Gate

**File**: `server/trading/strategy-gate.js`, `server/trading/config.js`

The gate is a deterministic rulebook validator. Input is a `TradeDecision` object; output is `{ok: boolean, violations: string[]}` (if ok, also qty). Defaults (from config.js):

| Rule | Default | Meaning |
|------|---------|---------|
| maxPositions | 6 | Max open positions (override not checked if symbol already held) |
| maxPositionPct | 20 | Max notional per position (% of equity) |
| minPositionPct | 5 | Min notional per position (% of equity) |
| maxTradesPerWeek | 3 | Max trade count in rolling 7 days |
| minBuyConviction | 7 | Min conviction (1–10) to pass |
| sectorFailureLimit | 2 | Blacklist sector after ≥2 consecutive losses in 14 days |
| riskRewardMultiple | 2 | Min target:stop ratio (2:1 minimum) |

**Invariant 2** `server/trading/strategy-gate.js:102–126`: All checks are applied before qty is sized. A violation on any check sets `ok: false`.

**Invariant 3** `server/trading/paper-store.js:51–56`: Equity used for gate sizing is mark-to-cost (capital + cost-basis of open positions), not mark-to-market, until a live quote feed is integrated.

## Odds Math

**Files**: `server/betting/odds.js`, `src/lib/odds.js`

Pure mathematical layer, no I/O, no dates, no money-at-rest. Unit-free ratios and probabilities. Mirrored in CJS and ESM; a shared test harness runs the same assertions against both to prevent drift.

### Conversions

**American ↔ Decimal**:
- Positive (underdog): `decimal = american / 100 + 1`.
- Negative (favourite): `decimal = 100 / |american| + 1`.
- Reverse: `american = (d − 1) × 100` if d ≥ 2, else `american = −100 / (d − 1)`.

**Implied Probability**:
```
implied_prob = 1 / decimal
```

**Remove Vig** (Multiplicative de-vig):
```
fair_probs = implied_probs / sum(implied_probs)
```
Normalizes so they sum to 1, preserving the ratio between bookmakers' odds for each outcome.

### Expected Value & Kelly

**Expected Value**:
```
ev = prob × (decimal − 1) − (1 − prob)
```

**Kelly Stake** (fraction of bankroll):
```
kelly = max(0, (b × p − (1 − p)) / b) × fraction
```
where b = decimal − 1, p = your probability, fraction = 0.25 (quarter-Kelly) by default.

### Arbitrage & Stake Sizing

**Arbitrage Profit %** (`server/betting/odds.js:77–83`):
```
profit_pct = (1 / (pA + pB) − 1) × 100
```
where pA, pB are implied probabilities of the two legs (may be from different books). Guarantees a profit equal to `profit_pct × totalStake / 100` regardless of which outcome occurs. Negative when the book holds a margin (sum of implied probs > 1).

**Optimal Stakes** (`server/betting/odds.js:86–99`):
```
payout = totalStake / (pA + pB)
stakeA = totalStake × pA / (pA + pB)
stakeB = totalStake × pB / (pA + pB)
```
Each leg returns the same payout; profit = payout − totalStake.

**Cross-Book Arbitrage** (`server/betting/odds.js:103–131`):
Tests every unordered pair of different books, both directions (home-away and away-home). Sorts by profit descending. Returns null/[] if no profitable arb found.

### Consensus & Value

**Consensus Probs** (`server/betting/odds.js:135–141`):
De-vig each book independently, then average the de-vigged home probabilities. One outlier book cannot define "fair" by itself.

**Value Edge** (`server/betting/odds.js:144–149`):
```
edge = fair_prob − implied_prob
ev = expected_value(fair_prob, decimal)
```
How much better (or worse) than consensus a single quoted price is.

### Null Semantics

`null`/`undefined`/`''` all mean "not priced" (not zero). The helper `n(v)` coalesces to `null` if not finite. Unquoted sides for Kalshi (cents-priced market) return `null`, not −Infinity.

### Exclusions

Three-way markets (soccer h/a/d) are excluded from two-way arb scoring (findArbitrage checks pairs of opposite sides only, skips draws).

**Invariant 4** `tests/betting-odds.test.mjs:17–21`: Both CJS (server) and ESM (client) implementations are tested against the same table. Any formula change must update both files identically.

## Worker & Routing

**File**: `server/backtest/worker.js`

Backtests run in a worker_thread to avoid blocking the Express event loop. The main thread passes a serializable `{kind, params}` strategy spec; the worker reconstructs the real strategy object before calling `runBacktest`. Worker times out after 30 seconds by default.

**Files**: `server/backtest/routes.js`, `server/trading/routes.js`, `server/betting/routes.js`

Routes expose `/api/backtest`, `/api/trades/paper`, `/api/betting` endpoints. Backtest routes accept bars (dollar-denominated), strategy spec, and cash, returning `{equityCurve, trades, finalCashCents, finalPositions, resultHash}`. Paper-trading routes are GET-only (no write, no orders execute). Betting routes return odds calculations (implied probs, arbs, value).

## Invariants

1. **engine.js:85–87**: Result hash is deterministic; same config → same hash.
2. **strategy-gate.js:102–126**: Gate violations are checked before qty is sized; any violation → `ok: false`.
3. **paper-store.js:51–56**: Equity is mark-to-cost until live quotes arrive.
4. **betting-odds.test.mjs:17–21**: CJS and ESM odds implementations are bit-identical per the shared test table.

## Verification

**Backtester**: 
- `tests/backtest-engine.test.mjs`: look-ahead guard (Proxy traps, metadata leaks, array methods, read-only).
- `tests/backtest-metrics.test.mjs`: CAGR, drawdown, volatility, Sharpe, Sortino, Calmar, win-rate, profit-factor, turnover, beta, alpha, tracking-error, XIRR, in-sample/holdout gap (hand-computed fixtures, including edge cases like wipeout, flat curves, degenerate denominators).
- `tests/backtest-strategies.test.mjs`: strategy factories produce correct onBar behavior.

**Paper Trading**:
- `tests/strategy-gate.test.mjs`: conviction, position count, trade quota, sector blacklist, risk:reward, qty sizing, all violation messages.
- `tests/paper-store.test.mjs`: open/close mechanics, mark-to-cost equity, commission/slippage, symbol position tracking.

**Odds**:
- `tests/betting-odds.test.mjs`: runs all formulas (american/decimal, implied prob, remove-vig, expected-value, Kelly, arb-profit, optimal-stakes, cross-book-arb, consensus, value-edge) against BOTH server (CJS) and client (ESM) implementations; fixtures hand-derived, not ported from NEXUS (which had two bugs: arbProfitPct and alpha annualization).

## Known Limitations

1. **Annualization simplification**: Alpha is scaled linearly (×252) rather than compounded. This is documented in the header comment and intentional (assumes small per-period excess, which is typical).
2. **Three-way de-vig deferred**: Soccer markets are excluded from two-way arbitrage. A three-way de-vig (home/away/draw) is not implemented.
3. **No live quotes**: Paper equity is mark-to-cost only. Integration with a live quote feed (e.g., market.js price_cache) would upgrade to mark-to-market; gate sizing and paper routes are ready for that addition.
4. **No parameter sweep**: Backtest is a single run, not an optimizer. Grid search over strategy parameters would be a separate tool.
5. **No short-selling or leverage**: long-only by design.

