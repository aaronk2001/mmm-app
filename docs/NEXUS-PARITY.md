# NEXUS parity record

What Aaron gives up (and what he keeps) by archiving `nexus-app`, written before
`scripts/archive-nexus.sh` is ever run. Surveyed against the real NEXUS source
at `C:\Users\aaron\projects\Finance agent\nexus-app` on 2026-09-18 — sidebar
(`src/components/layout/Sidebar.jsx`), tab switch and sub-tab arrays in
`src/App.jsx`, and the route files under `server/routes/`, `server/ensemble/`,
`server/trading/`, `server/nexus/`. Not written from memory.

Status legend: **Ported** (lives in mmm-app today, verified in mmm-app's own
source), **Deferred** (cut from the daily build for now but still on a
roadmap), **Cut** (deliberately not being rebuilt — see reason).

## Dashboard

| NEXUS feature | Status | Where it lives now / why cut |
|---|---|---|
| Dashboard tab (net worth, quick stats) | Ported | `src/components/money/sections/Overview.jsx` + `AccountsNetWorth.jsx` — rebuilt on mmm-app's own ledger data, not a straight code port. |

## Markets (`MARKETS_TABS`: chart, screener, macro, sectors, futures, crypto, forex)

| NEXUS feature | Status | Where it lives now / why cut |
|---|---|---|
| Chart panel | Ported | `sections/Markets.jsx` → `parts/markets/Chart.jsx`; server `GET /api/market/chart/:symbol`. |
| Screener | Ported | `parts/markets/Screener.jsx`; server `GET /api/market/screens`, `/api/market/screener/:screenId`. |
| Macro dashboard | Ported | `parts/markets/Macro.jsx`; server `GET /api/market/macro/:seriesId` (was `nexus/tools/macro.js`, same data shape). |
| Sector rotation | Ported | `parts/markets/Sectors.jsx`; server `GET /api/market/sectors`. |
| Futures panel | Ported | `parts/markets/Futures.jsx`; server `GET /api/market/futures`. |
| Crypto panel | Ported | `parts/markets/Crypto.jsx`; server `GET /api/market/crypto`. |
| Forex panel | Ported | `parts/markets/Forex.jsx`; server `GET /api/market/forex`. |
| Watchlist + auto-refresh scheduler (`nexus/watchlist-scheduler.js`) | Ported (data), Cut (scheduler) | Watchlist itself: `parts/markets/Watchlist.jsx`, server `GET/POST /api/market/watchlist` — Aaron's 2 watchlist tickers were migrated once via `scripts/import-nexus.mjs`. The always-on cron-based auto-refresh scheduler was **not** rebuilt: all market data in mmm-app is opt-in and gated behind the `online.enabled('market')` toggle (Settings), fetched on request via `/api/market/refresh`, not polled in the background. This is a deliberate design change (mmm-app never phones home unless told to), not an oversight. |
| Quote / earnings endpoints | Ported | `GET /api/market/quote/:symbol`, `/api/market/earnings/:symbol`. |

Net: Markets is the most completely ported tab — same sub-tab shape as NEXUS,
same data provider (`yahoo-finance2`), rebuilt cleanly behind mmm-app's
online-fetch gate instead of NEXUS's always-fetch model.

## Intelligence (`INTEL_TABS`: news, youtube, media, research)

| NEXUS feature | Status | Why cut |
|---|---|---|
| News bulletin (`NewsBulletin`) | Cut | Media. No news feed in mmm-app. |
| YouTube panel (`YoutubePanel`) | Cut | Media. No video feed in mmm-app. |
| Media feed (`MediaFeed`) | Cut | Media rebuild is explicitly out of scope — this whole sub-tab is gone. |
| Research report (`ResearchReport`) | Cut | Depended on the AI analyst engine (`server/nexus/analyst-engine.js`, proxied through `server/routes/analyze.js`) — cut with the rest of AI/Desk (no LLM contract). |

Net: the entire Intelligence tab is gone. Nothing in mmm-app replaces it yet.

## Trades (`TRADES_TABS`: war-room, ensemble, signals, trend, backtest, analytics, risk, open, closed, simulate)

