# NEXUS Money — Monarch-level Personal Finance Hub (Plan)

**Date:** 2026-06-23 · **App:** `Finance agent/nexus-app` (Electron + React/Vite + Express + Python sidecar; local-first; file JSON store) · **Status:** Design, awaiting green-light on MVP.

## Vision
A complete, **Apple/Google-grade** personal-finance section for life planning — net worth, budgeting, cash flow, goals, retirement/FIRE, debt, tax — with relentless plain-language guidance and a proactive AI coach. Local-first and private.

## Locked decisions (from Aaron)
1. **Data source:** Hybrid — manual entry + CSV import now; **Plaid-ready** data layer (auto-sync deferred to a later phase). All data stays on-device.
2. **Structure:** One unified **"Money"** hub that **absorbs/supersedes** the scattered Planning / Loans / Advisor tabs.
3. **Scope:** All four domains (cash flow & budgeting · net worth/accounts/investments · retirement/FIRE & life goals · debt payoff & credit) — complete life planning, phased.
4. **Look:** **Softer Monarch-style LIGHT** UI for the Money hub; the **trading terminal stays OLED dark** (light theme scoped to the Money hub only).
5. **Onboarding:** **Sample data first → one-click "Reset & start mine"** (no real data seeded; guided setup after wipe).
6. **Guidance:** **Both** — a term glossary + inline "what does this mean?" explainers **and** a proactive AI coach (reuses NEXUS Claude/Ollama + Ramsey/Buffett/Cuban personas).
7. **Investments:** Track **real holdings separately** (manual/CSV) from the NEXUS paper-trading game; schema designed to allow a later merge.

## What we pull from each source
| Source | License | How | What |
|---|---|---|---|
| **financial-freedom** (Mint/Monarch OSS, Laravel/Vue) | GPL-3.0 → **concept-port only** | reimplement, don't copy code | Polymorphic **account model**, **rules engine**, category/transaction schema (superior to NEXUS's flat positions) |
| **daily_stock_analysis** (LLM stock platform, Python) | MIT → **code-portable** | port patterns | **Decision-dashboard** data model, **Market-Light** breadth score, **multi-source news intelligence + dedup**, **multi-channel notifications** (Telegram/Discord), **strategy-YAML** engine, **data-quality context packs** → these enhance the TRADING/Intel side (parallel track) |
| **best-personal-finance-tools** (curated list) | list | idea backlog | The feature taxonomy feeding the 36-item backlog |
| **maxintapp gist** | gist | reference | Transaction/cash-flow/import/OCR concepts |

