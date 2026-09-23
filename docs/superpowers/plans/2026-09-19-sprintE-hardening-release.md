# Sprint E — Hardening & release

**Spec:** `~/.claude/plans/lets-make-a-plan-floating-pine.md` §5a (sprint table), the Phase 11 section, §3, §7.
The final sprint. Branch `v3/sprint-e` off master `a8d8e81` (Sprint D merged, **555 tests / 37 files**).

**Goal:** make this safe to rely on daily, and leave it in a state a fresh session — or Aaron in six months —
can pick up cold.

## Global constraints

- npm + CommonJS server / ESM client. React 18 **JSX not TSX**. No TypeScript, no Bun, **no new runtime
  dependency**. A dev-only dependency (e.g. a test harness) needs an explicit justification in the report and
  must not reach `SERVER_DEPS`.
- Money is integer cents at rest. Dates are local `YYYY-MM-DD` — the `ts-fsrs` ISO-instant exception is
  correctly scoped and must not widen.
- Paper-only trading. Online off by default; zero keys means every money feature still works.
- **Do not weaken any existing test.** 555 is the floor.
- `git commit -F -` with a heredoc. Never `git add -A`. Never stage `.omc/`, `build/`, `src/dist/`,
  `.superpowers/`, `.playwright-cli/`, or anything under `server/store/money/`.
- **Never `npm run build:portable`**, never `npm start`, never two builds at once. The controller packages.
- **Never a bare `node -e` that requires `server/money/store.js` or `server/db/connection.js`.**

---

## Track 1 — the data-dir footgun, and security

**This is the sprint's headline item and it is overdue.**

`server/db/connection.js:14` is:
```js
const DATA_DIR = process.env.MMM_DATA_DIR || ASSET_DIR;
```
Any script that loads the store without setting `MMM_DATA_DIR` silently writes the **real in-repo dev
database**. It destroyed that database once during Phase 1 and has been carried as known debt through five
sprints; every agent brief since has had to warn about it in prose. Fix it in code.

Requirements, in order of importance:
1. **The packaged app must keep working unchanged** — it passes `MMM_DATA_DIR` explicitly.
2. **`npm run dev` / `npm start` must keep working**, using the in-repo dev DB as they do today.
3. **An ad-hoc `node -e` or a stray script must not silently write a real database.** Make the dev-dir
   fallback deliberate rather than implicit — an explicit opt-in env var, or a guard that refuses when the
   process looks like an ad-hoc script rather than the app. **Read how `server/index.js`, `electron.js` and
   `tests/setup.mjs` each establish the data dir before choosing a mechanism**, and do not break any of them.
4. Whatever you choose, **prove it**: a test that a store require without the opt-in does not touch the dev DB.

Then a security pass over the whole app:
- `server/online/keys.js`, `electron.js`, `preload.js` — keys only via `safeStorage`; nothing in a log line, an
  error message or a response body; `keys.enc` out of `repo.readAll`/`writeAll`. A previous review found a
  FRED key leaking through a **cached URL** into `http_cache` and thus into every export and backup — verify
  that fix holds and look for any sibling path.
- Electron: `contextIsolation`, `sandbox`, `nodeIntegration: false`, CSP, and **add the `will-navigate` lock**
  that §7 calls for and that a prior review noted is still missing.
- The IPC surface: validate `secrets:set`'s provider against a known list and cap value length.
- Rate limits and the request-timeout exemption list still correct for the routes that now exist.

## Track 2 — performance, E2E, and the release

- **Perf budgets.** Cash Flow already fires several requests; Markets, Trades and Learn added more. Measure
  before changing anything, then fix what is actually slow: the read limiter for `/api/money/*`, pagination
  where a list can grow unbounded, and memoized aggregations. **Report measurements, not impressions.**
- **E2E smoke against the packaged exe.** Playwright is **not** currently a dependency — adding it is dev-only
  and needs justification in your report; if you judge it not worth it, write a scripted manual checklist
  instead and say why. Either way the deliverable is: a repeatable way to confirm the app boots, the seven
  sections load, and a lesson, a backtest and a paper trade each complete.
- **Backups.** Verify the existing scheduler still round-trips every table added across Sprints A–D
  (`http_cache`, `paper_*`, `agent_events`, `import_log`, `price_bars`, `strategies`, `backtest_runs`,
  `learn_*`). A backup that silently omits a table is worse than none. **Restore into a temp dir and diff.**
- **Docs.** `README.md` for a cold start: what it is, how to run it, where data lives, what's opt-in, what's
  cut. `THIRD_PARTY_NOTICES.md` for `ts-fsrs`, `yahoo-finance2`, `lightweight-charts`, `papaparse`, `recharts`
  and the CC BY / CC BY-SA content sources in `content/learn/sources.yaml`.

## Verification

`npm test` ≥ **555 / 37**, `npm run build` exit 0, `npm run check:contrast` green,
`npm run check:learn-content` green. Sprint gate (controller): full suite, packaged smoke, an in-app pass,
one review, merge, and the memory/ledger update that lets a fresh session resume cold.