| NEXUS feature | Status | Where it lives now / why cut |
|---|---|---|
| War Room (`WarRoom`, multi-agent debate) | Cut | AI/Desk. Depended on `server/routes/desk.js` → `nexus/desk-engine.js` (SSE agent debate stream). No LLM contract. |
| Ensemble mode (`EnsembleMode`) | Cut | AI/Desk. `server/ensemble/routes.js`. Same reason. |
| ML signals (`MLSignalCard`) | Cut | Depended on a local Python sidecar at `127.0.0.1:5003` (`server/routes/ml.js`, `predict.js`) — that sidecar isn't part of mmm-app and wasn't rebuilt. |
| Trend card (`TrendCard`) | Cut | Same Python-sidecar dependency as ML signals. |
| Backtest panel | **Ported** | `sections/Trades.jsx` → `parts/trades/Backtest.jsx`; server `server/backtest/routes.js` — rebuilt as a pure-JS backtester (Sprint B), not a proxy to any external service. This is the one AI-adjacent-sounding feature that survived, because it never actually needed an LLM. |
| Analytics panel | Cut | Portfolio analytics tied to the AI analyst engine — not rebuilt standalone. |
| Risk calculator (`RiskCalculator.jsx`) | **Ported** | `parts/trades/RiskCalculator.jsx` — comment in the file says "Ported from nexus-app/src/components/nexus/RiskCalculator.jsx — pure [math]," confirming it needed no AI/service dependency to bring over. |
| Paper trading — open / closed / simulate (`PaperTrading`) | **Ported** | `parts/trades/Open.jsx`, `Closed.jsx`, journal in `parts/trades/Journal.jsx`; server `server/trading/routes.js` (`/account`, `/positions`, `/trades`, `/summary`, `/gate-check`, `/open`, `/close/:id`, `/journal`). The strategy gate itself (`server/trading/strategy-gate.js`) is a verbatim port per its own header comment ("Ported verbatim from nexus-app/server/trading/strategy-gate.js"). |
| One-time data carryover | **Ported** | `server/trading/import-nexus.js` (`scripts/import-nexus.mjs` CLI + the "Import NEXUS data" button wired through `POST /api/trading/import-nexus`) — already run once by Aaron: 2 paper trades, 2 watchlist tickers, plus any `reflection.db` decisions/closes and `snapshot.json` profile data. Idempotent, safe to re-run. |

Net: everything that could run on real market math (backtest, risk calc,
paper trading, the strategy gate) made it over. Everything that needed an LLM
or the Python ML sidecar (War Room, ensemble, ML signals, trend, analytics)
did not.

## Planning (`PLANNING_TABS`: roadmap, goals, whatif, snapshot, subscriptions)

| NEXUS feature | Status | Where it lives now / why |
|---|---|---|
| Goal progress (`GoalProgress`) | **Ported** | `sections/Goals.jsx`; server `/api/money/goals`, `/api/money/goals/:id`, `/api/money/goals/insights`. Rebuilt on live transaction/account data instead of a manually-entered snapshot. |
| What-if sliders (`WhatIfSliders`) | **Ported** (redesigned) | `sections/Plan.jsx` → `parts/plan/WhatIf.jsx`. |
| Roadmap view (`RoadmapView`) | Deferred | No direct mmm-app equivalent yet. NEXUS's roadmap was a milestone timeline computed off the manually-edited `snapshot.json` profile; mmm-app's Plan/Goals sections work off real transaction data instead, and a roadmap/timeline view on top of that hasn't been built. Tracked as a gap, not a deliberate cut. |
| Snapshot editor (`SnapshotEditor`) | Cut (by design) | NEXUS required hand-entering a financial snapshot (income, expenses, goals) to power Planning. mmm-app computes the equivalent numbers from imported transactions/accounts, so there's no snapshot to edit — this is a deliberate architecture change (grounded-in-real-data vs. manually-modeled), not a missing feature. The one-time `snapshot.json` → `settings.profile` import path still exists in `import-nexus.js` for whatever Aaron had already entered. |
| Subscriptions tracker (`SubscriptionsTracker`) | **Ported** (as recurring transactions) | `/api/money/recurring`, `/api/money/recurring/:id`, `/api/money/recurring/post-due` — detected from real imported transactions rather than manually tracked. |
| Take-home / offer / raise / retirement modeling | **Ported** (new, not in NEXUS) | `parts/plan/TakeHome.jsx`, `ModelOffer.jsx`, `Raise.jsx`, `Retirement.jsx` — mmm-app added these; NEXUS's Planning tab didn't have them. |

## Loans (`LOANS_TABS`: calculator, payoff, refi, DTI)

