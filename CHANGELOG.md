# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/). Pre-1.0 milestones are summarized from the commit history.

## [1.0.0] — 2026-10-06

First public release.

### Added
- Research section (INVEST): Linda, a grounded research agent. Five tools (quote, annual
  financials, key metrics, company news, web search) over Yahoo, Finnhub, Exa and optional
  Financial Datasets; at most 6 tool calls in 60 s; every figure cited to its tool result;
  a deterministic check flags figures no tool returned. Local Ollama by default; Claude and
  OpenAI-compatible endpoints are opt-in, picked per question, never an automatic fallback.
- Online feature keys `finnhub`, `exa`, `financialDatasets`, `openaiCompat` (all off by
  default); `cloudLlm` now has a consumer. Settings → Online & Keys shows a free option for
  every key.
- `online.fetch(..., { store: false })` for responses that must never reach `http_cache`.

- MIT licence, contributing guide, security policy, code of conduct, issue and PR templates.
- GitHub Actions CI on Ubuntu and Windows: tests, contrast gate, lesson validation, SPA build.
- Technical design docs in `docs/design/`: ledger, quant, decision support, privacy & security.
- Loopback guard (`server/local-guard.js`): rejects non-loopback `Host` headers (DNS rebinding)
  and cross-site writes, so a web page can no longer blind-fire a no-body `POST` such as
  `/api/money/reset` at the local server.

- `npm run screenshots`: regenerates the README images from sample data via Electron offscreen rendering.
- Monthly Dependabot updates for npm and GitHub Actions.

### Changed
- Electron 30.5.1 (end-of-life) → 42.11.11; better-sqlite3 uses the Electron 42 prebuild.

### Removed
- One-time importer for a private predecessor app (route, Settings button, CLI, tests).
- Internal planning notes and machine-specific helper scripts.
- Unused `electron-builder` dev dependency (packaging uses `scripts/build-portable.mjs`);
  clears a critical `tar` advisory.
- Settings toggles for `youtube`, `telegram`, `cloudLlm`: reserved keys with no consumer.

### Fixed
- Markets earnings and screener always served cache: yahoo-finance2 v4 must be instantiated,
  and the static call threw.
- Section headers: the icon wrapper matched a `flex: 1` rule, splitting the row 50/50 and
  stranding the icon mid-page on six sections.
- Negative amounts render as `-$38.50`, not `$-38.50`; thousands separator in budget overage.
- Portable build: dependencies of nested packages are now followed, so `safer-buffer` is no
  longer dropped from the payload (the packaged server failed to boot after a lockfile change).
- Semver-compatible security updates (express, body-parser, qs, react-router, postcss, nanoid).
- Test timeout raised to 30 s; the esbuild parse check flaked at the 5 s default under load.

## Pre-release milestones

### v4: Betting, Intelligence, Markets enrichment (2026-09-23)
- Read-only prediction-market (Polymarket, Kalshi, Manifold) and sportsbook board with n-way
  de-vigging and arbitrage sized to a matched payout.
- Fixed while porting: return-on-stake `1/Σp − 1` instead of margin; Kalshi prices are cents;
  three-way (soccer) markets no longer scored as two-way arbitrage.
- Market news; Markets chart that had never rendered now draws.

### v3: Merge, Markets, Backtester, Learn, Hardening (2026-09-16 → 09-23)
- Planning primitives: take-home, model an offer, raises, Roth/FIRE; grouped navigation, Ctrl+K palette.
- Online seam: opt-in feature flags, cached fetch envelope, `safeStorage` keys.
- Markets (8 tabs) and paper trading behind a strategy gate.
- Deterministic backtester with look-ahead guard and 15 metrics.
- Learn: 15 lessons, personalized variables, FSRS review.
- "Precision instrument" visual identity, bundled fonts, WCAG contrast gate.
- Hardening: data-dir guard, local-calendar date fixes across the app, navigation lock.

### v2: Coach (2026-07-07)
- Deterministic advice engine, Insights widget, weekly digest, grounded local-LLM chat.

### v1: Overhaul (2026-06-29 → 07-06)
- SQLite with integer cents and derived balances; automatic backups.
- Drag-and-drop dashboard, themes, custom fields, formula metrics, rules.
- OFX/QIF import, multi-currency, investments, reports, tray and launch-on-boot.

[1.0.0]: https://github.com/aaronk2001/mmm-app/releases/tag/v1.0.0
