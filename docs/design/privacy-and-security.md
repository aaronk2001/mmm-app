# MMM Privacy & Security Architecture

*Applies to v1.0.0.*

## Abstract

MMM (Making Money Moves) is a local-first personal finance desktop application built on Electron 30 with an Express backend and SQLite datastore. This document specifies the threat model, verifies the local-first privacy claim against outbound network activity, details key storage mechanisms, and enumerates security controls across Electron hardening, server configuration, and packaging. The app ships no telemetry; all seven online features are opt-in and off by default; API keys are encrypted on disk via Electron's safeStorage and decrypted only in the main process; and user data remains in `%APPDATA%\mmm` local to the machine.

---

## 1. Threat Model

### Assets
- **User financial data:** transactions, accounts, holdings, budgets, goals, net worth snapshots, paper trading journal, backtesting history.
- **API keys:** optional market data (Yahoo Finance), news (Marketaux), sports odds (The Odds API), prediction markets; stored encrypted on disk.
- **User preferences & application state:** window size, feature toggles, launch-on-boot setting, close-to-tray state.

### Adversaries Considered
- **Malicious JavaScript in the renderer:** contextIsolation + sandboxing prevent access to Electron APIs and main process state; keys are never readable from the renderer even with compromise.
- **Web pages in the user's browser hitting localhost:5006:** binding to 127.0.0.1 keeps other machines out, but any site the user visits can still send requests to loopback. CORS stops such a page from *reading* responses, not from *sending* a "simple" cross-site POST, and a DNS-rebound hostname is same-origin and could read everything. `server/local-guard.js` closes both (see §6).
- **Other local processes:** can call the API like any client; the server does not authenticate callers (see §10).
- **Accidental leakage via backups or logs:** keys.enc is kept entirely separate from the SQLite database and excluded from all backup exports; query strings containing API keys are stripped before caching.
- **Tampering during app updates:** unsigned portable exe; external verification of integrity required.

### Out of Scope
- A fully compromised OS user account (local OS privilege escalation).
- Forensic data recovery from deleted files or RAM.
- Physical access to the machine (cold boot attacks, device cloning).
- Supply-chain attacks on third-party npm packages (mitigated by dependency audit, not covered here).
- Keyloggers or screen capture at the OS level.

---

## 2. Local-First Architecture

### Data Location
- **Production:** `%APPDATA%\mmm` (packaged build with `app.isPackaged` true).
  - `mmm.db` / `mmm.db-wal` / `mmm.db-shm` — SQLite database and write-ahead log.
  - `keys.enc` — Electron safeStorage-encrypted API keys (JSON-serialized map).
  - `desktop-prefs.json` — user preferences (close-to-tray, launch-on-boot).
  - Daily backup files in `backups/` subdirectory (user data only, keys excluded).

- **Development:** repo-local fallback in `server/store/money/` when `MMM_ALLOW_DEV_DB=1` is set (electron.js:163).

### No Accounts / No Telemetry
The app requires no login, registration, or account creation. All data is private to the local machine.

**Telemetry verification:** A grep search for outbound HTTP calls across the entire codebase confirms zero unauthenticated telemetry collection:
- `/api/health` (internal probe only).
- Every remote call goes through an opt-in feature key that defaults to off (inventory in §3).
- No analytics, crash reporting, or usage tracking libraries are present in `package.json`.

---

## 3. Online Features & Network Gating

### Feature Inventory
Seven optional online features, all **off by default** (server/online/features.js:9):
```javascript
['market', 'news', 'youtube', 'predictionMarkets', 'sportsOdds', 'telegram', 'cloudLlm']
```

### Feature Lifecycle
1. User explicitly toggles a feature on in Settings → Online & Keys.
2. Toggle is persisted to `settings.online.<feature>` in SQLite.
3. Before any network call, `online.enabled(feature)` checks the database.
4. If disabled, `online.fetch()` returns cached data (or null) with `{ offline: true }` — **zero socket opens** (verified: tests/online.test.mjs:50–54).

### Outbound Network Inventory

