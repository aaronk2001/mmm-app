# Sprint A — Online seam + Markets + Paper ledger

**Spec:** `~/.claude/plans/lets-make-a-plan-floating-pine.md` §5a (sprint table), §4.2/4.3/4.4, §3, §7, §9.
Absorbs the old Phases 2 and 3 under the Sep 18 five-sprint revision. Branch `v3/sprint-a` off master
`8428a8f` (Phase 1 merged, 203 tests / 18 files).

**Goal:** opt-in online data with keys in `safeStorage`, a Markets section, and a real SQLite paper-trading
ledger with the strategy gate and Aaron's NEXUS trades imported.

## Global constraints — these bind every track

- npm + Node CommonJS server / ESM client. React 18 **JSX not TSX**. No TypeScript, no Bun, no bundler change.
- **Money is integer cents at rest.** `repo.readAll` converts to dollars for consumers; `server/tools/*` and
  `runway.js` are dollars-in/dollars-out. Paper trades store cents.
- **Every new table round-trips through `repo.readAll`/`writeAll`** so export/import/backup stay complete, and
  is declared in `schema.sql`. Back up before any migration; never a destructive one.
- **Paper-only trading forever.** No brokerage SDK, no live-order path, nothing auto-opens.
- **Any new SERVER dependency goes into `SERVER_DEPS` in `scripts/build-portable.mjs` IN THE SAME COMMIT.**
  Track 2 adds `yahoo-finance2`. Miss this and the packaged exe crashes at runtime with a green build and a
  green test suite. A *client* dependency (bundled by Vite) does not go in `SERVER_DEPS`.
- **Keys live only in `safeStorage`** — never localStorage, never `.env`, never SQLite.
- Online is **opt-in and off by default**. Zero keys means every money feature still works. Disabled or failed
  fetch → cached data plus an "offline · updated N ago" chip, **never an error**.
- Every figure carries an evidence grade. No hardcoded hex — semantic `var(--m-*)`/`var(--chart-N)` only.
  No `cursor: pointer` on cards. Numbers `tabular-nums`. Colour always paired with a sign or icon.
- Dates compare as local `YYYY-MM-DD` strings. No UTC parsing.
- `git commit -F -` with a heredoc (the hook rejects `-m` with one). Never stage `.omc/`, `build/`,
  `src/dist/`, `.superpowers/`, `.playwright-cli/`, or anything under `server/store/money/`.
- **Never run an ad-hoc `node` script that requires `server/money/store.js` or `server/db/connection.js`.**
  `connection.js:14` is `DATA_DIR = process.env.MMM_DATA_DIR || ASSET_DIR`, so a bare `node -e` writes the real
  dev database — that already destroyed it once in Phase 1. Use `npx vitest run <file>`, or
  `MMM_DATA_DIR=$(mktemp -d) node -e '...'`.
- **Never run two builds at once.** `npm run build` and `npm run build:portable` fight over `src/dist` and
  `build/MMM-portable`; the loser dies with `EPERM ... syscall: 'rm'`.
- **TDD is mandatory for money math and the strategy gate only.** Everything else gates on build + contrast +
  packaged smoke + a controller-driven in-app pass.

## Wave structure

Wave 1 runs Tracks 1 and 3 in parallel — strictly disjoint file sets. Wave 2 runs Track 2, which consumes
Track 1's fetch envelope.

---

## Track 1 — online seam + keys

**Files:** `server/online/index.js`, `server/online/keys.js`, `server/online/routes.js`, `electron.js`,
`preload.js`, `server/db/schema.sql` (+`http_cache`), `server/db/repo.js` (round-trip), `server/index.js`
(mount), `src/components/money/sections/parts/settings/OnlinePanel.jsx`,
`src/components/money/sections/Settings.jsx`, `tests/online.test.mjs`.

- `online.enabled(feature)` reads `settings.online = { market, news, youtube, predictionMarkets, sportsOdds,
  telegram, cloudLlm }`, **all false by default**.
- `online.fetch(url, { ttl, cacheKey })` — the five-knob envelope: timeout, retries, backoff, error cooldown,
  a **separate** rate-limit cooldown, and max parallel 3. Backed by an `http_cache` table. Every caller gets
  `{ data, cached_at, stale, offline }`. An expected failure never throws.
- `keys.js`: `safeStorage` via IPC (`secrets:get` / `secrets:set` in `electron.js` + `preload.js`) writing
  `%APPDATA%\mmm\keys.enc`; the decrypted map reaches the server over the existing `fork()` message channel and
  lives in memory only. Dev fallback `secrets.dev.json` with a loud warning.
- Settings → **Online & Keys**: per-feature toggles, key fields, and a "Test" button wired to **real server
  state**. NEXUS's version read localStorage and reported success while the server had nothing — do not
  reproduce that bug.
