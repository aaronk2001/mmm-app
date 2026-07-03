# MMM Phase 1 — Custom Fields + Per-Widget Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user define dropdown/checkbox custom fields on transactions/goals/accounts (filterable + usable as formula variables), and configure each Overview dashboard widget via an always-visible gear.

**Architecture:** Field *definitions* live in the `meta['settings']` blob (`customFields`); field *values* live in a new `custom` JSON column on the three record tables. Widget config lives in `settings.dashboards.overview.widgetConfig`. No new API endpoints — everything rides `/api/settings` and the existing record CRUD. Client is React/JSX with the `--m-*` token system and TanStack Query.

**Tech Stack:** Electron + forked Express (:5006) + Vite/React 18, npm, JS/JSX only, better-sqlite3 via the `server/db/repo.js` blob shim, recharts, lucide-react, motion.

## Global Constraints

- **npm + JS/JSX only.** No TypeScript, no Bun, no new runtime dependencies.
- **Local-first.** No network calls; finance data stays on device; never hardcode keys.
- **Styling:** use `--m-*` CSS variables and existing classes (`.m-card`, `.m-card-no-hover`, `.m-btn`/`-primary`/`-secondary`/`-ghost`/`-sm`, `.m-input`, `.m-input-label`). No hardcoded colors. Interactive controls inside react-grid-layout widget cards MUST have `className="m-no-drag"`. No `cursor:pointer` on non-interactive cards.
- **Custom-field types:** dropdown (`select`, user-defined options) and yes/no (`checkbox`) ONLY.
- **Custom-field entities:** `transaction`, `goal`, `account`.
- **Formula aggregates per field value:** `cf_<slug>_<valueslug>_count` AND `cf_<slug>_<valueslug>_sum` (transactions sum `amount`, accounts sum `balance`, goals sum `target`). Checkbox value slugs are `yes`/`no`.
- **Widget knobs:** item count, category filter, account filter, trend timeframe. One instance of each widget (no duplicates).
- **Commits:** Aaron commits only when asked. Each task ends in a verification checkpoint; a suggested commit message is given but do NOT `git commit` unless Aaron approves. `mmm-app` is its own git repo.
- **Verify loop (used as the "test" cycle):** foreground `npx vite build src -c vite.config.mjs` (~15–75s; check `VITE_EXIT`), then `PORT=5006 node server/index.js` (restart after any server change), then drive `http://127.0.0.1:5006` via chrome-devtools-mcp. Reload with `ignoreCache:true` after a rebuild. Background tasks die at turn end — build + verify within one turn.

---

### Task 1: Custom-field storage (data layer + migration)

**Files:**
- Modify: `server/db/schema.sql` (add `custom` column to transactions/goals/accounts)
- Modify: `server/db/connection.js` (idempotent `ALTER TABLE ADD COLUMN` migration for existing DBs)
- Modify: `server/db/repo.js` (`TABLES` + `deserializeRow`)
- Modify: `server/money/store.js` (`createTransaction`, `createGoal`, `createAccount` accept `custom`)
- Modify: `server/money/routes.js` (pass `custom` from request body on the three POST routes)

**Interfaces:**
- Produces: every transaction/goal/account record now carries `custom: { [fieldId]: string|boolean }` (default `{}`), round-tripped through SQLite. Update paths already merge arbitrary keys via `{ ...old, ...updates }`, so `custom` in a PUT body persists with no signature change.