This is every remote host the server code contacts (`server/market/providers.js`, `server/news/providers.js`, `server/betting/providers.js`, `server/money/ollama.js`).

| Host | Feature key | Default | Purpose |
|------|-------------|---------|---------|
| `query1.finance.yahoo.com` (+ Yahoo endpoints used by the `yahoo-finance2` SDK) | `market` | off | Quotes, charts, indices, futures, sectors, earnings, screener, backtest bar sync |
| `api.stlouisfed.org` | `market` (+ FRED key) | off | Macro series |
| `api.coingecko.com` | `market` | off | Crypto prices (keyless) |
| `api.frankfurter.dev` | `market` | off | FX rates (keyless) |
| `api.marketaux.com` | `news` (+ key) | off | Market and per-ticker news |
| `gamma-api.polymarket.com`, `api.elections.kalshi.com`, `api.manifold.markets` | `predictionMarkets` | off | Prediction-market prices (keyless) |
| `api.the-odds-api.com` | `sportsOdds` (+ key) | off | Sportsbook lines |
| `127.0.0.1:11434` (override: `OLLAMA_HOST`) | none — loopback only | best-effort | Local LLM for the coach; absent Ollama degrades to rules-only |

The `youtube`, `telegram`, and `cloudLlm` keys exist in `server/online/features.js` but have **no consumer**: nothing in the server contacts YouTube, Telegram, or a cloud LLM. `polymarket.com`, `kalshi.com`, and `manifold.markets` appear only as outbound links the user can click.

**Caching:** responses are stored in `http_cache` with the query string stripped before the URL is saved, so keys passed as query parameters (FRED) never reach exports or backups (`server/online/index.js:66-74`).

**Backpressure:** at most 3 in-flight requests; HTTP 429 and error responses set independent per-cache-key cooldowns (`server/online/index.js:34-58`).

---

## 4. Key Storage & Encryption

**At Rest:** API keys encrypted via Electron `safeStorage` → OS credential store (DPAPI on Windows, Keychain on macOS, secret-service on Linux, plaintext fallback on Linux without secret-service).

File: `%APPDATA%\mmm\keys.enc` (binary, unreadable without Electron).

**In Transit:** Keys pushed once on startup via fork() IPC (internal Unix socket, not HTTP).

**Server:** `server/online/keys.js` holds decrypted map in-memory only (never disk, never SQLite, never backed up). Presence queries only (no values): `keys.presence()` returns `{feature: true/false}`.

**Renderer API:** `mmm.secrets.get()` returns presence booleans; `mmm.secrets.set(provider, value)` validates provider against known features list and caps value at 4096 bytes. Compromised renderer cannot read keys.

---

## 5. Electron Hardening

### Context Isolation & Sandboxing (electron.js:182–188)

`contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true`: Renderer cannot access Electron APIs or require(). Bridge only through preload script.

### Preload API (preload.js:4–20)

Exposed via `window.mmm`: minimal surface with app version, prefs (closeToTray, launchOnBoot), native notifications, and secrets (get presence booleans, set/delete keys with validation). No file system, network, or OS API access.

### Content Security Policy (electron.js:193–202)

`default-src 'self'; script-src 'self'; connect-src 'self' http://127.0.0.1:5006 http://localhost:5006; frame-ancestors 'none'`. No external resources; local server only.

### Navigation & Link Handling (electron.js:226–239)

Main-frame navigation blocked unconditionally (`will-navigate` prevented). External links (http/https) opened in OS browser; file://, smb://, ms-* schemes dropped.

### Single-Instance Lock (electron.js:305–317)

Prevents multiple windows; second launch focuses existing window. Guards against race conditions in key management and database locking.

---

## 6. Server Hardening (server/index.js)

**Port Binding (line 121):** Bound to 127.0.0.1 only; no external access.

**Headers (line 31):** Helmet security headers; frameguard and CSP disabled (Electron handles both).

**CORS:** Allows localhost:5006, localhost:5173 (Vite dev), 127.0.0.1:5006, file:// (override: `MMM_CORS_ORIGINS`). CORS governs whether a page may read a response; it does not stop a request from being processed.

