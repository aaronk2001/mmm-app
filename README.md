# MMM — Making Money Moves

A standalone, **local-first** personal-finance desktop app. Electron shell → a
local Express server on `:5006` → a React SPA, with all data in a local SQLite
database. No cloud, no accounts, no telemetry.

## Run it

```bash
npm install
npm run dev            # Vite (5173) + Electron, hot reload
npm test               # money-math unit tests (vitest)
npm run build          # build the SPA to src/dist
npm run build:portable # hand-assemble build/MMM-portable/MMM.exe (see below)
```

The desktop shortcut is created by `make-mmm-shortcut.ps1` (run it from a normal
shell — it points a `MMM.lnk` on your Desktop at the portable exe with the app
icon).

## Where your data lives

- **Packaged app:** `%APPDATA%\mmm\` — `mmm.db` (SQLite) plus `backups\`.
  Rebuilding or replacing the exe never touches it.
- **Dev:** `server/store/money/` in the repo.

MMM snapshots your data automatically every day (JSON + a live SQLite copy,
30-day retention) and lets you back up / restore on demand from **Settings →
Desktop / Privacy & Data**. It also imports a legacy `data.json` and migrates
older database versions in place on first run.

## Sections

- **Overview** — customizable widget dashboard (drag/resize, presets, custom
  metrics). `Ctrl+N` opens a keyboard-first quick-add from anywhere.
- **Accounts & Net Worth** — accounts by type, net-worth trend (90d/1y/All).
- **Transactions** — full ledger with inline edit, search, multi-select bulk
  ops, CSV/OFX/QIF import, and CSV export of the current view.
- **Budget** — monthly envelopes with rollover and drill-down to spending.
- **Cash Flow** — 90-day projection, scenario sliders, recurring income/bills.
- **Goals** — savings goals with account linking, projected completion, pace.
- **Debt Payoff** — avalanche/snowball with interest-saved deltas + calculators.
- **Investments** — holdings, allocation, inline price updates, gain/loss.
- **Reports** — spending / income-vs-expense / net-worth with custom ranges.
- **Settings** — theme + teal accent, currency, rules, custom fields, backups,
  launch-on-startup, and close-to-tray.

## Architecture

- **Frontend:** React 18 + Vite 5, React Router (HashRouter), React Query,
  Tailwind v4 with a semantic token system (`src/styles/theme.css` drives the
  teal-on-charcoal identity; every component reads `--m-*` tokens).
- **Backend:** Express on `127.0.0.1:5006`, helmet + CORS-to-localhost + rate
  limits. Per-row SQLite via `better-sqlite3`; **money is stored as integer
  cents** and account balances are **derived** (opening balance + Σ
  transactions), so there is no float drift and no balance-mutation bugs.
  Hand-rolled request validators guard every write.
- **Shell:** Electron 30 — hardened (`contextIsolation`, `sandbox`, tight CSP),
  forks the server, shows an instant splash, and offers a tray + launch-on-boot.
- **Money math** lives in `server/money/calc.js` (pure, unit-tested); file
  parsing in `server/money/parsers.js` (papaparse CSV, OFX, QIF).

## Packaging

`electron-builder` is blocked on this machine (winCodeSign symlink), so
`scripts/build-portable.mjs` hand-assembles the portable app:

1. `vite build`
2. copy the Electron runtime, rename `electron.exe` → `MMM.exe`
3. inject the app + a **dependency-closure** copy of only the server's runtime
   packages (a full `node_modules` copy times out on the AV-scanned path)
4. swap in the **Electron-ABI** `better-sqlite3` binary via `prebuild-install`
5. stamp the exe icon (`rcedit`, best-effort) and smoke-test the packaged server

The result is `build/MMM-portable/MMM.exe` — no installer required.

## Tech notes

- Bun is not used here — this app is npm + JS/JSX by design.
- Dates are compared as `YYYY-MM-DD` strings on the local calendar throughout
  (never `new Date(isoDate)`), which avoids UTC-vs-local day-shift bugs.
