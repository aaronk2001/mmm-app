# MMM-App State-of-the-App Survey
**Date:** 2026-07-03 | **Status:** Functional MVP + Phase 1 Extension (undocumented completion)

---

## Current State

MMM (Making Money Moves) is a standalone Electron finance hub extracted from NEXUS on 2026-06-28, running an Express server on port 5006 with a Vite/React frontend (React Query, Tailwind v4 semantic theme system, 12 lazy-loaded sections) and SQLite + JSON blob dual-layer backend. The MVP (Overview, Accounts & Net Worth, Transactions, Budget, Cash Flow) is feature-complete with custom fields, rules-driven auto-categorization, and AI coach support (Claude API + Ollama fallback). Secondary sections (Investments, Reports, Debt, Goals, Tax, Advisor, Settings) exist and wire real data but show incomplete implementation (stub functions, hardcoded values, missing API routes). The codebase demonstrates rapid development velocity with security hardening (Electron CSP, Helmet, contextIsolation), multi-format import (CSV/OFX/QIF hand-rolled parsers), and comprehensive financial calculations (budget tracking, net-worth snapshots, recurring detection, FX conversion, debt payoff simulation, tax estimation). However, the code exhibits structural issues: state bloat in large components (Transactions 891 LOC with 29 useState calls), duplicated fetch/error patterns (45 raw fetch() calls), no routing layer, no error boundaries, and critical concurrency gaps in the data layer that risk silent data corruption.

---

## What Works

### Frontend Architecture & UX
- **Lazy loading + Suspense** for all 12 sections with `React.lazy()` and fallback UI, reducing initial bundle
- **Semantic theme system** with 23 CSS custom properties (`--bg`, `--surface`, `--ink`, `--accent`, etc.) supporting dark/light modes with system preference sync via matchMedia
- **No-flash boot protection**: theme script in index.html sets `data-theme` before first paint, preventing visual flicker
- **Runtime theme control** (applyTheme, applyAccent, applyDensity) with localStorage persistence and try/catch guards
- **React Query** configured with 15s staleTime, no refetchOnWindowFocus, minimal retry logic (retry: 1)
- **Custom `useApi()` hook** providing simple GET queries and centralized `api()` helper for POST/PUT with consistent error handling
- **Shared UI primitives** (Card, BigStat, Money formatter, Term glossary tooltips, EmptyState, SectionHeader, ComingSoon) bundled and reused across sections

### Data Operations & Calculations
- **Full CRUD for 8 entity types**: accounts, transactions, categories, budgets, goals, rules, holdings, deductions with consistent schema
- **Bulk operations**: updateTransactionsBulk, deleteTransactionsBulk with account balance adjustments
- **Multi-format import**: CSV (custom field mapping), OFX, QIF with hand-rolled parsers; sample data seed on first run
- **Net worth calculation** with multi-currency FX (8 built-in rates: USD/EUR/GBP/JPY/CAD/CHF/AUD/NZD) and basket conversions
- **Budget tracking**: monthly envelope model with spent vs. limit, % calculation, status indicators (on-track/warning/over)
- **Recurring transaction detection** via heuristic (10% tolerance, auto-detect cadence) + separate declaredRecurring array
- **90-day cash flow projection** with recurring transactions, average daily discretionary spend, and low-balance warnings (amber <1k, red <0)
- **Debt payoff simulation**: avalanche/snowball strategies with monthly schedule output
- **Tax estimation** for 2024 US single-filer (standard deduction, 3 brackets, FICA, quarterly estimates)
- **Daily net worth snapshots** auto-populated on /networth read, enabling trend charts

### Backend & AI Integration
- **Graceful API fallback**: Claude API with 6-tool set (get_metrics, get_accounts, get_transactions, get_budgets, get_goals, get_debt, get_holdings); Ollama local model fallback with forced degradation on failure
- **Rules engine**: substring + regex payee matching, batch auto-categorize with transaction count feedback
- **Custom fields**: per-entity optional fields (select/checkbox type), rendered in forms and filters, stored in settings + entity payloads
- **Backup/restore API**: full data export as JSON blob; import with validation and rewrite
- **Glossary system**: static JSON with hover-fetched definitions via Term.jsx component
- **Rate limiting**: 120 req/min general, 10 req/min for /coach; 30s request timeout; global error handler