**Local guard (`server/local-guard.js`):** every request must carry a loopback `Host` (127.0.0.1, localhost, [::1]), which defeats DNS rebinding. Unsafe methods (POST/PUT/PATCH/DELETE) are rejected with 403 when the browser marks them `Sec-Fetch-Site: cross-site` or when an `Origin` header is present and not in the CORS allowlist. This blocks a web page from blind-firing no-body writes such as `POST /api/money/reset`. Clients that send no `Origin` (curl, scripts) are allowed, consistent with the out-of-scope local-process adversary. Pinned by `tests/local-guard.test.mjs`.

**Rate Limiting (line 47–51, server/api-limiter.js):** 120 req/min on POSTs, PUTs, DELETEs, PATCHes, and network-reading GETs (market, news, betting, online). Local-only GETs skipped.

**Body Cap (line 42):** 2 MB limit on JSON uploads.

**Request Timeout (line 68–82):** 30s default; exempts `/api/money/coach` (40s), `/api/backtest/run`, `/api/backtest/bars/sync`, `/api/market/refresh*`.

**Input Validation:** Write routes validate input (transaction amounts as finite, account types from enum, dates as YYYY-MM-DD, select clauses enum-gated).

**Error Handling:** 5xx errors logged with stack. Client sees generic "Internal server error". Uncaught exceptions and unhandled rejections caught; process kept alive.

---

## 7. Paper-Only & Informational-Only

**Trading (server/trading/routes.js):** POST verbs (open/close/reset paper positions, gate-check) and GET verbs (account, positions, trades). No real broker integration; all ops local to `paper-store.js`. Journal records lesson-learned notes, not audit log.

**Betting (server/betting/routes.js):** GET only. Reads prediction-market and sportsbook odds; computes arbitrage. Never places wagers or records bets in ledger.

---

## 8. Packaging & Build Integrity

**Data Stripping (scripts/build-portable.mjs:75–84):** Portable build removes mmm.db*, data.json, backups/, and any leftover user data. Fresh install always starts empty (keys.enc never included; stored separately in %APPDATA%).

### Dependency Resolution (scripts/build-portable.mjs:86–154)

The build verifies every `require()` in the packaged server resolves from included node_modules, guarding against missing dependency bumps at build time.

---

## 9. Verification

| Control | Test / Evidence |
|---|---|
| Zero-socket guarantee | tests/online.test.mjs:50–54 (feature-off blocks all network) |
| Backup integrity | tests/backup-roundtrip.test.mjs:67–96 (keys excluded from BLOB_KEYS) |
| Presence-only secrets | tests/online.test.mjs:213–219 (GET /keys returns booleans, never values) |
| Electron hardening | electron.js:182–239 (contextIsolation, CSP, navigation lock, link handler) |
| Server binding | server/index.js (port bound to 127.0.0.1) |
| Host / Origin guard | tests/local-guard.test.mjs (rebinding and cross-site writes rejected) |
| Rate limit | server/index.js:47–51 (120 req/min, network-reads included) |
| Body cap | server/index.js:42 (2 MB limit) |
| Timeouts | server/index.js:68–82 (30s default, long-running routes exempt) |
| Feature gating | server/online/index.js integration (disabled = no socket) |

---

## 10. Known Limitations & Residual Risks

1. **Unsigned Portable Exe:** `MMM.exe` is unsigned; external verification (SHA-256 hash) is required.
2. **Source Readable on Disk:** `asar: false` means code is unpacked; accepted as no obfuscation is claimed.
3. **Unauthenticated loopback API:** any local process running as any user can call the API (no token handshake between the Electron shell and the server). Browser-originated attacks are handled by the local guard; local processes are out of scope.
4. **Windows DPAPI:** OS user account compromise recovers keys; out of scope.
5. **Provider Compromise:** Enabled online features may leak query content (though keys are stripped). Opt-in + caching mitigates.
6. **Ollama Misconfiguration:** User must configure Ollama to listen on 127.0.0.1 only.
7. **Cache Timestamps:** `http_cache` table timestamps reveal query activity; accepted residual risk of caching.
