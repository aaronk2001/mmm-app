# Sprint C — Identity propagation + retire NEXUS

**Spec:** `~/.claude/plans/lets-make-a-plan-floating-pine.md` §5a (sprint table), §4.5, §3, §7, §9.
Absorbs old Phase 7 plus what remains of Phase 6 after the cuts. Branch `v3/sprint-c` off master `9ce6d8d`
(Sprint B merged, **415 tests / 28 files**).

**Goal:** make the app look like one product rather than three eras of it, then archive NEXUS for good.

## Global constraints

- npm, React 18, **JSX not TSX**. No TypeScript, no Bun, **no new dependency**.
- **v3 tokens are locked** (`docs/design/v3-tokens.md`). Use semantic `var(--m-*)` / `var(--chart-N)`.
  **Never a hardcoded hex.** **Every `--m-*` bridge name must survive** — `money-theme.css` maps them onto
  `theme.css`, and renaming one silently breaks whatever still reads it.
- No `cursor: pointer` on cards (correct on buttons and links). Numbers `tabular-nums`. Colour always paired
  with a sign or icon. Every chart keeps its table fallback. Every figure keeps its evidence grade.
- `npm run check:contrast` must stay green in **both** themes.
- **This is a restyle, not a rewrite.** Do not change behaviour, props, data flow, or route structure. If a
  section looks like it needs restructuring, note it and leave it.
- `git commit -F -` with a heredoc. Never `git add -A`. Never stage `.omc/`, `build/`, `src/dist/`,
  `.superpowers/`, `.playwright-cli/`, or anything under `server/store/money/`.
- **Never a bare `node -e` that requires `server/money/store.js` or `server/db/connection.js`** —
  `connection.js:14` falls back to the real dev database when `MMM_DATA_DIR` is unset.
- **Never `npm run build:portable`**, never `npm start`, never two builds at once.

---

## Track 1 — restyle the legacy sections

**Files:** the pre-v3 sections only — `Overview.jsx`, `AccountsNetWorth.jsx`, `Transactions.jsx`, `Budget.jsx`,
`CashFlow.jsx`, `Goals.jsx`, `Debt.jsx`, `Investments.jsx`, `Reports.jsx`, `RulesManager.jsx`,
`CustomFieldsManager.jsx`, `Settings.jsx`, plus their `parts/`.

**Do not touch** `Plan.jsx`, `Markets.jsx`, `Trades.jsx` or `Learn.jsx` — those were built on v3 tokens already.

Audit first, then change. For each file: find hardcoded colours, ad-hoc spacing, non-tabular numbers, colour
used without a sign or icon, `cursor: pointer` on non-interactive elements, and inconsistent card/heading
treatment against the newer sections. `Plan.jsx` and its `parts/plan/*` are the reference for what "right"
looks like.

Prefer the existing shared components (`Card`, `SectionHeader`, `MetricCard`, `Money`, `Grade`, `EmptyState`,
`ErrorState`, `Skeleton`) over bespoke markup — but **only where the swap is behaviour-neutral.**

## Track 2 — identity assets and accessibility

- Logo, app icon and splash consistent with the v3 direction ("Precision instrument", `docs/design/v3-tokens.md`).
  `scripts/` already stamps the exe icon — check how before changing inputs.
- Accessibility pass: focus-visible on every interactive element, reduced-motion honoured (`motion/react` and
  charts), a table fallback on every chart, `aria-label` on icon-only buttons, and heading order that makes
  sense per section.
- Delete the `desk` and `media` entries from `SECTIONS` in `MoneyHub.jsx`. They are permanent placeholders now
  that AI and Media are cut — a nav item that will never fill in is clutter, not a promise. Check nothing else
  references those ids.

## Track 3 — retire NEXUS

1. **`docs/NEXUS-PARITY.md`** — a checklist of what NEXUS did, and for each item: ported (where), deliberately
   cut (why), or deferred. The cuts are AI/Desk, Betting/prediction markets, Media, Telegram, and Learn beyond
   M0-M2. **Be honest about the cuts** — this document is the record of what Aaron gives up by archiving.
2. Tick it against the **packaged exe**, not the dev server.
3. **The archive and shortcut deletion are DESTRUCTIVE and are Aaron's to run, not yours.** Write
   `scripts/archive-nexus.sh` which moves `nexus-app/` to an archive location and removes the `NEXUS.lnk`
   desktop shortcut, with a comment block explaining exactly what it does and how to undo it. **Do not run
   it.** Leave it for Aaron to execute via `!`.
   - `nexus-app` is **not its own git repo** — it lives inside the umbrella repo at
     `C:\Users\aaron\projects`. Moving it is a working-tree change there, not a submodule operation.
   - Confirm `mmm-app` has no runtime dependency on any path under `nexus-app` before writing the script.
     `scripts/import-nexus.mjs` reads from it — that import is a **one-time migration Aaron has already run**,
     so the script must keep working from the archived location or fail with a clear message, not crash.

## Verification

`npm test` still **415+ in 28+ files** (a restyle should add none and break none), `npm run build` exit 0,
`npm run check:contrast` green in both themes. Sprint gate (controller): full suite, packaged smoke, in-app
pass, one review, merge. The archive script is handed to Aaron, not executed.