| NEXUS feature | Status | Where it lives now |
|---|---|---|
| Mortgage / loan calculator (`nexus/tools/loans.js`) | **Ported** | Folded into `sections/Debt.jsx` (648 lines) and `/api/money/debt`. Per `docs/superpowers/plans/2026-09-17-phase1-planning-primitives-nav.md`, ported "minus `calcLoanPayoff`" per an explicit ruling (R1) made during that port. |
| Payoff strategy (snowball/avalanche) | **Ported** | `sections/Debt.jsx`; server `/api/money/debt/payoff`. |
| Refinance analysis | **Ported** | `sections/Debt.jsx` (client-side calculator). |
| DTI check | **Ported** | `sections/Debt.jsx` (client-side calculator). |

Net: Loans is the second-most-completely-ported tab, just folded into Debt.jsx
instead of staying a standalone section.

## Analysts (whole tab — AI stock analyst panel)

| NEXUS feature | Status | Why cut |
|---|---|---|
| Analysts tab (`AnalystsTab`, lazy-loaded from `components/analysts/`) | Cut | Entirely AI/Desk — analyst personas, consensus scoring, portfolio-manager synthesis (`server/nexus/analyst-engine.js` via `server/routes/analyze.js`). No LLM contract. |

## Betting (whole tab)

| NEXUS feature | Status | Why cut |
|---|---|---|
| Betting / prediction markets (`BettingTab`, `server/routes/betting.js`, The Odds API) | Cut | Explicitly out of scope for a personal finance app — not a fit for mmm-app regardless of the AI question. |

## AI surface generally

| NEXUS feature | Status | Notes |
|---|---|---|
| "Ask NEXUS" agent chat (`server/routes/nexus.js` → `nexus/agent.js`, Claude/Anthropic-backed) | Cut | No LLM contract yet. |
| Reflection engine (`server/routes/reflection.js`, proxies a Python service) | Cut (mostly) | The historical decisions/closes it recorded were migrated once via `import-nexus.js`; the live reflection *engine* itself was not rebuilt. |
| Chat coach | **Ported, narrower** | `widgets/CoachChat.jsx` → `POST /api/money/coach`. This is a much smaller feature than NEXUS's agent: a single grounded Q&A chat that injects the user's real MMM numbers and rule-based findings into a **local** Ollama model (`qwen2.5:1.5b`) — no cloud API key, no multi-agent debate, and it degrades to "unavailable" with the rule-based insights still shown if Ollama isn't running. Don't read this as "AI/Desk was ported" — it's a narrow, local-only, always-optional feature that happens to also use an LLM. |
| API key management (`server/routes/keys.js`, live-validates Anthropic/Exa keys) | **Ported, narrower** | `server/online/routes.js` (`/keys`, `/test`) — manages the online-fetch feature toggles and `safeStorage`-backed keys, not a live multi-provider key validator. |

## Telegram

| NEXUS feature | Status | Why cut |
|---|---|---|
| Telegram bot (`server/nexus/telegram-bot.js`, wired in `server/index.js`) | Cut | No remote/mobile notification channel exists in mmm-app. Nothing pings Aaron's phone; everything is desktop-app-only for now. |

## Learn

| NEXUS feature | Status | Notes |
|---|---|---|
| (NEXUS has no Learn/curriculum module at all — this is not a NEXUS feature.) | N/A | mmm-app's own `sections/Learn.jsx` is a **new, mmm-native** feature, currently just a glossary search (`GET /api/money/glossary`). The planned M0–M2 curriculum (Orientation, Runway & Survival, Cash Flow) referenced in mmm-app's own planning docs is **deferred**, not cut — it was never part of NEXUS to begin with, so archiving NEXUS doesn't affect it either way. Anything beyond M2 (M3+, FSRS spaced repetition, the tutor) is out of scope for the current build, independent of this sprint. |

## Layout / chrome pieces not covered above

| NEXUS feature | Status | Notes |
|---|---|---|
| Sidebar navigation | Ported (redesigned) | mmm-app's own `MoneyHub.jsx` sidebar, grouped sections — not a visual port, a fresh v3 nav. |
| Onboarding modal | Ported (mmm-native) | `shared/OnboardingModal.jsx` exists in mmm-app independent of NEXUS. |
| Command palette | Ported (mmm-native) | `shared/CommandPalette.jsx`, consumes `MoneyHub.jsx`'s `SECTIONS`. |
| Keyboard shortcuts modal | Ported (mmm-native) | `shared/KeyboardShortcuts.jsx`. |

## Summary of deliberate cuts (per the sprint plan's explicit list)

