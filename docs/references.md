# References — Sprint B, Track 1 (backtest engine core)

Clean-room implementation from `docs/superpowers/plans/2026-09-18-sprintB-backtester.md` §Track 1.
**`AI-Trader` was never opened, read, or referenced.** No code from it exists anywhere in this diff.

## What was actually used

- **No external code was adapted.** The `ai-hedge-fund` (MIT) clamp/blend maths mentioned in the
  plan as an allowed-with-attribution source was not used — `personaBlend` (the strategy that would
  have needed it) is cut in this build (no Desk), and the risk clamp implemented here
  (`server/backtest/engine.js`'s `clampWeights`) is a simple two-step per-asset-cap +
  proportional-gross-exposure-rescale, written from scratch to satisfy the idempotence requirement
  in the brief. No `ai-hedge-fund` source was opened.
- **House patterns followed, in-repo:**
  - `server/money/runway.js`'s `ymd`/local-date-string pattern — the engine and its tests compare
    dates as `YYYY-MM-DD` strings exclusively and never construct a `Date` inside engine.js itself
    (test fixtures use `Date` only to *generate* calendar sequences, same as runway.test.mjs does).
  - `server/trading/paper-store.js` — default slippage (10 bps / 0.1%) and flat commission ($1 /
    100 cents) match this module's constants exactly; the "rebuild both legs from integer cents so
    P&L is correct by construction" idea is carried into the trade ledger's `cashDeltaCents`.
  - `tests/strategy-gate.test.mjs` — house test style (small pure fixtures, both sides of a
    threshold, hand-computed expected values) followed in both new test files.
- NEXUS's `test_backtest.py` was **not opened** — Track 1 had no need to port any of its test ideas;
  all required-test scenarios (look-ahead guard, golden math, ledger invariants, clamp idempotence,
  costs bite, split invariance, determinism) were derived directly from the sprint brief's own
  wording and written from scratch.

## Deliberate deviation from the brief, and why

The brief lists the per-bar event order as "mark → corporate actions → cash flows → ...". This
implementation applies **corporate actions before marking** instead. Reasoning: a split's shares
are only equity-invariant if they are already split-adjusted at the moment the bar's (already
post-split) close is used to mark the position — marking with the pre-split share count against a
post-split close would make equity jump by 1/split at the split bar, which is exactly what the
brief's own required test ("a 2:1 split leaves equity unchanged") forbids. Cash flows (dividends)
still apply after the mark, as literally specified. See the comment above the corporate-actions
block in `server/backtest/engine.js` for the inline pointer back to this note.
