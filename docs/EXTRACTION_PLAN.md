# MMM — Making Money Moves: Extraction Record

Carved the self-contained **Money hub** out of NEXUS (`nexus-app`) into a standalone
Electron desktop app (`mmm-app`), then removed Money from NEXUS.

Mapped & executed 2026-06-28. Toolchain matches NEXUS exactly: **npm + Node + Vite + Electron, JS/JSX** (no Bun, no TypeScript).

## Decisions (confirmed with Aaron)
1. **Stack:** Electron shell mirroring NEXUS (Express forked on **:5006**, Vite/React SPA).
2. **AI coach:** ported with graceful-degradation (Claude if `ANTHROPIC_API_KEY` set → local Ollama → friendly "offline" message).
3. **Location/git:** `projects/Finance agent/mmm-app`, its **own dedicated git repo** (independent of the umbrella repo).
4. **NEXUS dashboard card:** repoint the Planning "My Snapshot"/net-worth card to nudge toward MMM (it is NOT part of the Money footprint).

## MMM architecture
- `electron.js` forks `server/index.js` on **:5006**; serves Vite build from `src/dist`.
- **Root UI = `<MoneyHub/>`** (it ships its own sidebar + sections — no NEXUS tab switcher).
- `money-theme.css` (light) imported globally in `main.jsx`; window/splash/body are light (`#f6f7f9`), `color-scheme: light`.
- Server mounts **only** `/api/money` + `/api/health`.
- Independent single-instance lock via `appId: com.mmm.money`.
- CSP `connect-src`: `'self' http://127.0.0.1:5006 http://localhost:5006 http://localhost:11434 https://api.anthropic.com`.
- **No Tailwind** — the Money components use only inline styles + `m-*` theme classes (verified 0 Tailwind utilities).

### Files ported verbatim
- Frontend: `src/components/money/**` (16 files), `src/styles/money-theme.css`.
- Server: `server/money/{routes,store}.js`, `server/nexus/local-model-client.js` (coach's only NEXUS coupling — 90 lines, fs+path only), `server/store/money/*`.
- Docs: 5 `MONEY_HUB*` files.

### Files written fresh (trimmed shell)
`src/{main.jsx,App.jsx,index.html}`, `server/index.js`, `electron.js`, `preload.js`, `vite.config.mjs`, `package.json`, `.gitignore`, `env.example`.

### UI rebrand
- `Advisor.jsx` persona "NEXUS Balanced" → "MMM Balanced".
- Splash/title: "MMM / Making Money Moves".

## Phase B — NEXUS removal targets (verified)
- Delete: `src/components/money/`, `src/styles/money-theme.css`, `server/money/`, `server/store/money/`. **Keep** `server/nexus/local-model-client.js` (NEXUS desk still uses it).
- `src/App.jsx`: lazy import (~33), nav entry (~54), render case (~229–230).
- `src/components/layout/Sidebar.jsx`: `Wallet` import (line 4 — money-only), `o:'money'` (11), `money:'O'` (12), nav entry (19).
- `server/index.js`: require (26) + mount (114).
- **Repoint** dashboard `PortfolioSummary` snapshot card → MMM nudge.
- **Keep (incidental prose, not Money hub):** `SettingsPanel.jsx:162`, `GuideModal.jsx:20,65,66,72`, plus `MediaFeed.jsx` ("Planet Money" etc.) and `SportsOdds.jsx` ("Moneyline").

## Verification gates
- [ ] NEXUS builds `VITE_EXIT=0`.
- [ ] Zero `MoneyHub|/api/money|money-theme|components/money` refs in `nexus-app/src` + `nexus-app/server`.
- [ ] 8 remaining NEXUS tabs render with clean console.
- [ ] MMM builds; Electron launches; MoneyHub is the root on :5006.
- [ ] MMM `/api/money/*` persists across restart (reset → welcome, seed → data).
- [ ] MMM + NEXUS run simultaneously (distinct ports + locks).
- [ ] `MMM.lnk` on Desktop launches MMM.
- [ ] Two commits: NEXUS → umbrella repo; MMM → its own repo.