## Architecture
- **Placement:** new top-level **Money** area in `src/App.jsx` TABS. Its sub-tabs map to the 9 sections. Planning/Loans/Advisor tools migrate in (their existing calculators in `server/nexus/tools/{planning,loans}.js` are reused as the math engine).
- **Light theme (scoped):** a `.money-hub` root class overriding the NEXUS Dark CSS vars with a light Monarch palette (off-white surfaces, ink text, retain electric-blue `#0071e3` accent for brand continuity, soft shadows, Inter). The dark terminal is untouched because the override is scoped to the Money hub container, not `:root`.
- **Data layer:** `server/money/store.js` — a storage abstraction over JSON files under `server/store/money/` now, with a clean interface so a **SQLite** backend can swap in (P2, flagged risk: JSON won't scale past ~1000s of txns). Entities (polymorphic, financial-freedom-inspired):
  - `accounts` (type: cash | credit | loan | brokerage | retirement | crypto | real_estate | vehicle | other; balance, institution, currency, status)
  - `transactions` (account_id, date, amount, payee, category_id, tags[], note, source: manual|csv|plaid, cleared)
  - `categories` (hierarchy, group, color, icon)
  - `budgets` (period, category_id, limit, rollover)
  - `goals` (name, target, current, linked_account_id, target_date, template)
  - `recurring` (detected/declared; payee, cadence, amount, next_date, kind: income|bill|subscription)
  - `networth_snapshots` (date, assets, liabilities, net)
  - `holdings` (account_id, ticker, shares, cost_basis, as_of) — REAL, separate from paper book
  - `rules` (matcher → category/tag), `settings`
- **Aggregation interface:** `server/money/sources/{manual,csv,plaid}.js` behind one interface; CSV = generic column-mapper + per-institution presets; `plaid.js` = stub implementing the same interface (Plaid-ready).
- **AI coach:** `POST /api/money/coach` builds a finance context (net worth, budget status, goals, recent txns) + question → routes to existing `server/routes/nexus` (Claude) / `local-model-client` (Ollama) with persona option (NEXUS/Ramsey/Buffett/Cuban). Graceful-degrade if AI offline (risk-mitigated). Proactive nudges computed server-side (overspend, under-save, goal drift) surfaced as cards.
- **Glossary:** `server/store/money/glossary.json` (~100 terms, plain-language) + a `<Term>` React component (dotted-underline + hover card + "learn more" → AI explainer). Every jargon word wraps in `<Term>`.
- **Onboarding:** ships a `sample.money.json`; "Reset & start mine" wipes to empty + launches a 5-minute guided setup (add first account → set one budget → done), per Monarch UX.
- **Disclaimers:** tax/retirement features show "educational, not professional advice" (risk-mitigated); "you might consider" phrasing, not "we recommend."

## The 9 sections (sub-tabs of Money)
1. **Accounts & Net Worth** — multi-account registry, net-worth trend (daily snapshots), institution library, balance alerts.
2. **Spending & Budgeting** — envelope/zero-based budget, category hierarchy, actual-vs-planned, auto-categorization rules, anomaly (3σ) alerts.
3. **Cash Flow & Planning** — 30/90-day balance forecast, recurring calendar, low-balance warnings, scenario modeling (raise/bonus/life event).
4. **Goals & Savings** — custom + template goals (Emergency Fund, Roth, FIRE), progress, achievability vs cash flow, milestone badges.
5. **Investment & Retirement** — real holdings, allocation, performance, Monte-Carlo retirement (async, laptop-aware), contribution tracking, FIRE number.
6. **Tax Planning** — quarterly estimates (fed+state, reuse take-home calc), deduction tracker, 1099/side income, bracket optimization (with disclaimers).
7. **Reports & Insights** — net-worth/spending/cash-flow reports, exports (CSV/PDF/JSON), annual review.
8. **Advisor & AI Assistant** — proactive coach, natural-language Q&A, glossary, "Learn more" education links (Bogleheads/Ramsey/Khan).
9. **Privacy & Data** — on-device explanation, encrypted-at-rest plan, export/backup, soft-delete + 30-day recovery, reset.

## Phased shipping (vertical slices, fits the 1.5 hr/day cadence)
**Phase 1 — MVP "Money hub foundation" (P0):** light-themed Money shell + nav; `money/store.js` + schema + sample-data/onboarding; **Accounts & Net Worth**; **Transactions ledger** (manual + CSV import + basic auto-categorize); **Budgeting** (envelope); **glossary + `<Term>`** scaffold. Ship-quality, no AI yet.
**Phase 2 — "Planning power" (P1):** Cash-flow forecast; Goals (+ Emergency Fund, FIRE/Monte-Carlo); Debt payoff (avalanche/snowball, absorb Loans); Spending analytics; category **rules engine**; **proactive AI coach** + glossary AI; Tax dashboard; paycheck/Roth/401k trackers.
**Phase 3 — "Depth" (P2):** Investment/holdings tracker + allocation/rebalance; scenario modeling; Reports/exports; recurring bill scheduling; multi-currency; SQLite migration; automation rules; real-estate/vehicle; credit-score; **Plaid** sync.
**Phase 4 — Trading-side pulls (parallel, from daily_stock_analysis, MIT):** Market-Light breadth gauge (Dashboard); multi-source news intelligence + dedup (Intelligence); decision-dashboard model + strategy-YAML engine (Trades); multi-channel alerts (Telegram/Discord) for ensemble signals + budget alerts.

## Top risks (mitigations baked into the plan)
- JSON store scaling → SQLite migration planned from day 1 (interface abstraction). · Monte-Carlo slow on the i5/16GB → async + reduced-iteration preview. · Plaid privacy/complexity → optional, deferred, CSV-first. · Feature creep (36 items) → hard MVP cut (P0 only for v1). · Tax accuracy → disclaimers. · AI dependency → graceful degradation. · Data loss → daily auto-backup + soft-delete/30-day recovery.

## Verification (per phase)
`npm run build` green; `node --check` server; live API probes via Node http (curl is denylisted); manual GUI pass per section (`npx electron .`); for Phase 1 specifically: add account → net worth updates; import a CSV → transactions appear + auto-categorized; set a budget → actual-vs-planned renders; "Reset & start mine" wipes cleanly; light theme scoped (terminal still dark).

## Out of scope (v1) / explicit deferrals
Household multi-user; mobile app (Electron desktop only); receipt OCR; bill-pay execution; real bank credential sync (until Plaid phase). Educational tool, not professional financial/tax advice.
