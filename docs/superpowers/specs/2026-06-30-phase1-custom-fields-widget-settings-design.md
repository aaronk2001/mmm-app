# MMM Phase 1 completion — Custom Fields + Per-Widget Settings

**Date:** 2026-06-30
**Status:** Approved design (brainstorming). Next: implementation plan.
**Scope note:** This closes out Phase 1's deferred "MAX customization." Two of the four originally-scoped features are **explicitly out**: the custom-section builder and saved views/filters (dropped by the user). The formula engine, rules engine, and dashboard customization are already shipped.

## Goal & non-goals

Give the user two customization powers:

1. **Custom fields** — attach user-defined **choice** data (dropdown or yes/no) to Transactions, Goals, and Accounts; use it to **filter** those lists and as **variables in the formula engine**.
2. **Per-widget settings** — configure each Overview dashboard widget (item count, category/account filters, trend timeframe) via an always-visible gear.

**Non-goals:** text/number/date custom-field types; custom fields as table columns or in Reports/CSV; multiple instances of a widget; the section builder; saved views. Keep it JS/JSX + npm, local-first, `--m-*` tokens, no new runtime deps.

## Locked decisions (from Q&A)

| Dimension | Decision |
|---|---|
| Custom-field types | **Dropdown** (user-defined options) + **Checkbox** (yes/no) only |
| Entities | Transactions, Goals, Accounts |
| Where values are set | In each entity's **add/edit form** |
| Field powers | **Filter records** (all 3 sections) + **feed formulas** (count **and** sum) |
| Not | Not table columns, not in Reports |
| Field management | **Both** — central manager in Settings + inline "add field" per section |
| Widget instances | **One of each** (no duplicates) |
| Widget knobs | Item count, category filter, account filter, trend timeframe |
| Widget settings UI | **Gear always visible** on each card → popover |

## Data model

**Field definitions** → `meta['settings'].customFields`:
```
customFields: [
  { id, entity: 'transaction'|'goal'|'account', name, slug, type: 'select'|'checkbox', options?: string[] }
]
```
`slug` is a stable, lowercased identifier derived from `name` (used for formula variable names) and is made **unique** at creation (append a short suffix on collision) so `cf_*` variables never clash; `options` present only for `select`.

**Field values** → a new `custom` JSON column (`DEFAULT '{}'`) on `transactions`, `goals`, `accounts`. Shape `{ [fieldId]: value }` where value is a string (dropdown option) or boolean (checkbox).
- `schema.sql`: add `custom TEXT DEFAULT '{}'` to the three tables.
- `repo.js` `TABLES`: append `'custom'` to the transactions/goals/accounts column lists.
- `repo.js` `deserializeRow`: parse `custom` for the three tables — `custom: safeJson(r.custom, {})`. Serialization needs no change: `serializeValue`'s generic object→`JSON.stringify` catch-all already handles it.

**Per-widget config** → `meta['settings'].dashboards.overview.widgetConfig` (sibling of `layout`):
```
widgetConfig: { [widgetId]: { count?, categories?: string[], accounts?: string[], timeframe?: '30d'|'90d'|'all' } }
```

No new API endpoints: definitions + widgetConfig ride the existing `/api/settings` (PUT merges into `meta['settings']`); values ride the existing transaction/goal/account create+update CRUD.

## Feature 1 — Custom fields

### 1a. Definitions manager (`CustomFieldsManager.jsx`, in Settings)
A card like `RulesManager`: lists fields grouped by entity; add (name + entity + type; for `select`, an editable option list); delete. Persists to `settings.customFields` via `saveSettings` + query invalidation. An identical **inline** entry point (a compact "＋ Add field" control) appears in each section's form area and opens the same add flow (honors "Both").

### 1b. Value inputs (`CustomFieldInputs.jsx`)
Given an entity + the record's current `custom` object, renders one control per defined field (native `<select>` for dropdown, checkbox for yes/no) using `--m-*` styles. Mounted inside the transaction add form, goal form, and account form; its `onChange` updates a `custom` object the parent submits.
- Wire-through: each section's create/update payload gains `custom`; `store.createTransaction/updateTransaction`, `createGoal/updateGoal`, `createAccount/updateAccount` accept and persist `custom` (default `{}`). Editing custom-field values via the Transactions inline-edit cells is **out of scope** — values are set through the add/edit form only.

### 1c. Filtering (`CustomFieldFilters.jsx`)
A control per field rendered in each section's filter bar (Transactions has one; Goals + Accounts get a lightweight bar): dropdown fields → a value selector (`Any` + each option); checkbox fields → `Any`/`Yes`/`No`. Filtering is client-side over `record.custom[fieldId]`. Filter state is component-local (not persisted — saved views are out of scope).

