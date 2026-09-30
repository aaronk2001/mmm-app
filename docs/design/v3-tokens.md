# MMM v3 identity — tokens (Phase D)

**Direction:** "Precision instrument". Dark by default, light available. Teal/mint accent kept.
**Approved:** Sep 17 2026, from an identity canvas of three directions (chosen mix = Variant A's
density and cool surfaces + Variant B's type, 12px card radius kept, hero numbers raised to 44px).

This phase encodes **tokens only** (`src/styles/theme.css`). Every legacy `--m-*` name in
`money-theme.css` is preserved and still bridges to these tokens, so the palette propagates
app-wide immediately. Component-level restyle of legacy sections is Phase 7.

## Surfaces and ink

| Token | Dark (default) | Light |
|---|---|---|
| `--bg` | `#0f1115` | `#f4f5f7` |
| `--surface` | `#151920` | `#ffffff` |
| `--surface-2` | `#1b2028` | `#eceef2` |
| `--border` | `#242a35` | `#dfe3e8` |
| `--ink` | `#e6e9ee` | `#14181f` |
| `--ink-2` | `#9aa4b1` | `#4a5361` |
| `--muted` | `#8590a0` | `#5f6a79` |
| `--accent` | `#2dd4bf` | `#0f766e` |
| `--accent-ink` | `#06231f` | `#ffffff` |
| `--positive` | `#4ade80` | `#047857` |
| `--negative` | `#fb7185` | `#be123c` |
| `--warning` | `#fbbf24` | `#a35206` |
| `--shadow-card` | none (flat; shadows only on modals) | `0 1px 2px rgba(16,24,40,.05)` |

Chart palette (`--chart-1..8`): dark keeps the v2 vivid set; light gets a deepened set so every
line clears 3:1 on white. Colour is never the only signal: pair with a label, sign or icon.

## Type

| Token | Value |
|---|---|
| `--font-body` | Inter Variable (bundled) |
| `--font-display` | Space Grotesk Variable (bundled) — h1/h2/h3, section and card titles |
| `--font-mono` | JetBrains Mono Variable (bundled) — every number, tabular |
| `--text-hero` | 44px, mono 600, line-height 1 |
| `--text-title` | 24px, display 700, tracking -0.02em |
| `--text-card-title` | 15px, display 600 |
| `--text-body` | 13px / 1.45 |
| `--text-label` | 10.5px uppercase, 600, tracking 0.08em, `--muted` |

Fonts ship with the app via `@fontsource-variable/*` (OFL-1.1) and are imported in
`src/main.jsx`. The Google Fonts link and its CSP entries are gone; the app is fully offline.

## Shape and motion

`--radius` 12px (cards) · `--radius-control` 6px · `--radius-badge` 3px · 1px rules, no glass,
no gradients. Motion 150–200 ms, transform/opacity only, honours reduced-motion. Hover on a
card is a border tint, never a lift. No `cursor: pointer` on cards.

## Rules every surface follows

- Numbers always tabular mono; P&L colour always paired with a sign.
- Evidence grade badge (A/B/C) on every computed figure.
- Nothing opens a trade on its own; personas are "in the style of".

## Gate

`npm run check:contrast` (also `tests/contrast.test.mjs`): every text token ≥ 4.5:1 on
`--bg`, `--surface`, `--surface-2`; `--accent-ink` ≥ 4.5:1 on `--accent`; every chart token
≥ 3:1 on `--bg` and `--surface`, in both themes. Passing as of this commit.

Default theme changed from "system" to "dark" (boot script, `lib/theme.js`, Settings reset).
