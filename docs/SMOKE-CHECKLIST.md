# MMM Packaged-Exe Smoke Checklist

## Why a checklist instead of Playwright

MMM is a single-user local app. Electron's Playwright support is still
experimental, and pulling in a new devDependency plus a browser download is
ongoing maintenance for something exactly one person runs. A scripted manual
pass over the packaged exe takes about 10 minutes and exercises the same
paths a real regression would break. Run this checklist before shipping a
build, especially one touching dates, Learn, trading, or the online seam.

Each step has an explicit expected result and a checkbox. Run them in order
against the **packaged** `MMM.exe`, not `npm run dev`.

---

### 1. Pre-flight build

- [ ] Close any running `MMM.exe` (Task Manager or `taskkill /IM MMM.exe /F`).
- [ ] `npm test` — vitest suite passes.
- [ ] `npm run build` — builds the SPA to `src/dist`.
- [ ] **Not concurrently with the above:** `npm run build:portable` — this
      re-runs `vite build` itself, then assembles `build/MMM-portable/`.
      Ends with its own smoke test and prints `SMOKE PASS — portable ready:
      build/MMM-portable/MMM.exe`.
- [ ] Launch `build/MMM-portable/MMM.exe` (exe name and output path are set in
      `scripts/build-portable.mjs`: `OUT = build/MMM-portable`, `electron.exe`
      is renamed to `MMM.exe`).

**Expected:** all three commands exit 0; `MMM.exe` exists at that path and
launches.

### 2. Boot

- [ ] Launch `MMM.exe` and watch the window from cold start.
- [ ] If `%APPDATA%\mmm\mmm.db` already has data (accounts/transactions from a
      prior run), confirm it loads — open **Accounts & Net Worth** and
      **Transactions** and confirm the existing rows are present.