### 1d. Formula integration (`store.getMetrics`)
For each **field value**, emit two variables:
- `cf_<slug>_<valueslug>_count` — number of records (of that field's entity) whose `custom[fieldId]` matches the value.
- `cf_<slug>_<valueslug>_sum` — sum of the entity's primary amount for matching records: **transactions → `amount`**, **accounts → `balance`**, **goals → `target`**.
Checkbox fields use value slugs `yes`/`no`; dropdown fields use a slug per option. These join the existing metrics map, so they appear automatically as chips in the custom-metric widget's variable picker and are usable in any formula. `lib/customFields.js` holds shared slug/predicate/label helpers used by inputs, filters, and (mirrored server-side) the aggregate names.

## Feature 2 — Per-widget settings

### 2a. Settings schema (`widgets/settings.js`)
Declares, per widget id, which knobs it supports and their control type:
- `netWorthTrend`: `timeframe` (30d / 90d / all)
- `budgets`: `count` + `categories`
- `recentTransactions`: `count` + `categories` + `accounts`
- `accounts`: `count` + `accounts`
- `goals`: `count`
- `netWorth`, `cashFlow`, `coachNudges`: none
- `customMetric`: keeps its existing inline editor (no gear settings)

### 2b. Gear + popover (`WidgetSettingsPopover.jsx`, `Overview.jsx`)
Each widget card shows a subtle gear (always visible, next to the drag/remove affordances). Clicking opens a popover rendering controls from that widget's schema (count = number input; categories/accounts = multi-select of the user's categories/accounts; timeframe = segmented). Changes save to `settings.dashboards.overview.widgetConfig[id]` (debounced, mirrors the existing layout-persist path) + invalidate `['settings']`. The gear button carries `m-no-drag` so react-grid-layout doesn't eat the click (known gotcha).

### 2c. Application (`widgets/index.jsx`)
`Overview` passes `config={widgetConfig[item.i]}` into each widget's `Body`. Each widget reads its config, defaulting to today's hardcoded values:
- list widgets: `slice(0, config.count ?? default)` and, where applicable, filter their fetched rows by `config.categories` / `config.accounts`.
- `netWorthTrend`: for `90d`/`all`, fetch `/api/money/networth` (full snapshot history) instead of the overview's trailing-30-day slice, and window accordingly.

## Units (each small + focused)

**New client:** `lib/customFields.js`, `sections/CustomFieldsManager.jsx`, `sections/parts/CustomFieldInputs.jsx`, `sections/parts/CustomFieldFilters.jsx`, `widgets/settings.js`, `widgets/WidgetSettingsPopover.jsx`.
**Changed client:** `Settings.jsx` (mount manager), `Transactions.jsx` / `Goals.jsx` / `AccountsNetWorth.jsx` (inputs + filters + inline add), `Overview.jsx` (gear + config plumbing), `widgets/index.jsx` (accept `config`).
**Server:** `db/schema.sql` (+`custom` col ×3), `db/repo.js` (TABLES + `deserializeRow`), `money/store.js` (3 entities' create/update pass `custom`; `getMetrics` custom aggregates). No new endpoints.

## Verification

Build (foreground `npx vite build src -c vite.config.mjs`) + `PORT=5006 node server/index.js` + chrome-devtools at `:5006`:
1. Create a `select` and a `checkbox` field on each of Transactions/Goals/Accounts via the Settings manager and the inline add.
2. Set values in each section's add/edit form; confirm they persist across reload (SQLite `custom` column round-trips).
3. Filter each section by a custom field (dropdown value + yes/no).
4. Confirm `cf_*_count` and `cf_*_sum` appear in the custom-metric widget's variable picker and compute correctly.
5. Open each configurable widget's gear; change count / category / account / timeframe; confirm the widget updates and the config persists across reload.
6. Dark + light themes.

## Risks / notes

- **Variable explosion**: many fields × many options → many `cf_*` metric variables. Acceptable for a few fields; the picker already scrolls. No cap for now.
- **Goal/account "sum"**: summing `target`/`balance` is a defensible primary-amount choice; documented so it isn't surprising.
- **Trend timeframe** is bounded by available snapshots (sample seeds ~30 days), so `90d`/`all` may look similar until history accrues — expected, not a bug.
- **Native module / packaging** unaffected (no new deps); the repackaged `MMM.exe` flow is unchanged.