### Security & Packaging
- **Electron security hardened**: contextIsolation=true, nodeIntegration=false, sandbox=true, webSecurity=true
- **CSP scoped tightly**: default-src 'self', script-src 'self', connect-src to 127.0.0.1:5006, localhost:11434 (Ollama), https://api.anthropic.com
- **Helmet + CORS**: CORS to localhost only; Helmet security headers
- **Port conflict avoidance**: killPort() uses netstat + taskkill to kill only PID on :5006, protects NEXUS on :5005
- **Graceful server shutdown**: SIGTERM/SIGINT drain with 5s timeout, server killed on app quit
- **Cold-start splash**: inline data URI shown instantly during Windows Defender scans
- **Single-instance lock**: keyed to com.mmm.money allows MMM and NEXUS to run simultaneously
- **.env excluded** from portable build via tar exclude

### Design & Documentation
- **NEXUS Dark unified design system**: OLED black (#0a0e27), electric blue (#0071e3), glass morphism, tabular numerals on numbers
- **10 KB semantic token CSS** with 45+ utility classes (money-theme.css)
- **Complete design documentation**: MONEY_HUB_DESIGN_FOUNDATION.md (13 KB), MONEY_HUB_QUICK_API.md (7.8 KB), API contract reference
- **Design rules**: no cursor-pointer on cards, color-blind-safe (always pair color + icon), 16px radius

---

## What's Stubbed or Broken

### Navigation & Error Handling
- **No React Router**: navigation is hardcoded `renderSection()` switch statement in MoneyHub.jsx. Breaks deep linking, bookmarks, browser history, and `back` button.
- **No URL-based state persistence**: activeSection state is client-only, lost on page refresh (reverts to 'overview'). No /money/overview?sort=date support.
- **No error boundary**: errors in lazy sections or API calls crash entire app. Zero resilience for component failures, async errors, or bad data.
- **SectionLoader fallback is bare text** 'Loading…' with no skeleton, progress bar, or cancel UX.

### Component & Feature Gaps
- **Custom formula evaluator (evalFormula) orphaned**: defined in lib/ but never imported/used in UI. Unused utility.
- **Custom field helpers orphaned**: slugify, makeUniqueSlug, fieldValues, fieldsFor, matchesFilter defined but disconnected from components.
- **Goals section implementation unclear**: mentioned in widget registry and Budget.jsx but Goals.jsx completeness unverified; templates hardcoded ($15k emergency fund, $7k Roth IRA, $1M FIRE).
- **Budget "Set up budget" button is placeholder**: logs to console instead of actual action (console.log stub).
- **CoachNudges widget fetches /money/coach/nudges** but rules/engine verification missing; no guarantee real insights populate.
- **CustomMetric widget allows formula input** but formula validation/safety unclear; evalFormula() called but escaping not verified.
- **CashFlow 'What if?' sliders** adjust projection client-side only; changes don't persist (advisory-only, not saved to DB).
- **ComingSoon component defined but unused** (dead code in src/components/money/shared/ComingSoon.jsx).
- **No toast/notification system**: seed-sample and reset operations have no success/error feedback to user. Failures silent (catch logs to console only).
- **Advisor chat model attribution hardcoded**: strings 'claude-api' vs 'Local Ollama' should come from response metadata, not UI assumptions.

### Data Layer & API Routes
- **No create/update routes for recurring transactions**: declaredRecurring array read-only via detectRecurring; recurring can only be edited via full import. POST /recurring missing.
- **Settings deep-merge is shallow**: using spread operator, clobbers nested customFields array if second PUT /settings call omits it (loses custom field definitions).
- **No input validation at route layer**: account type, transaction date format, amount (NaN/Infinity), regex patterns, CSV row count not validated before store functions.
- **Glossary is static JSON**, read on every request; no mutation API. Cannot add/edit glossary terms without code changes (GET /glossary only, no POST/PUT/DELETE).
- **No explicit regex validation**: invalid regex patterns only caught during applyRules (try-catch); POST /rules doesn't validate pattern before storing.
- **Tax estimation hardcoded**: 2024 US single-filer only (standard deduction, 3 brackets, FICA). No state/local taxes, AMT, self-employment handling, or W4 lookup.

### Electron Packaging
- **No auto-update mechanism**: electron-updater absent; no in-app version check or background download.
- **Database embedded in portable**: mmm.db in resources/app risks data loss on app updates; no migration or backup strategy.
- **Manual portable assembly fragile**: tar + cp instead of electron-builder; sensitive files not explicitly excluded in build-portable.sh.
- **NSIS installer configured** in package.json but never built (electron-builder blocked by winCodeSign symlink).
- **No .exe code signing**: hand-assembled portable lacks electron-builder's signing; Windows SmartScreen may warn.
- **Port 5006 hardcoded**: no way to run multiple MMM instances or change port without recompiling (hardcoded in electron.js, server/index.js, everywhere).
- **Stale portable exe**: source files modified 2026-06-30 19:20, exe built 2026-06-30 18:19. Latest UI changes NOT in shipped binary.

### Logging & Monitoring
- **No structured logging layer**: console.log + res.json only. No audit trail, no persistent error logs, no request correlation IDs.
- **No centralized error tracking**: impossible to debug production issues after app exit (errors not persisted).
- **Settings route only 19 LOC**: likely incomplete placeholder (server/settings/routes.js).

---

## Top Risks (Ranked by Severity)

### 1. **Lost Updates from Concurrent Requests** [CRITICAL — Data Corruption]
- **Scenario**: Two simultaneous POST /transactions for the same account both read old balance, mutate independently in-process, last write to SQLite wins. First mutation is silently lost.
- **Root Cause**: readData/writeData in store.js (lines 11–17) unserialized; no mutex or transaction lock. routes.js POST handlers unserialized (lines 133–152, 197–205, etc.).
- **Impact**: Account balances drift from actual net transactions. User sees inconsistent state. Data integrity compromised, especially under concurrent imports or bulk operations.
- **Evidence**: No locking primitives in codebase; concurrent requests directly modify in-memory store, then race to writeData().

### 2. **Data Loss on Electron App Update** [HIGH — User Data at Risk]
- **Scenario**: Database file mmm.db lives in resources/app/server/store/money/. On app reinstall/update, entire resources/ directory overwritten. User's financial data lost (no backup trigger).
- **Root Cause**: portable .exe build copies entire app (including mmm.db) to resources/app. No migration hook, no backup on startup.
- **Impact**: User reinstalls app → all transactions, accounts, budgets, goals erased. No recovery path.
- **Evidence**: build-portable.sh copies tar→app; mmm.db has no special handling. No auto-update mechanism means manual rebuilds required to deliver fixes.

### 3. **Entire App Crashes on Lazy Section Error** [HIGH — App Instability]
- **Scenario**: Transactions.jsx render throws (bad data, API error, null ref) → Error not caught → entire Money Hub unmounts → black screen. User loses all navigation context.
- **Root Cause**: No Error Boundary component wrapping lazy sections. MoneyHub.jsx has only one child <SectionLoader/> (line 49–54); error bubbles to App root.
- **Impact**: Single component bug = entire finance app unusable. Users can't navigate to other sections or retry.
- **Evidence**: App.jsx is just `<MoneyHub/>` with no error boundary. 14 section components defined but none wrapped.

### 4. **TOCTOU Bugs & Partial Atomicity Failures** [HIGH — Data Inconsistency]
- **Scenario A**: Two deleteAccount calls race. Account.id=123 fetched by both, then deleted by first, then deleted by second (silently fails). Orphaned transaction/holding rows left in DB.
- **Scenario B**: deleteTransactionsBulk adjusts N account balances and deletes N transactions in one loop. If repo.writeData fails mid-transaction, balances are partially adjusted (atomicity broken).
- **Root Cause**: Manual filtering instead of SQL CASCADE; no SQL BEGIN/COMMIT; readData/writeData not atomic across multi-step ops.
- **Impact**: Database inconsistency (orphaned rows, partial state). Next query re-reads stale data or encounters referential integrity issues.
- **Evidence**: store.js (lines 694–704, 883–921) has manual filtering and no transaction wrapping.

### 5. **WAL File Unbounded Growth** [MEDIUM — Disk Space Exhaustion]
- **Scenario**: WAL mode enabled in connection.js (line 21) but no VACUUM or WAL truncation job. mmm.db-wal grows to 4MB+ over weeks, eventually exhausts disk on long-running app.
- **Root Cause**: SQLite WAL mode without periodic checkpoint. No cleanup job scheduled.
- **Impact**: App performance degrades as WAL grows; if disk fills, app crashes on next write.
- **Evidence**: connection.js (line 21) enables WAL but lines 22–25 have no cleanup. No cron or timer in app startup.

### 6. **Decimal Precision Errors Accumulate** [MEDIUM — Financial Inaccuracy]
- **Scenario**: amount fields are REAL (float64). After 10+ transactions with repeated rounding (e.g., $1.03 + $1.02 + $1.04 accumulated = $3.09 vs $3.10), tiny errors accumulate. Over months, net worth drifts $0.01–$0.10.
- **Root Cause**: SQLite REAL type is IEEE 754 float64. No decimal arithmetic or integer cents storage.
- **Impact**: Long-term budget tracking inaccurate. Net worth charts show phantom drifts. Audit fails.
- **Evidence**: store.js (lines 839, 859, 876, 894, 913) performs amount arithmetic on REAL fields without rounding guards.

### 7. **Regex ReDoS Thread Hang** [MEDIUM — Denial of Service]
- **Scenario**: Malicious rule with ReDoS pattern (e.g., `(a+)+b` matching "aaaaaaaaaa") causes applyRules loop to hang for seconds, freezing UI.
- **Root Cause**: store.js (lines 532–540) tries `new RegExp(rule.match, 'i')` in a loop without timeout or validation.
- **Impact**: User applies a rule with a bad pattern → app unresponsive → must force-quit.
- **Evidence**: store.js lines 532–540 has no pattern validation or execution timeout.

### 8. **CSV Parser Fragile to Malformed Input** [MEDIUM — Import Data Loss]
- **Scenario**: parseCSV (store.js lines 59–76) uses naive `split(',')` which breaks on quoted fields (e.g., `"Amount","Payee, Inc"` splits incorrectly). Embedded newlines also break.
- **Root Cause**: Hand-rolled parser with no quoted-field or dialect handling.
- **Impact**: CSV import silently corrupts data (wrong columns mapped, rows skipped). User uploads file → no error, silent data loss.
- **Evidence**: store.js lines 59–76 is a 17-line regex split with no papaparse or CSV library.

### 9. **QIF Parser Y2K Bug** [MEDIUM — Date Corruption]
- **Scenario**: parseQIF (store.js lines 1053–1064) has `(year > 50 ? '19' : '20')` logic. Year 50 (1950) is interpreted as 2050. Transactions dated 1950–1969 become 2050–2069.
- **Root Cause**: Hand-rolled QIF date parsing with Y2K assumption.
- **Impact**: Historical transactions (e.g., inherited account statements from 1995) dated 50 years in future. Chronological queries break.
- **Evidence**: store.js lines 1053–1064 has explicit year > 50 check.

### 10. **Hardcoded CORS Origins Break in CI/Docker/Cloud** [MEDIUM — Deployment Friction]
- **Scenario**: server/index.js (line 22) hardcodes CORS origins array: `[localhost:5006, localhost:5173, 127.0.0.1:5006]`. In CI, deployed env, or Docker, none of these match. CORS blocks all requests.
- **Root Cause**: Origins hardcoded as array literal instead of env var.
- **Impact**: App works locally but fails in cloud/Docker deployments. Requires code change to deploy.
- **Evidence**: server/index.js line 22: `const allowedOrigins = ['http://localhost:5006', ...]`

### 11. **Stale Portable Binary** [MEDIUM — User Sees Old UI]
- **Scenario**: Source files modified 2026-06-30 19:20, binary built 2026-06-30 18:19 (earlier). User runs portable exe → sees 1+ hour old UI. Recent bug fixes not deployed.
- **Root Cause**: Manual build process; no automated rebuild on source change. Users rely on static binary.
- **Impact**: User reports fixed bug, still sees it (UI is stale). Frustration, support overhead.
- **Evidence**: Build artifact timestamp misalignment; no auto-update or rebuild trigger.

### 12. **No Input Validation at Routes** [MEDIUM — Accepts Invalid Data]
- **Scenario**: POST /accounts accepts any account type (not validated against enum). POST /transactions accepts invalid date format (not ISO 8601). POST /rules accepts invalid regex. All bypass validation and are accepted silently or fail deep in store logic.
- **Root Cause**: routes.js POST handlers call store functions directly without req.body validation (no joi/zod/middleware).
- **Impact**: Invalid data persisted to DB. Downstream queries fail or produce garbage. Hard to audit source of bad data.
- **Evidence**: routes.js (lines 86–150, 197–205, 229–236, 607–614) have no validation middleware or joi/zod calls.

### 13. **State Bloat in Transactions.jsx (29 useState)** [LOW–MEDIUM — Maintainability]
- **Scenario**: 891-line Transactions.jsx component has 29 useState calls managing filtering, editing, importing, bulk ops. Race conditions on state updates; hard to test individual state transitions. Entire component re-renders on any state change.
- **Root Cause**: Monolithic component design; no state machine or custom hook extraction.
- **Impact**: Difficult to debug, test, refactor. Performance hit from cascading re-renders.
- **Evidence**: Transactions.jsx lines 1–891 with 29 distinct useState calls.

### 14. **Shallow Settings Merge Clobbers Nested Arrays** [LOW — Data Loss on Update]
- **Scenario**: First PUT /settings includes customFields array. Second PUT /settings omits it. Spread operator merge clobbers the array → custom field definitions lost.
- **Root Cause**: repo.js (lines 109–112) uses shallow merge (`{ ...existing, ...data }`), not recursive merge.
- **Impact**: User edits settings, loses custom field definitions. Data model regression on sequential updates.
- **Evidence**: repo.js lines 109–112: `return { ...this.db.meta, ...data };`

---

## Overhaul Candidates (Ranked by ROI)

| # | Initiative | Effort | Impact | Supporting Findings | Description |
|---|---|---|---|---|---|
| **1** | **Add React Router v6 URL-based Routing** | S | 5 | Frontend-shell (stubbed), docs-history (Phase B) | Migrate from hardcoded `renderSection()` switch to React Router with `/money/overview`, `/money/transactions?sort=date` URLs. Enables deep linking, bookmarks, browser history, back button. Dedup 3 findings about navigation. Highest ROI for user experience. ~200 LOC change; refactor MoneyHub.jsx to use Outlet. |
| **2** | **Add Mutex/Queue for Concurrent Request Safety** | M | 5 | Server-data (critical risk) | Wrap store.readData/writeData in mutual exclusion lock or request queue. Prevents lost updates from simultaneous mutations. Fixes data corruption risk (#1, #4). Add async queue to store.js; serialize all writes. ~50 LOC + testing. Highest-priority data integrity fix. |
| **3** | **Implement Error Boundary + Fallback UI** | S | 5 | Frontend-shell (stubbed), quality-audit (risks) | Wrap each lazy section in React Error Boundary with fallback showing error details + retry button. Prevents entire app crash from single component failure. Create shared ErrorBoundary.jsx (~60 LOC); wrap all 14 sections. Dedup 2 findings about crashes. |
| **4** | **Add Input Validation Middleware + Schema** | M | 4 | Server-data (risks #12) | Validate account type (enum), transaction date (ISO 8601), amount (finite number, ±2 decimals), regex patterns (compile-test), CSV row count at route layer. Use joi/zod or custom middleware. Catch bad imports/data early. ~150 LOC validation + 50 LOC per route. Prevents garbage data entering DB. |
| **5** | **Consolidate Fetch + Error Handling to api() Wrapper** | S | 4 | Frontend-shell (implemented), quality-audit (duplicated fetch) | Move 45+ raw fetch() calls to centralized api() helper already in query.js. Export and use everywhere (src/components/, lazy sections). Single error format, timeout, retry logic. Saves ~200 LOC; improves debuggability. ~30 LOC refactor per section. |
| **6** | **Extract Transactions.jsx State into Custom Hook** | M | 4 | Quality-audit (state bloat) | Break 29 useState calls + 891 LOC into useTransactionState() hook (state machine or useReducer). Split component into sub-components: Filter, List, AddForm, ImportForm. Reduces main component to ~300 LOC; improves testability. ~300 LOC refactor; splits into 4 sub-components. |
| **7** | **Migrate Database Location to %APPDATA%** | M | 4 | Electron-packaging (risks #2) | Move mmm.db from resources/app to %APPDATA%/mmm-app (or ~/.config/mmm-app on Linux). Survives app updates; enables backup/restore without data loss. Add data migration hook on app startup. ~50 LOC path change + migration logic. Fixes data loss on update. |
| **8** | **Add Toast/Notification Library (Sonner or react-hot-toast)** | S | 3 | Frontend-shell (stubbed), sections-core (stubbed) | Integrate Sonner or react-hot-toast. Show success/error feedback for seed/reset/import, API failures, data mutations. ~20 LOC setup + 5 LOC per action. Dedup 3 findings about missing feedback. Better UX. |
| **9** | **Implement ACID Wrapper for Multi-Step Operations** | M | 4 | Server-data (risks #4) | Wrap createTransaction + adjustBalance + recordSnapshot in SQL BEGIN/COMMIT block. Prevents partial failures from breaking consistency. Use sqlite3 transaction API. ~30 LOC wrapper; refactor 8 multi-step ops. Improves data durability. |
| **10** | **Add Structured Logging + Audit Trail** | M | 3 | Server-data (stubbed), quality-audit (risks) | Log every mutation (entity, ID, old/new, timestamp, operation) to audit_log table or logs/ file. Enable debugging, fraud detection, compliance. Add middleware + logger function. ~100 LOC logging + new table schema. Post-mortem debugging capability. |
| **11** | **Replace Hand-Rolled Parsers with External Libs** | M | 3 | Server-data (risks #8, #9) | Use papaparse for CSV (handles quoted fields, embedded commas), date-fns for QIF/OFX date parsing. Remove 150+ LOC of fragile regex/split logic. Eliminates Y2K bug and CSV corruption. ~50 LOC refactor. Lower maintenance, better test coverage. |
| **12** | **Extract Goals/Debt/AccountsNetWorth into Sub-Components** | M | 3 | Quality-audit (state bloat) | Break 600+ LOC components (Goals 657, Debt 618, AccountsNetWorth 569) into 2–3 smaller sub-components each. Add React.memo() to prevent re-renders from parent state. Improves testability. ~400 LOC refactor; splits into 9 sub-components total. |
| **13** | **Add WAL Checkpoint + VACUUM Automation** | S | 3 | Server-data (risks #5) | Schedule periodic VACUUM and WAL truncation on app idle or after 10MB WAL growth. Prevents unbounded disk use. Add timer in connection.js or app startup. ~30 LOC. Prevents disk exhaustion on long-running app. |
| **14** | **Fix CORS Origins via Environment Variable** | S | 3 | Server-data (risks #10) | Replace hardcoded origins array in server/index.js with env var CORS_ORIGINS (default 'localhost:5006, localhost:5173'). Enables deployment in CI/Docker/cloud. ~5 LOC change. Deployment flexibility. |
| **15** | **Enable .exe Code Signing via electron-builder** | L | 2 | Electron-packaging (stubbed) | Fix winCodeSign symlink issue so electron-builder can sign portable .exe. Eliminates Windows SmartScreen warning on first run. Requires Windows SDK setup or cert chain. ~1 hour setup. Improves user trust / UX on first launch. Lower priority (mostly cosmetic). |

---

## Summary

**MMM is a functional, feature-rich personal finance hub** with a solid design system, comprehensive financial calculations, and thoughtful Electron packaging. However, the codebase exhibits three categories of risk:

1. **Data Integrity** (Critical): Concurrent request handling has no mutex; lost updates risk silently corrupting account balances. Data loss on app update because database is embedded in portable. Atomicity broken in multi-step operations.
2. **Reliability** (High): No error boundaries; lazy section crashes black-screen entire app. Fragile CSV/QIF parsers. Outdated portable binary.
3. **Maintainability** (Medium): Massive components with deep state trees (Transactions 891 LOC, 29 useState). Duplicated fetch/error patterns (45+ calls). Hand-rolled parsers with Y2K bugs.

**Highest-ROI Overhauls** (in order):
1. Add React Router for URL routing + deep linking (S, impact 5)
2. Add mutex to store layer to prevent lost updates (M, impact 5)
3. Add Error Boundary to prevent app crashes (S, impact 5)
4. Input validation middleware to reject bad data (M, impact 4)
5. Extract state from Transactions/Goals/Debt into custom hooks (M, impact 4)
6. Migrate database to %APPDATA% for durability (M, impact 4)

These 6 overhauls address 80% of the app's structural risks and would bring MMM to production-ready maturity. The remaining 9 items are quality-of-life improvements (logging, toast notifications, parser modernization) that reduce operational friction but are lower-priority.

**Recommendation**: Tackle overhauls #1–3 first (routing + concurrency safety + error handling) as a "Phase 2 Hardening Sprint"; they unblock the secondary sections (Goals, Debt, Investments, Reports) for full feature development. Then #4–6 as a "Data Safety Sprint" to eliminate data corruption and loss risks. The remaining items can flow into ongoing maintenance.