- [ ] **Step 1: Add the column to the schema (fresh DBs).** In `server/db/schema.sql`, add `custom TEXT DEFAULT '{}'` as the last column of `transactions`, `goals`, and `accounts`. Example for accounts:

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  type        TEXT,
  balance     REAL    DEFAULT 0,
  institution TEXT    DEFAULT '',
  currency    TEXT    DEFAULT 'USD',
  status      TEXT    DEFAULT 'active',
  created_at  TEXT,
  custom      TEXT    DEFAULT '{}'
);
```
Do the same (append `custom TEXT DEFAULT '{}'`) to the `transactions` and `goals` table definitions.

- [ ] **Step 2: Migrate existing DBs (ALTER TABLE).** In `server/db/connection.js`, after the code that runs the schema, add an idempotent migration that adds `custom` if it's missing (needed because `CREATE TABLE IF NOT EXISTS` never alters an existing table). Add this helper and call it once per open, after `SCHEMA` runs:

```js
function ensureCustomColumns(d) {
  for (const table of ['transactions', 'goals', 'accounts']) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === 'custom')) {
      d.exec(`ALTER TABLE ${table} ADD COLUMN custom TEXT DEFAULT '{}'`);
    }
  }
}
```
Call `ensureCustomColumns(db)` right after the schema is executed in the singleton open path (same place `SCHEMA` is run).

- [ ] **Step 3: Register the column in the repo.** In `server/db/repo.js`, append `'custom'` to the transactions, goals, and accounts arrays in `TABLES`. Then extend `deserializeRow` so the column is parsed back into an object (serialization is already handled by the generic object→`JSON.stringify` branch in `serializeValue`):

```js
function deserializeRow(table, r) {
  if (table === 'transactions') return { ...r, tags: safeJson(r.tags, []), cleared: !!r.cleared, custom: safeJson(r.custom, {}) };
  if (table === 'budgets') return { ...r, rollover: !!r.rollover };
  if (table === 'goals' || table === 'accounts') return { ...r, custom: safeJson(r.custom, {}) };
  return r;
}
```

- [ ] **Step 4: Accept `custom` on create.** In `server/money/store.js`, add a trailing `custom = {}` param to `createTransaction`, `createGoal`, `createAccount` and include `custom` on the created object. For `createAccount`:

```js
function createAccount(name, type, balance, institution, currency = 'USD', status = 'active', custom = {}) {
  if (!name || !type) throw new Error('name and type required');
  const data = readData();
  const account = {
    id: newId(), name, type,
    balance: parseFloat(balance) || 0,
    institution: institution || '', currency, status,
    created_at: new Date().toISOString(),
    custom: custom && typeof custom === 'object' ? custom : {},
  };
  data.accounts.push(account);
  writeData(data);
  return account;
}
```
Do the equivalent for `createTransaction` (trailing `custom = {}` param, add `custom` to the pushed object) and `createGoal`.

- [ ] **Step 5: Pass `custom` from the routes.** In `server/money/routes.js`, on `POST /transactions`, `POST /goals`, `POST /accounts`, destructure `custom` from `req.body` and pass it as the new trailing argument. Example for accounts:

```js
router.post('/accounts', (req, res) => {
  try {
    const { name, type, balance, institution, currency, status, custom } = req.body;
    const account = store.createAccount(name, type, balance, institution, currency, status, custom);
    res.status(201).json({ account });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
```
Match the existing destructuring for transactions/goals and append `custom`.

- [ ] **Step 6: Verify the round-trip.** Restart the server, then run this API check (create a record with `custom`, read it back):

```bash
cd "C:/Users/aaron/projects/Finance agent/mmm-app" && node -e "
(async()=>{
  const b='http://127.0.0.1:5006/api/money';
  const a=await (await fetch(b+'/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'CF Test',type:'checking',balance:100,custom:{f1:'Business',f2:true}})})).json();
  const back=(await (await fetch(b+'/accounts')).json()).accounts.find(x=>x.id===a.account.id);
  console.log('custom round-trip:', JSON.stringify(back.custom));   // expect {\"f1\":\"Business\",\"f2\":true}
  // cleanup
  await fetch(b+'/accounts/'+a.account.id,{method:'DELETE'});
})().catch(e=>console.log('ERR',e.message));
"
```
Expected: `custom round-trip: {"f1":"Business","f2":true}`. Then re-seed to clean: `node -e "fetch('http://127.0.0.1:5006/api/money/seed-sample',{method:'POST'})"`.

- [ ] **Step 7: Commit (only if Aaron approves).** Suggested: `feat(money): add custom JSON column + migration to transactions/goals/accounts`.

---

### Task 2: Custom-field helpers (`lib/customFields.js`)

**Files:**
- Create: `src/lib/customFields.js`

**Interfaces:**
- Produces:
  - `slugify(name) -> string` — lowercase, `[a-z0-9_]`, collapse runs to `_`.
  - `valueSlug(field, value) -> string` — `checkbox`: `value ? 'yes' : 'no'`; `select`: `slugify(String(value))`.
  - `fieldValues(field) -> Array<{value, label, slug}>` — checkbox → `[{true,'Yes','yes'},{false,'No','no'}]`; select → its options.
  - `matchesFilter(record, field, filterValue) -> boolean` — `filterValue === '__any__'` → true; checkbox filter values are strings `'yes'`/`'no'`.
  - `fieldsFor(settings, entity) -> Field[]` — `(settings?.customFields || []).filter(f => f.entity === entity)`.
  - `makeUniqueSlug(name, existingSlugs) -> string` — `slugify(name)`, append `_2`, `_3`… on collision.

- [ ] **Step 1: Write the helper module.**

```js
// Shared helpers for custom fields (definitions + values). Pure functions.
export function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';
}
export function makeUniqueSlug(name, existingSlugs = []) {
  const base = slugify(name);
  const set = new Set(existingSlugs);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}
export function valueSlug(field, value) {
  if (field.type === 'checkbox') return value ? 'yes' : 'no';
  return slugify(String(value));
}
export function fieldValues(field) {
  if (field.type === 'checkbox') return [{ value: true, label: 'Yes', slug: 'yes' }, { value: false, label: 'No', slug: 'no' }];
  return (field.options || []).map((o) => ({ value: o, label: o, slug: slugify(o) }));
}
export function fieldsFor(settings, entity) {
  return (settings?.customFields || []).filter((f) => f.entity === entity);
}
export function matchesFilter(record, field, filterValue) {
  if (!filterValue || filterValue === '__any__') return true;
  const v = (record.custom || {})[field.id];
  if (field.type === 'checkbox') return (v ? 'yes' : 'no') === filterValue;
  return String(v ?? '') === String(filterValue);
}
```

- [ ] **Step 2: Verify the pure logic** with a node check (uses esbuild-free dynamic import of the ESM file via a tiny inline test):

```bash
cd "C:/Users/aaron/projects/Finance agent/mmm-app" && node --input-type=module -e "
import { slugify, makeUniqueSlug, valueSlug, matchesFilter } from './src/lib/customFields.js';
console.log(slugify('Trip Name!') === 'trip_name', 'slugify');
console.log(makeUniqueSlug('Trip', ['trip']) === 'trip_2', 'uniqueSlug');
console.log(valueSlug({type:'checkbox'}, true) === 'yes', 'valueSlug cb');
console.log(matchesFilter({custom:{f1:'Business'}}, {id:'f1',type:'select'}, 'Business') === true, 'filter select');
console.log(matchesFilter({custom:{f2:true}}, {id:'f2',type:'checkbox'}, 'yes') === true, 'filter cb');
"
```
Expected: five `true <label>` lines.

- [ ] **Step 3: Commit (if approved).** Suggested: `feat(money): custom-field client helpers`.

---

### Task 3: Formula aggregates in `getMetrics`

**Files:**
- Modify: `server/money/store.js` (`getMetrics`)

**Interfaces:**
- Consumes: `settings.customFields` (via `repo.getSettings(db())` — already used by `getCurrencyConfig`), the `custom` values from Task 1.
- Produces: `getMetrics()` output additionally contains, per field value, `cf_<slug>_<valueslug>_count` and `cf_<slug>_<valueslug>_sum`. These automatically become variables in the custom-metric widget's picker.

- [ ] **Step 1: Add a server-side slug/valueSlug (mirror of Task 2, since store.js is CommonJS).** At the top of the metrics section in `server/money/store.js`, add:

```js
function cfSlug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field'; }
function cfValues(field) {
  if (field.type === 'checkbox') return [{ v: true, s: 'yes' }, { v: false, s: 'no' }];
  return (field.options || []).map((o) => ({ v: o, s: cfSlug(o) }));
}
```

- [ ] **Step 2: Emit the aggregates inside `getMetrics`.** Just before `getMetrics` returns its object, compute custom-field aggregates and merge them in:

```js
  // Custom-field aggregates: cf_<slug>_<value>_count / _sum
  const settings = repo.getSettings(db()) || {};
  const cf = {};
  for (const field of settings.customFields || []) {
    const rows = field.entity === 'transaction' ? transactions
      : field.entity === 'account' ? accounts
      : field.entity === 'goal' ? (data.goals || []) : [];
    const amountOf = field.entity === 'transaction' ? (r) => parseFloat(r.amount) || 0
      : field.entity === 'account' ? (r) => parseFloat(r.balance) || 0
      : (r) => parseFloat(r.target) || 0;
    for (const { v, s } of cfValues(field)) {
      let count = 0, sum = 0;
      for (const r of rows) {
        const rv = (r.custom || {})[field.id];
        const hit = field.type === 'checkbox' ? (!!rv === v) : (String(rv ?? '') === String(v));
        if (hit) { count++; sum += amountOf(r); }
      }
      const fslug = field.slug || cfSlug(field.name); // use the stored unique slug so trip_2 ≠ trip
      cf[`cf_${fslug}_${s}_count`] = count;
      cf[`cf_${fslug}_${s}_sum`] = round(sum);
    }
  }
```
Then spread `...cf` into the returned metrics object (after the existing keys). `round`, `transactions`, `accounts`, `data` are already in scope in `getMetrics`.

- [ ] **Step 3: Verify.** Restart server. Seed a field def into settings + set a value, then check `/metrics`:

```bash
cd "C:/Users/aaron/projects/Finance agent/mmm-app" && node -e "
(async()=>{
  const S='http://127.0.0.1:5006/api/settings', M='http://127.0.0.1:5006/api/money';
  await fetch(S,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({customFields:[{id:'cf_test',entity:'transaction',name:'Reimbursable',slug:'reimbursable',type:'checkbox'}]})});
  const t=(await (await fetch(M+'/transactions')).json()).transactions[0];
  await fetch(M+'/transactions/'+t.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({custom:{cf_test:true}})});
  const m=(await (await fetch(M+'/metrics')).json()).metrics;
  console.log('count:', m.cf_reimbursable_yes_count, '| sum:', m.cf_reimbursable_yes_sum);  // expect count>=1
  await fetch(S,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({customFields:[]})}); // cleanup defs
})().catch(e=>console.log('ERR',e.message));
"
```
Expected: `count: 1 | sum: <the txn amount>`. Then re-seed to reset the test value.

- [ ] **Step 4: Commit (if approved).** Suggested: `feat(money): expose custom-field count/sum aggregates in metrics`.

---

### Task 4: Custom Fields manager in Settings

**Files:**
- Create: `src/components/money/sections/CustomFieldsManager.jsx`
- Modify: `src/components/money/sections/Settings.jsx` (mount it)

**Interfaces:**
- Consumes: `useApi('settings')` for `customFields`; `saveSettings` + `queryClient` from `lib/query`; `makeUniqueSlug` from `lib/customFields`.
- Produces: persisted `settings.customFields` entries `{ id, entity, name, slug, type, options? }` where `id = 'cf_' + <random>`.

- [ ] **Step 1: Write the manager component.**

```jsx
import { useState } from 'react';
import { Plus, Trash2, Tag } from 'lucide-react';
import { useApi, saveSettings, queryClient } from '../../../lib/query';
import { makeUniqueSlug } from '../../../lib/customFields';

const ENTITIES = [{ id: 'transaction', label: 'Transactions' }, { id: 'goal', label: 'Goals' }, { id: 'account', label: 'Accounts' }];
const BLANK = { name: '', entity: 'transaction', type: 'select', optionsText: '' };

export default function CustomFieldsManager() {
  const { data: settings } = useApi('settings');
  const fields = settings?.customFields || [];
  const [form, setForm] = useState(BLANK);

  function persist(next) {
    saveSettings({ customFields: next }).then((s) => queryClient.setQueryData(['settings'], s)).catch(() => {});
  }
  function addField() {
    if (!form.name.trim()) return;
    const slug = makeUniqueSlug(form.name, fields.map((f) => f.slug));
    const field = {
      id: 'cf_' + Math.random().toString(36).slice(2, 10),
      entity: form.entity, name: form.name.trim(), slug, type: form.type,
      ...(form.type === 'select' ? { options: form.optionsText.split(',').map((o) => o.trim()).filter(Boolean) } : {}),
    };
    persist([...fields, field]);
    setForm(BLANK);
  }
  function removeField(id) { persist(fields.filter((f) => f.id !== id)); }

  return (
    <div className="m-card m-card-no-hover" style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--m-ink)' }}>Custom fields</div>
      <div style={{ fontSize: 13, color: 'var(--m-ink-2)', marginTop: 2, marginBottom: 16 }}>
        Attach your own dropdown or yes/no fields to transactions, goals, and accounts. Filter by them and use them in custom-metric formulas.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: fields.length ? 16 : 4 }}>
        <input className="m-input" placeholder="Field name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ flex: '1 1 140px' }} />
        <select className="m-input" value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })} style={{ flex: '0 1 130px' }}>
          {ENTITIES.map((en) => <option key={en.id} value={en.id}>{en.label}</option>)}
        </select>
        <select className="m-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={{ flex: '0 1 120px' }}>
          <option value="select">Dropdown</option>
          <option value="checkbox">Yes / No</option>
        </select>
        {form.type === 'select' && (
          <input className="m-input" placeholder="Options: A, B, C" value={form.optionsText} onChange={(e) => setForm({ ...form, optionsText: e.target.value })} style={{ flex: '1 1 160px' }} />
        )}
        <button className="m-btn m-btn-primary m-btn-sm" onClick={addField} disabled={!form.name.trim()}><Plus size={14} style={{ marginRight: 4 }} /> Add</button>
      </div>

      {fields.length === 0 ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--m-border)', color: 'var(--m-muted)', fontSize: 13 }}>
          <Tag size={16} /> No custom fields yet.
        </div>
      ) : (
        <div>
          {fields.map((f) => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: '1px solid var(--m-border)' }}>
              <div style={{ fontSize: 13, color: 'var(--m-ink)' }}>
                <span style={{ fontWeight: 600 }}>{f.name}</span>
                <span style={{ color: 'var(--m-muted)', marginLeft: 8 }}>{ENTITIES.find((e) => e.id === f.entity)?.label} · {f.type === 'checkbox' ? 'Yes/No' : 'Dropdown'}{f.options?.length ? ` (${f.options.join(', ')})` : ''}</span>
              </div>
              <button onClick={() => removeField(f.id)} title="Delete field" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--m-muted)', display: 'flex', padding: 4 }}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount it in Settings.** In `src/components/money/sections/Settings.jsx`, import `CustomFieldsManager` and render `<CustomFieldsManager />` between `<RulesManager />` and the Privacy `<Section>`.

