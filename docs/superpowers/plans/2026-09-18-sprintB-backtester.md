# Sprint B — Pure-JS backtester

**Spec:** `~/.claude/plans/lets-make-a-plan-floating-pine.md` §5a (sprint table), the Phase 5 section, §3, §7, §9.
Branch `v3/sprint-b` off master `3d322df` (Sprint A merged, **304 tests / 24 files**).

**Goal:** a deterministic, clean-room backtesting engine that runs in a worker thread, with real metrics and a
Backtest tab. **The desk quant step is cut** — there is no Desk in this build, so the engine's only consumer is
the Backtest tab.

## Provenance — this matters legally

**Clean-room from the specification below. `AI-Trader` must never be opened.** The `ai-hedge-fund` (MIT)
blend/clamp maths may be adapted with attribution. NEXUS's `test_backtest.py` ideas may be ported **as tests**,
not as implementation. Record what was used in `docs/references.md`.

## Global constraints — these bind both tracks

- npm + Node CommonJS server / ESM client. React 18 **JSX not TSX**. No TypeScript, no Bun.
- **No new dependency.** If you believe you need one, stop and report. A new *server* dep would also need
  `SERVER_DEPS` in `scripts/build-portable.mjs` in the same commit — and note the payload require-scan now
  actually asserts the module resolves *inside* the packaged payload, so a miss fails the build loudly.
- **TDD is mandatory for this entire sprint.** This is money math end to end. Write the failing test, watch it
  fail for the right reason, then implement.
- Money is **integer cents** wherever a figure must reconcile. Dates compare as local `YYYY-MM-DD` strings.
  **Never `toISOString()` for a day key and never `new Date('YYYY-MM-DD')`** — that mixes UTC with local
  arithmetic and silently drops rows. `server/money/runway.js`'s `ymd` / `localDateFromStr` are the pattern;
  `server/money/calc.js` was just fixed to match after exactly this bug.
- **Determinism.** The same config and the same bars must produce a byte-identical result hash. No `Math.random`
  without a seeded generator, no wall-clock reads inside the engine.
- No hardcoded hex — semantic `var(--m-*)` / `var(--chart-N)` only. No `cursor: pointer` on cards. Numbers
  `tabular-nums`. Colour always paired with a sign or icon. **Every chart needs a table fallback.** Every figure
  carries an evidence grade.
- Every new table is declared in `schema.sql` and round-trips through `repo.readAll`/`writeAll`.
- `git commit -F -` with a heredoc. Never `git add -A`. Never stage `.omc/`, `build/`, `src/dist/`,
  `.superpowers/`, `.playwright-cli/`, or anything under `server/store/money/`.
- **Never run a bare `node -e` that requires `server/money/store.js` or `server/db/connection.js`** —
  `connection.js:14` falls back to the real dev database when `MMM_DATA_DIR` is unset. Use
  `npx vitest run <file>` or `MMM_DATA_DIR=$(mktemp -d) node -e '...'`.
- **Never run `npm run build:portable`** or `npm start`. Never two builds at once.

---

## Track 1 — engine core (pure, TDD)

**Files:** `server/backtest/engine.js`, `server/backtest/view.js`, `server/backtest/strategies.js`,
`tests/backtest-engine.test.mjs`, `tests/backtest-strategies.test.mjs`.

**The event loop, in this exact order per bar:**
mark → corporate actions → cash flows → `strategy.onBar(view)` → target weights → orders → risk clamp →
**fill at the NEXT bar's open** ± slippage bps − commission → ledger.

- **`view.js` is the look-ahead guard and the single most important file in this sprint.** The view handed to
  `onBar` exposes only bars up to and including the current index. **Reaching for the current bar's close, or
  any future bar, must throw** — not return undefined, not return NaN. A strategy that can see its own bar's
  close backtests beautifully and loses money in reality.
- `strategies.js`: `buyAndHold`, `dca`, `fixedWeightRebalance`, `smaCross`, `emaCross`. (`personaBlend` is
  **cut** — it depended on the Desk.)
- Ledger invariants hold every bar: cash + positions marked = equity; no negative share count unless the
  strategy is explicitly short; every fill traceable to an order.

**Required tests — these are the acceptance criteria, not suggestions:**
- **Look-ahead guard:** a strategy touching `bars[i].close` on its own bar throws.
- **Golden math:** a series compounding 10%/yr returns a 10% CAGR; a −50% then +100% series reports a 50% max
  drawdown and 0% total return.
- **Ledger invariants** after every bar.
- **Clamp idempotence:** applying the risk clamp twice equals applying it once.
- **Costs bite:** a zero-alpha strategy with costs finishes *below* buy-and-hold.
- **Split invariance:** a 2:1 split leaves equity unchanged.
- **Determinism:** the same config twice produces the same result hash.

---

## Track 2 — metrics (pure, TDD)

**Files:** `server/backtest/metrics.js`, `tests/backtest-metrics.test.mjs`.

Computed from an equity curve plus a trade ledger: CAGR, max drawdown **with its start and end dates**, Sharpe,
Sortino, Calmar, volatility, win rate, profit factor, turnover, total costs, beta / alpha / tracking error vs a
benchmark, **TWR and XIRR**, and the in-sample vs holdout gap.

- Agree the input shape with Track 1 before writing code — `metrics(equityCurve, trades, benchmark)` where
  `equityCurve` is `[{ date, equity_cents }]`. Write it down in your report.
- Every metric needs a test with a hand-computed expected value. A metric asserted only against its own
  implementation proves nothing.
- Guard every denominator: zero variance, a single data point, an empty trade list, a missing benchmark. Return
  `null` rather than `NaN` or `Infinity`, and say so in the shape.

---

## Wave 2 (after both tracks land) — worker, persistence, UI

**Files:** `server/backtest/worker.js`, `server/backtest/routes.js`, `schema.sql` (+`price_bars`, `strategies`,
`backtest_runs`), `repo.js`, `server/index.js`, `src/components/money/sections/parts/trades/Backtest.jsx`,
`tests/backtest-routes.test.mjs`.

- CPU-bound runs go in `worker_threads` inside the existing forked Express process. **No `utilityProcess`, no
  Python** — both are explicitly cut.
- `backtest_runs` stores a **config hash** and an outcome enum: `completed | no_data | invalid_config | failed`.
- Bars come from `price_bars` (Yahoo, opt-in, via Sprint A's `online.fetch`) **or a CSV upload that works fully
  offline**. The offline path is not optional — a user with no keys must still be able to run a backtest.
- The Backtest tab replaces the `ComingSoon` placeholder Sprint A left at `/trades/backtest`: equity vs
  benchmark, underwater curve, monthly heatmap, rolling Sharpe, allocation over time, trade markers, and a
  **cost waterfall**. Table fallback on each.

## Verification

Per track: `npm test` up from **304 / 24**, `npm run build` exit 0, `npm run check:contrast` green.
Sprint gate (controller): full suite, `build:portable` smoke, an end-to-end run on real bars, one review, merge.