- Tests: TTL hit/miss, error cooldown, rate-limit cooldown is genuinely separate from the error cooldown, the
  offline envelope shape, and a key round-trip that survives a restart and is unreadable on disk.

---

## Track 2 — market providers + Markets section (Wave 2)

**Files:** `server/market/{providers,snapshots,routes}.js`, `server/jobs.js`,
`src/components/money/sections/Markets.jsx` + `parts/markets/*`, `Investments.jsx`, `MoneyHub.jsx`
(drop `markets` from `soon` and add its `IMPORTERS` entry), `scripts/build-portable.mjs`
(**`SERVER_DEPS += 'yahoo-finance2'`**), `schema.sql` (+`price_cache`, `watchlist`, `alert_rules`),
`tests/market.test.mjs`.

- Providers: `yahoo` (quote / chart / indices / futures / earnings / predefined screener), `fred` (real,
  optional key), `coingecko`, `frankfurter`. **Marketaux, Exa, Financial Datasets, Finnhub, Alpha Vantage and
  `ytsr` are cut.** The custom screener is cut — predefined screens only.
- `snapshots.js` on an interval in `server/jobs.js` (opt-in, 30 min, market hours). **The UI reads snapshots and
  never triggers a fetch**, except an explicit Refresh.
- Markets sub-tabs as **nested routes** (`/markets/:tab`; the `/:section/*` pattern already exists from
  Phase 1): chart, screener, macro, sectors, futures, crypto, forex, watchlist. The chart uses
  `lightweight-charts` — a **client** dependency, so `SERVER_DEPS` is unaffected by it.
- Investments gains "Refresh prices" (`price_source='yahoo'`; manual stays the default).
- `build-portable.mjs` step 4 gains an assertion that every `require()` under `server/` resolves inside the
  packaged payload — the structural guard against the `SERVER_DEPS` trap.
- **With market off, every tile shows cached/offline and no request fires.** Test that explicitly.

---

## Track 3 — paper ledger + strategy gate + NEXUS import

**Files:** `server/trading/{paper-store,strategy-gate,config,routes}.js`, `schema.sql` (+`paper_account`,
`paper_positions`, `paper_trades`, `paper_journal`, `agent_events`, `import_log`), `repo.js`,
`server/index.js`, `src/components/money/sections/Trades.jsx` + `parts/trades/*`, `MoneyHub.jsx` (drop
`trades` from `soon`), `scripts/import-nexus.mjs`, `tests/paper-store.test.mjs`,
`tests/strategy-gate.test.mjs`, `tests/import-nexus.test.mjs`.

- `paper-store.js`: `getAccount` / `listPositions` / `open` / `close` / `reset` over the `paper_*` tables,
  **all writes inside `db().transaction()`**. Slippage 0.1% and $1 commission applied exactly. Stops persisted
  in `paper_positions.stop_price`. **No `:5003` fetch and no `router.openPosition` hack** — both are NEXUS
  artefacts; do not port them.
- `agent_events` replaces `journal.jsonl`; `tradesThisWeek()` and `sectorFailures()` are indexed SQL.
- `strategy-gate.js` ported **verbatim**, with its five magic constants plus the `>=2` and `2×` thresholds
  lifted into `config.js` reading `settings.trading.gate`. **`tests/strategy-gate.test.mjs` needs ≥15 cases.**
  This is one of the two places TDD is still mandatory.
- Trades section, nested routes `/trades/:tab` = open | closed | journal. Port `PaperTrading.jsx`,
  `RiskCalculator.jsx`, and `PortfolioSummary`'s donut over real holdings plus paper positions. Keep the
  "Lesson learned" field. **The Backtest tab is Sprint B** — leave a placeholder tab.
- `scripts/import-nexus.mjs` plus a Settings button, reading from
  `C:\Users\aaron\projects\Finance agent\nexus-app\server\store\`:
  `journal.json` → `paper_trades` (`source='nexus'`, `source_id`); `watchlist.json` → `watchlist`;
  `snapshot.json` → `settings.profile` **only if it is empty**; `reflection.db` → `decisions` / `closes`.
  `import_log` makes a re-run a no-op. Support `--dry-run`, printing a diff.
- **Not ported:** `reconcile.js` (its `exitFill()` returns 0), `loop.js`, and the `journal.js` markdown logs.

---

## Verification

Per track: `npm test` up from 203, `npm run build` exit 0, `npm run check:contrast` green.

Sprint gate (controller-run): full suite, `npm run build:portable` smoke, packaged-exe in-app pass, one
whole-sprint review, merge to master.

Track-specific must-pass:
- **T1** — key round-trip survives a restart and is unreadable on disk; with market off, zero requests fire.
- **T2** — packaged smoke hits `/api/market/quote/SPY` **only when enabled**.
- **T3** — open/close round trip exact to the cent; two concurrent closes produce exactly one 409; the import
  run twice produces identical counts.