- [ ] **Step 3: Verify (browser).** Build, restart server, load `:5006`, go to Settings & Privacy. Add a Dropdown field "Purpose" (options `Business, Personal`) on Transaction and a Yes/No field "Reimbursable" on Transaction; add one field on Goal and one on Account. Confirm via:

```bash
node -e "fetch('http://127.0.0.1:5006/api/settings').then(r=>r.json()).then(s=>console.log('fields:',(s.customFields||[]).map(f=>f.entity+':'+f.name+':'+f.type).join(', ')))"
```
Expected: the fields you added, each with `slug` unique. Delete one in the UI and confirm it disappears from the list + from settings.

- [ ] **Step 4: Commit (if approved).** Suggested: `feat(money): custom-fields definitions manager in Settings`.

---

### Task 5: Custom-field value inputs in the three forms

**Files:**
- Create: `src/components/money/sections/parts/CustomFieldInputs.jsx`
- Modify: `src/components/money/sections/Transactions.jsx` (add form), `src/components/money/sections/Goals.jsx` (add/edit form), `src/components/money/sections/AccountsNetWorth.jsx` (add form)

**Interfaces:**
- Consumes: `fieldsFor(settings, entity)` from `lib/customFields`; `useApi('settings')`.
- Produces: `<CustomFieldInputs entity="transaction" value={customObj} onChange={setCustomObj} />` renders one control per defined field and calls `onChange(nextCustomObj)`. Each host form includes `custom` in its create/update payload.

