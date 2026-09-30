# Contributing to MMM

Thanks for your interest. MMM is a small, opinionated codebase; the notes below
keep changes consistent with the invariants the rest of the app relies on.

## Setup

```bash
git clone https://github.com/aaronk2001/mmm-app.git
cd mmm-app
npm install
npm run dev        # Vite on :5173 + Electron, hot reload
```

Node 20+ is required. `better-sqlite3` ships prebuilt binaries for common
platforms; if `npm install` falls back to compiling, you need a C++ toolchain.

## Before opening a pull request

All four gates run in CI and must pass:

```bash
npm test                    # vitest — ~700 tests
npm run check:contrast      # WCAG contrast over the theme tokens
npm run check:learn-content # lesson front matter, answers, and sources
npm run build               # the SPA must compile
```

## House rules

These are load-bearing. Each exists because breaking it caused a real bug.

- **Money is integer cents** in the database, converted to dollars only at the
  repository boundary (`server/db/repo.js`). Never store or sum floats.
- **Balances are derived**, never written. Change the opening balance or the
  transactions; the balance follows.
- **Dates are local `YYYY-MM-DD` strings**, compared as strings. Never
  `new Date('YYYY-MM-DD')` — it parses as UTC midnight and shifts the day west
  of Greenwich. Use `src/lib/localDate.js` / `server/money/calc.js` helpers.
- **Numbers come from code, not models.** The optional local LLM coach may only
  phrase findings produced by the deterministic rule engine; it never computes.
- **Online features stay opt-in.** Any new outbound request goes through
  `server/online/` behind a feature key that defaults to off, and needs a test
  proving zero sockets when disabled.
- **No hardcoded colours** in components — use the `--m-*` tokens from
  `src/styles/theme.css`, so both themes and the contrast gate keep working.
- **Test money math first.** Anything in `server/money/`, `server/backtest/`,
  `server/betting/odds.js`, or `server/tools/` gets a unit test with
  hand-computed expected values.

The design rationale behind these rules is in [`docs/design/`](docs/design/).

## Commits and pull requests

- [Conventional Commits](https://www.conventionalcommits.org/):
  `feat(budget): …`, `fix(markets): …`, `docs: …`.
- Explain *why* in the body when the change isn't obvious.
- Keep pull requests focused; one concern each.
- UI changes: include a before/after screenshot (sample data only — never
  real financial data).

## Reporting bugs

Open an issue using the bug template. For anything security-related, follow
[SECURITY.md](SECURITY.md) instead.