- **AI/Desk** — War Room, ensemble, analysts, reflection engine, proposals. All gone; no LLM contract exists for mmm-app yet. The only surviving AI-touching feature is the narrow, local-only, optional Ollama chat coach — not a replacement for any of these.
- **Betting / prediction markets** — gone entirely, not a fit for a personal finance app.
- **Media** (news + YouTube) — gone entirely, no replacement planned in this sprint.
- **Telegram** — gone entirely, no remote notification channel exists.
- **Learn beyond M0-M2** — not a cut from NEXUS (NEXUS never had Learn); this is mmm-app's own roadmap note, included here only because the sprint brief asked for it. M0-M2 (Orientation, Runway & Survival, Cash Flow) is a *deferred* build target, not built yet even at that reduced scope.

## Deferred (not cut, just not built yet)

- **Roadmap / milestone timeline view** (NEXUS's `RoadmapView`) — no mmm-app equivalent.
- **Snapshot-based planning UI** (NEXUS's `SnapshotEditor`) — deliberately replaced by ledger-grounded Goals/Plan sections, but if Aaron ever wants a lightweight "just let me punch in hypothetical numbers" mode independent of imported data, that doesn't exist today.
- **Learn M0-M2 curriculum** (mmm-native, not from NEXUS).

## Verification checklist

Static checks below were verified by reading source directly (this pass, no
`build:portable`, no `npm start`, no execution of `archive-nexus.sh`). Items
marked "controller pass" require someone running the packaged exe.

- [x] **Static** — Confirmed via `grep -rn "nexus-app"` across `scripts/`, `server/`, `src/`, `electron.js`, `vite.config.*`, `package.json` that the only runtime (non-comment, non-doc) reference to a path under `nexus-app` is `DEFAULT_NEXUS_DIR` in `server/trading/import-nexus.js:14`.
- [x] **Static** — `server/trading/import-nexus.js` now returns `{ sourceMissing: true, message, counts: <all zero> }` instead of silently reporting a false "successful, zero rows" result when `dataDir` doesn't exist (fixed this sprint; see commit). Confirmed the existing test suite (`tests/import-nexus.test.mjs`) exercises only explicit fixture `dataDir` paths that exist, so this change doesn't alter any tested behavior — `npm test` still passes 415/28.
- [x] **Static** — `POST /api/trading/import-nexus` (`server/trading/routes.js:135-139`) forwards `runNexusImport()`'s return value verbatim via `res.json(...)`, and `Settings.jsx`'s `importNexus()` (`src/components/money/sections/Settings.jsx:298-316`) now checks `out.sourceMissing` before reading `out.counts`, showing the error message via `toast.error` and the red `nexusMsg` state instead of the "Nothing new to import" success path. This required a one-line change to that file (fixed this sprint; previously the button read only `out.counts`, which is all-zero on `sourceMissing` and rendered as a false "up to date" success).
- [x] **Static** — Confirmed the exact desktop shortcut filename `archive-nexus.sh` must delete: `C:\Users\aaron\Desktop\NEXUS.lnk` exists today (confirmed via directory listing), matches `productName: "NEXUS"` in `nexus-app/package.json`'s electron-builder/NSIS config.
- [x] **Static** — Confirmed `nexus-app` is plain working-tree content in the umbrella repo at `C:\Users\aaron\projects` (no nested `.git`), with only `journal.json`, `snapshot.json`, `watchlist.json` tracked by git under `server/store/` — `reflection.db` and any `portfolio.json` are untracked and would have **no** git-history safety net, which is why `archive-nexus.sh` copies-and-verifies before deleting rather than relying on git to recover a bad move.
- [ ] **Controller pass** — Launch the packaged mmm-app exe and confirm: Desk/Media nav entries are gone from the sidebar and command palette (not just removed from source); the app icon, taskbar icon, and splash screen show the updated teal/mint identity; Settings → "Import NEXUS data" button still works pointed at the *current* (not-yet-archived) `nexus-app` path.
- [ ] **Controller pass** — After Aaron runs `scripts/archive-nexus.sh` himself (not part of this sprint): confirm the app still launches cleanly, and click "Import NEXUS data" once to confirm the button now surfaces the red `sourceMissing` message (via the `Settings.jsx` check added this sprint) instead of the green "already up to date" success or a silent zero-count report (this exercises the archived-path failure branch that cannot be exercised safely from this sandbox, since it requires either running the destructive script or pointing a live import call at a real missing directory outside test fixtures).
- [ ] **Controller pass** — Confirm `NEXUS.lnk` is gone from the Desktop after running the archive script, and that `MMMoney.lnk` (mmm-app's own shortcut) is untouched.