- [ ] **Step 1: Write `CustomFieldInputs.jsx`.**

```jsx
import { useApi } from '../../../../lib/query';
import { fieldsFor, fieldValues } from '../../../../lib/customFields';

export default function CustomFieldInputs({ entity, value = {}, onChange }) {
  const { data: settings } = useApi('settings');
  const fields = fieldsFor(settings, entity);
  if (!fields.length) return null;
  const set = (id, v) => onChange({ ...value, [id]: v });
  return (
    <>
      {fields.map((f) => (
        <div key={f.id}>
          <label className="m-input-label">{f.name}</label>
          {f.type === 'checkbox' ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--m-ink-2)' }}>
              <input type="checkbox" checked={!!value[f.id]} onChange={(e) => set(f.id, e.target.checked)} /> Yes
            </label>
          ) : (
            <select className="m-input" value={value[f.id] ?? ''} onChange={(e) => set(f.id, e.target.value)}>
              <option value="">—</option>
              {fieldValues(f).map((o) => <option key={o.slug} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 2: Wire into the Transactions add form.** In `Transactions.jsx`: add `custom` to the `addForm` state (`custom: {}`); render `<CustomFieldInputs entity="transaction" value={addForm.custom} onChange={(c) => setAddForm({ ...addForm, custom: c })} />` inside the add-form grid; include `custom: addForm.custom` in the POST payload in `handleAddTransaction`; reset `custom: {}` when the form resets.

- [ ] **Step 3: Wire into Goals and Accounts forms** the same way (add `custom` to each form's state, render `<CustomFieldInputs entity="goal"|"account" .../>`, include `custom` in the create payload, reset on submit). For edit forms that exist (accounts/goals), seed the form's `custom` from the record being edited.

- [ ] **Step 4: Verify (browser).** Build + restart + reload. In Transactions → Add, the "Purpose" dropdown and "Reimbursable" checkbox appear; add a transaction with values set; confirm persisted:

```bash
node -e "fetch('http://127.0.0.1:5006/api/money/transactions').then(r=>r.json()).then(d=>{const t=d.transactions.find(x=>Object.keys(x.custom||{}).length);console.log('a txn with custom:', t?JSON.stringify(t.custom):'none')})"
```
Expected: a transaction whose `custom` has your field ids → values. Repeat the visual check on Goals and Accounts forms.

- [ ] **Step 5: Commit (if approved).** Suggested: `feat(money): custom-field value inputs in transaction/goal/account forms`.

---

### Task 6: Custom-field filters in the three sections

**Files:**
- Create: `src/components/money/sections/parts/CustomFieldFilters.jsx`
- Modify: `Transactions.jsx`, `Goals.jsx`, `AccountsNetWorth.jsx` (filter bars + apply predicate)

**Interfaces:**
- Consumes: `fieldsFor`, `fieldValues`, `matchesFilter` from `lib/customFields`.
- Produces: `<CustomFieldFilters entity value onChange />` renders a value `<select>` per field (`Any` + each value). Parent keeps a `cfFilters` map `{ [fieldId]: '__any__' | value }` and filters its records with `fields.every(f => matchesFilter(rec, f, cfFilters[f.id]))`.

- [ ] **Step 1: Write `CustomFieldFilters.jsx`.**

```jsx
import { useApi } from '../../../../lib/query';
import { fieldsFor, fieldValues } from '../../../../lib/customFields';