**Expected:** an instant teal-on-charcoal splash (`MMM` wordmark + spinner,
`electron.js`'s `SPLASH_URL`) appears immediately — never a blank/black
window — then swaps to the real app once `/api/health` answers. Existing
accounts and transactions are visible, not an empty seeded state.

### 3. Visit every section

Click through all 14 nav entries (`SECTIONS` in
`src/components/money/MoneyHub.jsx`): Overview, Accounts & Net Worth,
Transactions, Budget, Cash Flow, Goals, Debt Payoff, Investments, Reports,
Plan, Markets, Trades, Learn, Settings & Privacy.

- [ ] Each section renders content (or an explicit empty state like "No
      lessons available yet" / "No open positions") — no error toast, no
      blank panel, no unhandled white screen.

**Expected:** 14/14 sections render cleanly.

### 4. Date regression check (today shows as today)

This guards a UTC-parse bug fixed this sprint: `new Date('YYYY-MM-DD')`
parses as UTC midnight, which is the previous evening west of UTC, so a
same-day transaction rendered one day early. `TransactionsTable.jsx` now uses
`parseYmd` from `src/lib/localDate.js` instead.

- [ ] Go to **Transactions**, click **Add Transaction**, leave the date field
      at its default (today) or explicitly set it to today's date, save it.
- [ ] Confirm the row's displayed date in the transactions table matches
      today's actual calendar date, not yesterday.

**Expected:** the transaction shows today's date.

### 5. Learn — complete a module M0 lesson

- [ ] Open **Learn** (defaults to the **Lessons** tab). Under module **M0**,
      open the lesson **"What This App Is"** (`m0-what-is-this-app`).
- [ ] Step through it with **Continue**: it runs through read/worked/faded
      prose steps, then a **"Check your understanding"** step — pick an
      answer choice; it grades and shows **Continue** to proceed.
- [ ] Next is an **"Apply it"** step (action: **Export a backup**) — either
      press **Confirm** to actually take a backup snapshot (harmless — it
      only writes a new file under `<DATA_DIR>/backups`) or **Skip this for
      now**.
- [ ] Reach the **"Lesson complete"** end screen.
- [ ] Go back to **Lessons** (button: **Back to lessons**) — the lesson's
      status badge should now read **Completed** (or **Mastered** if it also
      passed a mastery gate).
- [ ] Fully quit and relaunch `MMM.exe`, return to **Learn**.

**Expected:** the lesson still shows **Completed**/**Mastered** — progress
persisted across restart (it's written to SQLite via
`POST /api/learn/lessons/:id/check` / `/apply`, not client state).

### 6. Backtest

- [ ] Go to **Trades → Backtest**.
- [ ] The default form has strategy **Buy & Hold**, symbol **AAPL**. A fresh
      packaged app ships with **no bundled price bars**, so first load a bars
      file: under **Offline CSV upload**, pick a symbol (e.g. `AAPL`) and use
      **Upload CSV (date,open,high,low,close[,volume])** to load a small CSV
      you provide. (Works fully offline — no API key required, per the note
      under the form. Bars can alternatively be synced from Yahoo if the
      `market` online feature is enabled in Settings → Online & Keys.)
- [ ] Click **Run backtest**.

**Expected:** result metrics render (Final equity, CAGR, Sharpe, Max
drawdown, Win rate, Total costs) plus the equity/drawdown/monthly-return
charts. If no bars were loaded for the requested symbol/date range, you'll
instead see the "No overlapping price data…" empty state — that's the
expected failure mode, not a crash; load bars first.

### 7. Paper trade — open and close

- [ ] Go to **Trades → Open**, click **Open Position**, fill in Symbol, Last
      price, and Conviction (required), click **Open Position** to submit.
- [ ] Confirm the new position appears in the open-positions table.
- [ ] Click **Close** on that row, enter an **Exit price**, submit **Close
      Position**.

**Expected:** the position disappears from **Open** and appears under
**Trades → Closed** (equity curve + trade list) and **Trades → Journal**.

### 8. Settings → Online & Keys — save, persist, never re-displayed

- [ ] Go to **Settings & Privacy**, find the **Online & Keys** card.
- [ ] Turn on any feature toggle (e.g. **Market data**), type a throwaway
      value into its key field, click **Save key**. Confirm the status dot
      flips to **Key saved**.
- [ ] Quit `MMM.exe` completely and relaunch it. Return to **Online & Keys**.

**Expected:**
- After relaunch, the feature still shows **Key saved** (presence is read
  fresh from Electron's `safeStorage`-encrypted `keys.enc` via the
  `secrets:get` IPC call, not cached client state).
- At no point does the saved key **value** appear anywhere in the UI: the
  input is `type="password"`, is cleared to empty immediately after **Save
  key** fires, and the app only ever exposes presence booleans
  (`secrets:get` in `electron.js` strips values down to `!!map[k]`) — there
  is no "reveal key" control anywhere.

### 9. External links open in the OS browser

**Caveat:** as of this sprint, a code search of `src/` for `href="http`,
`target="_blank"`, and `window.open` found **no external link currently
rendered anywhere in the UI** — `content/learn/sources.yaml` carries a
`url` per source and the lesson API returns `source_id`/`license_note`, but
no Learn component renders that URL as a clickable link today. Treat this
step as **not currently exercisable** until a real external link ships;
don't fabricate one to test against.

What **is** verified by code: `electron.js` denies same-window navigation
unconditionally (`will-navigate` → `event.preventDefault()`) and routes any
`window.open`/new-window request to the OS browser instead of a new Electron
window (`setWindowOpenHandler` → `shell.openExternal(url)` + `{ action:
'deny' }`). Once a real external link exists (e.g. a future Learn citation),
re-run this step as:
- [ ] Click the external link.
- [ ] Confirm it opens in the default OS browser, and the MMM window's
      content does not navigate away.

### 10. Market refresh isn't cut off by the request timeout

- [ ] In Settings → Online & Keys, turn on **Market data**.
- [ ] Go to **Markets → Watchlist**, add at least 2 symbols.
- [ ] Click **Refresh now**.

**Expected:** the refresh completes (toast: `Refreshed N price(s)`, or a
`reason` toast on a soft failure) rather than hanging or hitting the generic
30-second request timeout — `/api/market/refresh` is in `TIMEOUT_EXEMPT` in
`server/index.js` specifically because a multi-symbol refresh can legitimately
run past 30s.

### 11. Packaged server env has no dev-DB opt-in

`MMM_ALLOW_DEV_DB` must never be set in the packaged app's server process —
if it were, a packaged build could silently fall back to (or clobber) the
in-repo dev database instead of `%APPDATA%\mmm`.

There's no reliable way to read another process's environment block from
PowerShell — `Get-CimInstance Win32_Process` does not expose it. Two real
options:

- **Preferred — verified by code reading:** `electron.js`'s
  `startServer()` only takes the `app.isPackaged` branch in a packaged
  build, and that branch sets `MMM_DATA_DIR` and nothing else; the
  `MMM_ALLOW_DEV_DB` assignment lives exclusively in the `else` (dev)
  branch. So a packaged build's forked server process can only ever see
  `MMM_ALLOW_DEV_DB` if it was already present in the *parent* Explorer/shell
  environment before `MMM.exe` was launched — check that by launching
  `MMM.exe` from a shell where `echo %MMM_ALLOW_DEV_DB%` / `echo
  $env:MMM_ALLOW_DEV_DB` prints nothing.
- **Runtime cross-check:** open the running `MMM.exe` process in **Sysinternals
  Process Explorer** (`procexp.exe`), find the forked Node child process,
  double-click it → **Environment** tab, and confirm `MMM_ALLOW_DEV_DB` is
  absent and `MMM_DATA_DIR` points at `%APPDATA%\mmm`.

- [ ] Confirm one of the two methods above shows no `MMM_ALLOW_DEV_DB`.

### 12. Clean quit, no orphaned processes

- [ ] Quit MMM from the tray menu (**Quit**) or by closing the window with
      close-to-tray off.
- [ ] Open Task Manager / `tasklist | findstr /I mmm`.

**Expected:** zero `MMM.exe` processes remain. Note the forked server is
launched via Electron's `child_process.fork` (`startServer()` in
`electron.js`), which under Electron runs as another `MMM.exe`/`electron.exe`
process (via `ELECTRON_RUN_AS_NODE`), not a plain `node.exe` — so check for a
second lingering `MMM.exe`, not `node.exe`. `electron.js`'s `before-quit`
handler kills `serverProcess` explicitly before the app exits, so both should
disappear together.