export default function CustomFieldFilters({ entity, value = {}, onChange }) {
  const { data: settings } = useApi('settings');
  const fields = fieldsFor(settings, entity);
  if (!fields.length) return null;
  return (
    <>
      {fields.map((f) => (
        <div key={f.id}>
          <label className="m-input-label">{f.name}</label>
          <select className="m-input" value={value[f.id] ?? '__any__'} onChange={(e) => onChange({ ...value, [f.id]: e.target.value })}>
            <option value="__any__">Any</option>
            {fieldValues(f).map((o) => <option key={o.slug} value={f.type === 'checkbox' ? o.slug : o.value}>{o.label}</option>)}
          </select>
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 2: Wire into Transactions.** Add `cfFilters` state (`{}`); render `<CustomFieldFilters entity="transaction" value={cfFilters} onChange={setCfFilters} />` inside the existing filter grid; extend the `filteredTransactions` predicate with `fieldsFor(settings,'transaction').every(f => matchesFilter(txn, f, cfFilters[f.id]))` (import `matchesFilter`, `fieldsFor`, and read `settings` via `useApi('settings')`).

- [ ] **Step 3: Wire into Goals and Accounts.** Add a lightweight filter bar (a `.m-card-sm` row) to each if none exists, with `<CustomFieldFilters entity="goal"|"account" .../>`, and apply the same `.every(matchesFilter)` predicate to the rendered list.

- [ ] **Step 4: Verify (browser).** Build + restart + reload. With a couple of transactions tagged, set the "Purpose" filter to `Business` and confirm the ledger narrows to matching rows; set back to `Any`. Repeat for a Goal/Account field. (Visual verification via chrome-devtools: count `tbody tr` / cards before and after.)

- [ ] **Step 5: Commit (if approved).** Suggested: `feat(money): custom-field filters in transactions/goals/accounts`.

---

### Task 7: Per-widget settings schema + application

**Files:**
- Create: `src/components/money/widgets/settings.js`
- Modify: `src/components/money/widgets/index.jsx` (widgets accept + apply `config`)

**Interfaces:**
- Produces:
  - `WIDGET_SETTINGS` (in `settings.js`): `{ [widgetId]: Array<{ key, type, label }> }` where `type ∈ 'count'|'categories'|'accounts'|'timeframe'`.
  - Each widget component accepts a `config` prop (`{ count?, categories?, accounts?, timeframe? }`) and applies it, defaulting to today's hardcoded values.

- [ ] **Step 1: Declare the per-widget schema.**

```js
// Which settings each dashboard widget supports. Consumed by WidgetSettingsPopover.
export const WIDGET_SETTINGS = {
  netWorthTrend:      [{ key: 'timeframe', type: 'timeframe', label: 'Timeframe' }],
  budgets:            [{ key: 'count', type: 'count', label: 'Rows' }, { key: 'categories', type: 'categories', label: 'Categories' }],
  goals:              [{ key: 'count', type: 'count', label: 'Rows' }],
  accounts:           [{ key: 'count', type: 'count', label: 'Rows' }, { key: 'accounts', type: 'accounts', label: 'Accounts' }],
  recentTransactions: [{ key: 'count', type: 'count', label: 'Rows' }, { key: 'categories', type: 'categories', label: 'Categories' }, { key: 'accounts', type: 'accounts', label: 'Accounts' }],
};
export const TIMEFRAMES = [{ id: '30d', label: '30d' }, { id: '90d', label: '90d' }, { id: 'all', label: 'All' }];
```

- [ ] **Step 2: Apply `config` in the list widgets.** In `widgets/index.jsx`, give `Budgets`, `Goals`, `Accounts`, `RecentTransactions` a `config = {}` prop. Replace hardcoded `.slice(0, N)` with `.slice(0, config.count ?? N)`, and where `config.categories`/`config.accounts` are non-empty, filter the fetched rows first. Example (RecentTransactions):

```jsx
function RecentTransactions({ config = {} }) {
  const { data, isLoading } = useApi('money/transactions');
  if (isLoading) return <Loading />;
  let items = data?.transactions || [];
  if (config.categories?.length) items = items.filter((t) => config.categories.includes(t.category_id));
  if (config.accounts?.length) items = items.filter((t) => config.accounts.includes(t.account_id));
  items = items.slice(0, config.count ?? 6);
  // …existing render…
}
```
Apply the analogous change to `Budgets` (filter `budgetStatus` by `config.categories` on `category_id`, slice by `config.count ?? 4`), `Goals` (`slice(0, config.count ?? 4)`), `Accounts` (filter by `config.accounts` on `id`, slice by `config.count ?? 6`).

- [ ] **Step 3: Apply `timeframe` in `NetWorthTrend`.** Give it `config = {}`. For `config.timeframe === '90d'` or `'all'`, fetch `useApi('money/networth')` (full snapshot history) and window it (`90d` → snapshots within 90 days; `all` → all), else keep the current `useApi('money/overview')` 30-day slice. Map to `{ date, net }` the same way.

- [ ] **Step 4: Verify (browser).** Build + restart + reload. Temporarily pass a config to confirm application via the console (before the gear exists):

```bash
# In chrome-devtools evaluate_script, confirm a widget respects a count by checking rendered rows after Task 8 wires config; for now just confirm the build is green and widgets still render with defaults.
```
Expected: dashboard renders unchanged with defaults (no regressions). Full behavior is verified in Task 8.

- [ ] **Step 5: Commit (if approved).** Suggested: `feat(money): widgets accept per-instance config`.

---

### Task 8: Widget settings gear + popover + persistence

**Files:**
- Create: `src/components/money/widgets/WidgetSettingsPopover.jsx`
- Modify: `src/components/money/sections/Overview.jsx` (gear on each card, pass `config`, persist `widgetConfig`)

**Interfaces:**
- Consumes: `WIDGET_SETTINGS`/`TIMEFRAMES` from `widgets/settings.js`; `useApi('money/categories')`, `useApi('money/accounts')` for the multi-selects; `saveSettings`/`queryClient`.
- Produces: `settings.dashboards.overview.widgetConfig[widgetId]` persisted; each widget rendered with `config={widgetConfig[item.i]}`.

- [ ] **Step 1: Write `WidgetSettingsPopover.jsx`.**

```jsx
import { useApi } from '../../../lib/query';
import { WIDGET_SETTINGS, TIMEFRAMES } from './settings';

function MultiSelect({ items, selected = [], onToggle }) {
  return (
    <div style={{ maxHeight: 120, overflow: 'auto', display: 'grid', gap: 4 }}>
      {items.map((it) => (
        <label key={it.id} className="m-no-drag" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--m-ink-2)', cursor: 'pointer' }}>
          <input type="checkbox" className="m-no-drag" checked={selected.includes(it.id)} onChange={() => onToggle(it.id)} /> {it.name}
        </label>
      ))}
    </div>
  );
}

export default function WidgetSettingsPopover({ widgetId, config = {}, onChange }) {
  const schema = WIDGET_SETTINGS[widgetId];
  const { data: cats } = useApi('money/categories');
  const { data: accs } = useApi('money/accounts');
  if (!schema) return null;
  const set = (k, v) => onChange({ ...config, [k]: v });
  const toggle = (k, id) => {
    const cur = config[k] || [];
    set(k, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  return (
    <div className="m-no-drag" style={{ position: 'absolute', top: 34, right: 8, zIndex: 30, background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 10, boxShadow: 'var(--m-shadow)', padding: 12, minWidth: 200, display: 'grid', gap: 12 }}>
      {schema.map((s) => (
        <div key={s.key}>
          <div style={{ fontSize: 11, color: 'var(--m-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{s.label}</div>
          {s.type === 'count' && (
            <input className="m-input m-no-drag" type="number" min="1" max="20" value={config.count ?? ''} placeholder="default"
              onChange={(e) => set('count', e.target.value === '' ? undefined : Math.max(1, parseInt(e.target.value, 10) || 1))} style={{ padding: '4px 8px', fontSize: 13 }} />
          )}
          {s.type === 'timeframe' && (
            <div style={{ display: 'flex', gap: 4 }}>
              {TIMEFRAMES.map((t) => (
                <button key={t.id} className="m-no-drag" onClick={() => set('timeframe', t.id)}
                  style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--m-border)',
                    background: (config.timeframe || '30d') === t.id ? 'var(--m-accent)' : 'var(--m-surface-2)',
                    color: (config.timeframe || '30d') === t.id ? '#fff' : 'var(--m-ink-2)' }}>{t.label}</button>
              ))}
            </div>
          )}
          {s.type === 'categories' && <MultiSelect items={(cats?.categories || [])} selected={config.categories} onToggle={(id) => toggle('categories', id)} />}
          {s.type === 'accounts' && <MultiSelect items={(accs?.accounts || [])} selected={config.accounts} onToggle={(id) => toggle('accounts', id)} />}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add the gear + config plumbing in Overview.** In `Overview.jsx`:
  - Read `widgetConfig = settings?.dashboards?.overview?.widgetConfig || {}`.
  - Track `openGear` (widget id | null) state.
  - On each widget card header, render a gear button (`className="m-no-drag"`, `<Settings size={13}/>` from lucide) **always visible** (not gated on edit mode) that toggles `openGear`.
  - When `openGear === item.i` and the widget has settings, render `<WidgetSettingsPopover widgetId={item.i} config={widgetConfig[item.i] || {}} onChange={(next) => persistWidgetConfig(item.i, next)} />`.
  - `persistWidgetConfig(id, next)`: debounced (reuse the existing `saveTimer` pattern) → `saveSettings({ dashboards: { ...(settings.dashboards||{}), overview: { ...(settings.dashboards?.overview||{}), layout, widgetConfig: { ...widgetConfig, [id]: next } } } })` → `queryClient.setQueryData(['settings'], s)`.
  - Pass `config={widgetConfig[item.i]}` into `<Body />`.

- [ ] **Step 3: Verify (browser).** Build + restart + reload Overview. Click the gear on **Recent Transactions**, set Rows = 3 and pick one account; confirm the widget updates live. Reload the page (ignoreCache) and confirm the widget still shows the configured view (persistence). Confirm via:

```bash
node -e "fetch('http://127.0.0.1:5006/api/settings').then(r=>r.json()).then(s=>console.log('widgetConfig:', JSON.stringify(s?.dashboards?.overview?.widgetConfig||{})))"
```
Expected: `widgetConfig` contains `recentTransactions: { count: 3, accounts: [...] }`. Test the trend timeframe gear (`90d`/`all`) too. Check dark + light.

- [ ] **Step 4: Reset to clean demo state** (clear the test widgetConfig if desired) and confirm no console errors.

- [ ] **Step 5: Commit (if approved).** Suggested: `feat(money): per-widget settings gear + popover with persistence`.

---

## Final verification (whole feature)

- [ ] Full walkthrough per the spec's Verification section: create a select + checkbox field on each of the 3 entities (manager + inline), set values in each form, filter each section, confirm `cf_*_count`/`_sum` appear and compute in a custom-metric widget, configure every configurable widget's gear and confirm persistence across reload, in dark + light.
- [ ] Re-seed sample data to leave a clean demo state.
- [ ] (When Aaron asks) rebuild the portable `MMM.exe` via the documented repackage flow so the standalone app carries these features.
