# MMM v3 Phase 0 — Land & Fix + Runway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the uncommitted Jul-9 recurring auto-post work safely (tests, silent-truncation fix, "bills posted while away" toast, memoized Cash Flow chart), fix the broken glossary/Term contract, add the runway headline widget, collapse the three Overview layout-healing flags into one `schemaVersion`, and clean repo hygiene — then ship a fresh `MMM.exe`.

**Architecture:** Pure logic goes into small tested modules (`server/money/runway.js`, `src/lib/incomeVsSpending.js`, `src/components/money/widgets/layoutMigrations.js`); routes/components stay thin. Every task ends with `npm test` green and a conventional commit. Nothing from NEXUS is touched in this phase.

**Tech Stack:** Node (CommonJS server), Express 4, better-sqlite3, React 18 JSX + Vite 5, recharts, react-grid-layout 1.5, vitest 3.

**Spec:** `C:\Users\aaron\.claude\plans\lets-make-a-plan-floating-pine.md` §5 "Phase 0" (+ §3 constraints).

## Global Constraints

- Money is integer cents in SQLite; the dollar↔cents boundary is `server/db/repo.js` only. Dates are compared as local `YYYY-MM-DD` strings; never `new Date(isoDate)` for day math.
- `schema.sql` is `CREATE TABLE IF NOT EXISTS`; new columns go through `applyAdditiveMigrations` in `server/db/connection.js`. No schema changes are needed in this phase.
- Tests: `npm test` (vitest, `tests/**/*.test.mjs`, temp `MMM_DATA_DIR` from `tests/setup.mjs`). Baseline on 2026-09-16: **82 passing**. Never lower that number.
- Commits: conventional messages, multi-line via stdin — `git commit -F - <<'EOF' … EOF` (never `-m` with a heredoc). Do not stage `.omc/`, `build/`, `src/dist/`.
- UI: `--m-*` tokens only; no `cursor:pointer` on cards; colour always paired with an icon/sign; interactive controls inside dashboard widgets need `className="m-no-drag"`.
- Build verify: `npx vite build src -c vite.config.mjs` in the FOREGROUND (read `VITE_EXIT`); `npm run build:portable` for the exe. Background server processes die when a Claude turn ends.

---

### Task 1: Hygiene + commit the Jul-9 feature as a checkpoint

**Files:**
- Modify: `.gitignore`
- Modify (untrack only): `.omc/**` (11 tracked files)
- Commit: the 13 dirty source files listed by `git status --short`

**Interfaces:**
- Produces: a clean checkpoint commit `feat: recurring auto-post, daily expense entry, income-vs-spending chart` on top of `b87172f`; `.omc/` is gitignored so later `git add -A` never picks up agent scratch.

- [ ] **Step 1: Ignore and untrack agent scratch**

Append to `.gitignore` (after the `tmp-esb/` line):

```
# Claude Code / OMC agent state
.omc/
```

Run:
```bash
cd "/c/Users/aaron/projects/Finance agent/mmm-app"
git rm -r --cached .omc
git status --short | grep -c '^D  .omc'
```
Expected: `11` (all `.omc` files now staged as deletions from the index; the files stay on disk).

- [ ] **Step 2: Confirm tests still pass on the dirty tree**

Run: `npm test 2>&1 | tail -6`
Expected: `Tests  82 passed (82)`

- [ ] **Step 3: Commit the feature checkpoint**

```bash
git add .gitignore server/db/connection.js server/db/repo.js server/db/schema.sql server/index.js server/middleware/validators.js server/money/calc.js server/money/routes.js server/money/store.js src/components/money/MoneyHub.jsx src/components/money/sections/Budget.jsx src/components/money/sections/CashFlow.jsx src/components/money/sections/parts/goals/EmergencyFundWidget.jsx tests/store.test.mjs
git commit -F - <<'EOF'
feat: recurring auto-post, daily expense entry, income-vs-spending chart

- recurring.account_id (additive migration) — due items auto-post as real
  transactions on launch and on Cash Flow mount (POST /recurring/post-due)
- computeGoalInsights folds recurring into monthly income/expenses
- Cash Flow: daily expense quick-entry + Income vs Spending chart
- Budget create-dialog renders in the empty state; EmergencyFundWidget
  shows a prompt instead of $X / $0
- .omc/ agent state untracked and ignored
EOF
git log --oneline -1
```
Expected: one new commit above `b87172f`; `git status --short` shows nothing tracked as modified.

---

### Task 2: Tests for `computeGoalInsights(accounts, transactions, recurring)`

**Files:**
- Test: `tests/calc.test.mjs` (append a new `describe`)
- Reference (no change): `server/money/calc.js:232-298`

**Interfaces:**
- Consumes: `store.computeGoalInsights(accounts, transactions, recurring)` (re-exported from `server/money/store.js`; signature already exists). Transactions use dollar amounts and `date` strings; `recurring` items are `{kind:'income'|'bill', amount, cadence:'weekly'|'biweekly'|'monthly'}`.

- [ ] **Step 1: Write the failing-if-wrong characterization tests**

Append to `tests/calc.test.mjs`:

```js
describe('computeGoalInsights with recurring', () => {
  const liquid = [{ type: 'checking', balance: 6000 }];

  it('normalizes weekly and biweekly recurring to a monthly figure', () => {
    const insights = store.computeGoalInsights(liquid, [], [
      { kind: 'bill', amount: 100, cadence: 'weekly' },    // 433.33/mo
      { kind: 'bill', amount: 200, cadence: 'biweekly' },  // 433.33/mo
      { kind: 'bill', amount: 50, cadence: 'monthly' },    // 50/mo
    ]);
    expect(insights.emergencyFund.monthlyExpenses).toBeCloseTo(916.67, 1);
    expect(insights.emergencyFund.targetAmount).toBeCloseTo(5500, 0); // 6 months
  });

  it('takes the max of actual and recurring so a posted bill is not double counted', () => {
    // 60 days of actuals: $2,400 spent => $1,200/mo. Recurring says $1,000/mo.
    const txns = [
      { amount: -1200, date: daysAgo(10) },
      { amount: -1200, date: daysAgo(40) },
      { amount: 5000, date: daysAgo(5) },
    ];
    const insights = store.computeGoalInsights(liquid, txns, [{ kind: 'bill', amount: 1000, cadence: 'monthly' }]);
    expect(insights.emergencyFund.monthlyExpenses).toBe(1200); // not 2200
  });

  it('recurring income raises monthlyIncome when actuals are thin', () => {
    const insights = store.computeGoalInsights(
      liquid,
      [{ amount: -500, date: daysAgo(3) }],
      [{ kind: 'income', amount: 3000, cadence: 'monthly' }, { kind: 'bill', amount: 500, cadence: 'monthly' }]
    );
    // fire.yearsToFire only becomes a number when monthlySavings > 0 (3000 - 500)
    expect(insights.fire.yearsToFire).not.toBeNull();
  });

  it('reports 0 months covered (not a division fallback) when there are no expenses', () => {
    const insights = store.computeGoalInsights(liquid, [], []);
    expect(insights.emergencyFund.monthsCovered).toBe(0);
    expect(insights.emergencyFund.targetAmount).toBe(0);
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `npx vitest run tests/calc.test.mjs -t "computeGoalInsights with recurring" 2>&1 | tail -12`
Expected: 4 passed. (If `monthlyExpenses` differs slightly from 916.67, the `toBeCloseTo(…, 1)` tolerance is intentional — do not loosen further; investigate `perMonth` in `calc.js:246`.)

- [ ] **Step 3: Full suite + commit**

Run: `npm test 2>&1 | tail -4` → Expected: `86 passed`.

```bash
git add tests/calc.test.mjs
git commit -F - <<'EOF'
test: characterize computeGoalInsights recurring normalization and max-of rule
EOF
```

---

### Task 3: Auto-post truncation is reported, runs off the startup path, and toasts on launch

**Files:**
- Modify: `server/money/store.js:289-318` (`postDueRecurring`), add `getLastAutopost`/`setLastAutopost`
- Modify: `server/db/repo.js` (add generic `getMeta`/`setMeta` near line 505)
- Modify: `server/index.js:82-92` (startup call), `server/money/routes.js` (`/recurring/post-due`, `/overview` response)
- Modify: `src/components/money/MoneyHub.jsx` (toast once per session), `src/components/money/sections/CashFlow.jsx:85` (use the object result)
- Test: `tests/store.test.mjs` (`recurring auto-post to transactions` describe)

**Interfaces:**
- Produces: `store.postDueRecurring() → { posted: number, truncated: Array<{ id, payee, remaining: number }> }`; `store.getLastAutopost() → { at: ISOString, posted, truncated } | null`; `repo.getMeta(d, key) → any|null`, `repo.setMeta(d, key, value)`; `GET /api/money/overview` gains `lastAutopost`.
- Consumers must switch from `expect(posted).toBe(n)` to `expect(result.posted).toBe(n)`.

- [ ] **Step 1: Update existing tests to the object contract and add the stale-item test**

In `tests/store.test.mjs`, inside `describe('recurring auto-post to transactions')`, change every `store.postDueRecurring()` assertion:

```js
    const posted = store.postDueRecurring().posted;   // was: store.postDueRecurring()
    expect(posted).toBe(1);
```
```js
    expect(store.postDueRecurring().posted).toBe(1);
    expect(store.postDueRecurring().posted).toBe(0); // nothing due now
```
```js
    const posted = store.postDueRecurring().posted; // -21, -14, -7, 0 => 4 posts
```
```js
    expect(store.postDueRecurring().posted).toBe(0);
```
(both `skips items…` and `does not post…` cases)

Then append inside the same `describe`:

```js
  it('caps catch-up per item, reports the truncation, and continues on the next call', () => {
    const acc = store.createAccount('Checking', 'checking', 0);
    // ~2 years of missed weekly bills = 105 periods; cap is 100 per call.
    const r = store.createRecurring({ payee: 'Stale', amount: 1, cadence: 'weekly', kind: 'bill', next_date: ymd(-7 * 104), account_id: acc.id });

    const first = store.postDueRecurring();
    expect(first.posted).toBe(100);
    expect(first.truncated).toEqual([{ id: r.id, payee: 'Stale', remaining: 5 }]);

    const second = store.postDueRecurring();
    expect(second.posted).toBe(5);
    expect(second.truncated).toEqual([]);
    expect(store.getTransactions()).toHaveLength(105);
  });

  it('records the last auto-post result in meta', () => {
    const acc = store.createAccount('Checking', 'checking', 0);
    store.createRecurring({ payee: 'Rent', amount: 10, cadence: 'monthly', kind: 'bill', next_date: ymd(-1), account_id: acc.id });
    store.postDueRecurring();
    const last = store.getLastAutopost();
    expect(last.posted).toBe(1);
    expect(last.truncated).toEqual([]);
    expect(typeof last.at).toBe('string');
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run tests/store.test.mjs -t "auto-post" 2>&1 | tail -15`
Expected: FAIL — `posted` is `undefined` (function still returns a number) and `store.getLastAutopost is not a function`.

- [ ] **Step 3: Add generic meta helpers to the repo layer**

In `server/db/repo.js`, directly above the `// ── user settings (meta['settings'])` comment (line ~505), add:

```js
// ── generic meta (small JSON blobs keyed by name) ───────────────────────────
function getMeta(d, key) {
  const row = d.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

function setMeta(d, key, value) {
  d.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}
```
and add `getMeta, setMeta,` to the `module.exports` object at the bottom of `repo.js`.

- [ ] **Step 4: Rewrite `postDueRecurring` and add the meta accessors in `store.js`**

Replace lines 289-318 of `server/money/store.js` with:

```js
// Per-item cap on catch-up posts per call. A stale item (e.g. a weekly bill
// two years old) posts up to this many rows, is reported in `truncated`, and
// finishes on the next launch instead of silently stopping short.
const AUTOPOST_CAP = 100;

// Auto-post every recurring item whose next_date has arrived into a real
// transaction on its linked account, catching up each missed period. Advancing
// next_date past today is the idempotency guard — safe to call repeatedly (on
// each app launch). Items without an account_id are skipped (forecast-only).
function postDueRecurring() {
  const today = ymd(new Date());
  const items = repo.getRecurring(db());
  let posted = 0;
  const truncated = [];

  for (const r of items) {
    if (!r.account_id || !r.next_date) continue;
    if (!repo.getAccount(db(), r.account_id)) continue; // account deleted — skip

    let next = String(r.next_date).slice(0, 10);
    const original = next;
    let count = 0;

    while (next <= today && count < AUTOPOST_CAP) {
      const amount = r.kind === 'income' ? Math.abs(r.amount) : -Math.abs(r.amount);
      createTransaction(r.account_id, next, amount, r.payee, null, [], 'Auto-posted from recurring', 'recurring');
      next = advanceDate(next, r.cadence);
      posted += 1;
      count += 1;
    }

    if (next <= today) {
      // Count what is still owed without posting it.
      let remaining = 0;
      let probe = next;
      while (probe <= today && remaining < 100000) { probe = advanceDate(probe, r.cadence); remaining += 1; }
      truncated.push({ id: r.id, payee: r.payee, remaining });
      console.warn(`[MMM recurring] truncated catch-up for "${r.payee}" — ${remaining} period(s) still due, will continue next launch`);
    }

    if (next !== original) repo.updateRecurring(db(), r.id, { next_date: next });
  }

  const result = { posted, truncated };
  repo.setMeta(db(), 'last_autopost', { at: new Date().toISOString(), ...result });
  return result;
}

function getLastAutopost() {
  return repo.getMeta(db(), 'last_autopost');
}
```
Add `getLastAutopost,` next to `postDueRecurring,` in `module.exports` (line ~550).

- [ ] **Step 5: Run the store tests**

Run: `npx vitest run tests/store.test.mjs 2>&1 | tail -8`
Expected: all pass (24 in this file).

- [ ] **Step 6: Move the startup call off the listen callback and return the object from the route**

In `server/index.js`, replace lines 85-91 (the `try { const posted = … }` block) with:

```js
  // Post any recurring items that came due while the app was closed — after
  // /api/health is answerable, so a large catch-up never delays first paint.
  setImmediate(() => {
    try {
      const { posted, truncated } = require('./money/store').postDueRecurring();
      if (posted) console.log(`[MMM] auto-posted ${posted} recurring transaction(s)`);
      if (truncated.length) console.warn(`[MMM] ${truncated.length} recurring item(s) still have periods due`);
    } catch (e) {
      console.error('[MMM] recurring auto-post failed:', e.message);
    }
  });
```

In `server/money/routes.js`, the `/recurring/post-due` handler already does `res.json({ posted: store.postDueRecurring() })` — change it to:

```js
    res.json(store.postDueRecurring());
```

In the `/overview` handler, find the final `res.json({` object (it contains `netWorth`, `isEmpty`, `displayCurrency` …) and add one key:

```js
      lastAutopost: store.getLastAutopost(),
```

- [ ] **Step 7: Toast once per session in MoneyHub; keep Cash Flow's call working**

In `src/components/money/MoneyHub.jsx`, inside `refreshEmpty()` right after `const data = await api('money/overview');` add:

```js
      // "N bills posted while you were away" — once per app session per run.
      const last = data?.lastAutopost;
      if (last?.posted > 0) {
        let shown = null;
        try { shown = sessionStorage.getItem('mmm-autopost-shown'); } catch { /* private mode */ }
        if (shown !== last.at) {
          try { sessionStorage.setItem('mmm-autopost-shown', last.at); } catch { /* ignore */ }
          const n = last.posted;
          const extra = last.truncated?.length ? ` ${last.truncated.length} item(s) still have periods due — they post next launch.` : '';
          showToast(`Posted ${n} recurring ${n === 1 ? 'bill' : 'bills'} while you were away.${extra}`, 'info', 8000);
        }
      }
```
(`showToast` is already imported in `MoneyHub.jsx`.)

In `src/components/money/sections/CashFlow.jsx` line 85 the call is `try { await api('money/recurring/post-due', { method: 'POST' }); } catch { /* non-fatal */ }` — leave it; the response shape change is harmless there.

- [ ] **Step 8: Full suite, then commit**

Run: `npm test 2>&1 | tail -4` → Expected: `88 passed`.

```bash
git add server/db/repo.js server/money/store.js server/index.js server/money/routes.js src/components/money/MoneyHub.jsx tests/store.test.mjs
git commit -F - <<'EOF'
fix: report truncated recurring catch-up, run it off the startup path, toast on launch

postDueRecurring now returns {posted, truncated[]} with a per-item cap of 100,
records the result in meta.last_autopost, and continues on the next call.
Startup runs it via setImmediate so /api/health answers first. Overview
exposes lastAutopost; MoneyHub toasts once per session.
EOF
```

---

### Task 4: Memoize the Income-vs-Spending aggregation as a tested pure module and hatch projected months

**Files:**
- Create: `src/lib/incomeVsSpending.js`
- Create: `src/components/money/sections/parts/cashflow/IncomeVsSpendingCard.jsx`
- Modify: `src/components/money/sections/CashFlow.jsx` (remove lines 131-189 aggregation; use `useMemo`; render the card)
- Test: `tests/incomeVsSpending.test.mjs`

**Interfaces:**
- Produces: `computeIncomeVsSpending({ transactions, recurring, today }) → { rows: Array<{ month:'YYYY-MM', income, spending, projected:boolean }>, totals: { income, spending, net } }`. `today` is a `Date` (injectable for tests). Rows are the trailing 2 full months + current month through the 5th month ahead; `projected` is true for months after the current one.
- `<IncomeVsSpendingCard rows totals />` renders the existing card markup; projected bars use a hatched SVG pattern.

- [ ] **Step 1: Write the failing tests**

Create `tests/incomeVsSpending.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { computeIncomeVsSpending } from '../src/lib/incomeVsSpending.js';

const today = new Date(2026, 8, 16); // Sep 16 2026 (local)

describe('computeIncomeVsSpending', () => {
  it('buckets posted transactions by month and keeps two months of history', () => {
    const { rows } = computeIncomeVsSpending({
      today,
      recurring: [],
      transactions: [
        { date: '2026-06-30', amount: -100 },  // dropped: older than 2 months back
        { date: '2026-07-05', amount: 2000 },
        { date: '2026-07-20', amount: -400.4 },
        { date: '2026-09-01', amount: -50 },
      ],
    });
    expect(rows.map(r => r.month)).toEqual(['2026-07', '2026-09']);
    expect(rows[0]).toEqual({ month: '2026-07', income: 2000, spending: 400, projected: false });
    expect(rows[1].projected).toBe(false);
  });

  it('projects unlinked recurring from today and linked recurring strictly after today', () => {
    const { rows } = computeIncomeVsSpending({
      today,
      transactions: [],
      recurring: [
        { kind: 'bill', amount: 100, cadence: 'monthly', next_date: '2026-09-16' },                     // unlinked: counts today
        { kind: 'bill', amount: 1, cadence: 'monthly', next_date: '2026-09-16', account_id: 'acc1' },  // linked: skips today
      ],
    });
    const sep = rows.find(r => r.month === '2026-09');
    const oct = rows.find(r => r.month === '2026-10');
    expect(sep.spending).toBe(100);
    expect(oct.spending).toBe(101);
    expect(oct.projected).toBe(true);
  });

  it('stops at the end of the fifth month ahead and totals across rows', () => {
    const { rows, totals } = computeIncomeVsSpending({
      today,
      transactions: [],
      recurring: [{ kind: 'income', amount: 10, cadence: 'monthly', next_date: '2026-09-20' }],
    });
    expect(rows[rows.length - 1].month).toBe('2027-02');
    expect(rows).toHaveLength(6); // Sep..Feb
    expect(totals).toEqual({ income: 60, spending: 0, net: 60 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/incomeVsSpending.test.mjs 2>&1 | tail -6`
Expected: FAIL — cannot find module `../src/lib/incomeVsSpending.js`.

- [ ] **Step 3: Implement the pure module**

Create `src/lib/incomeVsSpending.js`:

```js
// Pure aggregation for the Cash Flow "Income vs Spending" chart. Posted
// transactions supply past/current months; recurring items supply projected
// occurrences from today (unlinked) or strictly after today (linked — their
// due dates already auto-posted). Dates are local-calendar.

const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function advance(d, cadence) {
  const nd = new Date(d);
  if (cadence === 'weekly') nd.setDate(nd.getDate() + 7);
  else if (cadence === 'biweekly') nd.setDate(nd.getDate() + 14);
  else nd.setMonth(nd.getMonth() + 1);
  return nd;
}

export function computeIncomeVsSpending({ transactions = [], recurring = [], today = new Date() }) {
  const byMonth = {};
  const addTo = (m, field, amt) => {
    if (!byMonth[m]) byMonth[m] = { month: m, income: 0, spending: 0 };
    byMonth[m][field] += amt;
  };

  for (const t of transactions) {
    const m = String(t.date).slice(0, 7);
    if (t.amount >= 0) addTo(m, 'income', t.amount);
    else addTo(m, 'spending', Math.abs(t.amount));
  }

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const horizon = new Date(today.getFullYear(), today.getMonth() + 6, 0); // last day of month+5
  for (const r of recurring) {
    if (!r.next_date) continue;
    const amt = Math.abs(parseFloat(r.amount) || 0);
    if (!amt) continue;
    const field = r.kind === 'income' ? 'income' : 'spending';
    const [y, mo, dd] = String(r.next_date).slice(0, 10).split('-').map(Number);
    let d = new Date(y, mo - 1, dd);
    let guard = 0;
    while (d < startOfToday && guard < 500) { d = advance(d, r.cadence); guard++; }
    if (r.account_id && d.getTime() === startOfToday.getTime()) d = advance(d, r.cadence);
    guard = 0;
    while (d <= horizon && guard < 500) { addTo(ym(d), field, amt); d = advance(d, r.cadence); guard++; }
  }

  const minMonth = ym(new Date(today.getFullYear(), today.getMonth() - 2, 1));
  const currentMonth = ym(today);
  const rows = Object.values(byMonth)
    .filter(r => r.month >= minMonth)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(r => ({ month: r.month, income: Math.round(r.income), spending: Math.round(r.spending), projected: r.month > currentMonth }));

  const income = rows.reduce((s, r) => s + r.income, 0);
  const spending = rows.reduce((s, r) => s + r.spending, 0);
  return { rows, totals: { income, spending, net: income - spending } };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/incomeVsSpending.test.mjs 2>&1 | tail -6` → Expected: 3 passed.

- [ ] **Step 5: Extract the card component with hatched projected bars**

Create `src/components/money/sections/parts/cashflow/IncomeVsSpendingCard.jsx` by moving the JSX of the existing "Income vs Spending" `<Card>` (CashFlow.jsx lines ~480-555: the title, subtitle, three totals, and the `<ResponsiveContainer>`), with these changes:

```jsx
import { DollarSign } from 'lucide-react';
import { BarChart, Bar, Cell, Legend, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Card from '../../../shared/Card';
import Money from '../../../shared/Money';

const monthShort = (m) => { const [y, mo] = String(m).split('-'); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'short' }); };
const monthLong = (m) => { const [y, mo] = String(m).split('-'); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); };

export default function IncomeVsSpendingCard({ rows, totals }) {
  if (!rows.length) return null;
  return (
    <Card className="m-card-sm" style={{ padding: '20px' }}>
      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '4px' }}>
        <DollarSign size={16} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'text-bottom' }} />
        Income vs Spending
      </div>
      <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginBottom: '16px' }}>
        Posted transactions · hatched months are projected from recurring
      </div>

      {/* keep the existing three-column totals block here, reading totals.income / totals.spending / totals.net */}

      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={rows}>
          <defs>
            <pattern id="ivsHatchGreen" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--m-green)" opacity="0.25" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--m-green)" strokeWidth="2" />
            </pattern>
            <pattern id="ivsHatchRed" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--m-red)" opacity="0.25" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--m-red)" strokeWidth="2" />
            </pattern>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" />
          <XAxis dataKey="month" stroke="var(--m-muted)" style={{ fontSize: '12px' }} tickFormatter={monthShort} />
          <YAxis stroke="var(--m-muted)" style={{ fontSize: '12px' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: '8px', color: 'var(--m-ink)' }}
            formatter={value => <Money value={value} prefix="$" decimals={0} />}
            labelFormatter={(m, payload) => `${monthLong(m)}${payload?.[0]?.payload?.projected ? ' (projected)' : ''}`}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Bar dataKey="income" name="Income" radius={[4, 4, 0, 0]}>
            {rows.map(r => <Cell key={r.month} fill={r.projected ? 'url(#ivsHatchGreen)' : 'var(--m-green)'} />)}
          </Bar>
          <Bar dataKey="spending" name="Spending" radius={[4, 4, 0, 0]}>
            {rows.map(r => <Cell key={r.month} fill={r.projected ? 'url(#ivsHatchRed)' : 'var(--m-red)'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
```

- [ ] **Step 6: Wire CashFlow.jsx**

In `src/components/money/sections/CashFlow.jsx`:
1. `import { useEffect, useMemo, useState } from 'react';` and `import { computeIncomeVsSpending } from '../../../lib/incomeVsSpending';` and `import IncomeVsSpendingCard from './parts/cashflow/IncomeVsSpendingCard';`
2. Delete the block from `// Income vs spending by month, COMBINING …` through `const totalNet = totalIncome - totalSpending;` (lines ~131-189).
3. In its place: `const ivs = useMemo(() => computeIncomeVsSpending({ transactions: txns, recurring }), [txns, recurring]);`
4. Replace the whole `{incomeVsSpending.length > 0 && ( <motion.div …> <Card …>…</Card> </motion.div> )}` block with:
```jsx
          {ivs.rows.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }} style={{ marginBottom: '24px' }}>
              <IncomeVsSpendingCard rows={ivs.rows} totals={ivs.totals} />
            </motion.div>
          )}
```
5. Remove `BarChart, Bar, Legend` from the recharts import if nothing else in the file uses them (grep first).

- [ ] **Step 7: Build to prove the JSX compiles, run all tests, commit**

Run: `npx vite build src -c vite.config.mjs 2>&1 | tail -3; echo VITE_EXIT=${PIPESTATUS[0]}` → Expected: `VITE_EXIT=0`.
Run: `npm test 2>&1 | tail -4` → Expected: `91 passed`.

```bash
git add src/lib/incomeVsSpending.js src/components/money/sections/parts/cashflow/IncomeVsSpendingCard.jsx src/components/money/sections/CashFlow.jsx tests/incomeVsSpending.test.mjs
git commit -F - <<'EOF'
refactor(cashflow): pure, memoized income-vs-spending aggregation with hatched projected months
EOF
```

---

### Task 5: Fix the glossary contract and add the Learn glossary stub

**Files:**
- Modify: `server/money/routes.js:861-874` (glossary route)
- Modify: `src/components/money/shared/Term.jsx` (whole file)
- Create: `src/components/money/sections/Learn.jsx`
- Modify: `src/components/money/MoneyHub.jsx` (`IMPORTERS`, `SECTIONS`, lucide import)
- Test: `tests/glossary-route.test.mjs`

**Interfaces:**
- Produces: `GET /api/money/glossary` → `{ terms: [{term, plain, more}] }` (unchanged); `GET /api/money/glossary?term=<name>` → `{ term, definition, more }` (case-insensitive exact match) or 404 `{ error }`. Route `#/learn` (section id `learn`) reads `?term=` to pre-filter.

- [ ] **Step 1: Write the failing route test**

Create `tests/glossary-route.test.mjs`:

```js
// Route-level test: mounts the money router on an ephemeral Express server.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import routes from '../server/money/routes.js';

let server; let base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/money', routes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/money`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('GET /glossary', () => {
  it('returns the full term list', async () => {
    const res = await fetch(`${base}/glossary`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.terms.length).toBeGreaterThan(40);
    expect(body.terms[0]).toHaveProperty('plain');
  });

  it('returns one definition for ?term= (case-insensitive)', async () => {
    const res = await fetch(`${base}/glossary?term=net%20worth`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.term).toBe('Net Worth');
    expect(body.definition).toMatch(/assets minus/i);
    expect(typeof body.more).toBe('string');
  });

  it('404s for an unknown term', async () => {
    const res = await fetch(`${base}/glossary?term=flux%20capacitor`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/glossary-route.test.mjs 2>&1 | tail -8`
Expected: the `?term=` test fails (`body.term` undefined) and the 404 test fails (200).

- [ ] **Step 3: Implement the route**

Replace the `router.get('/glossary', …)` handler in `server/money/routes.js` with:

```js
let _glossary = null; // static bundled JSON — read once, serve from memory
function loadGlossary() {
  if (!_glossary) {
    const path = require('path');
    const fs = require('fs');
    _glossary = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'store', 'money', 'glossary.json'), 'utf8'));
  }
  return _glossary;
}
router.get('/glossary', (req, res) => {
  try {
    const g = loadGlossary();
    const q = String(req.query.term || '').trim().toLowerCase();
    if (!q) return res.json(g);
    const hit = (g.terms || []).find(t => String(t.term).toLowerCase() === q);
    if (!hit) return res.status(404).json({ error: `No glossary entry for "${req.query.term}"` });
    res.json({ term: hit.term, definition: hit.plain, more: hit.more || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Run the route test** → Expected: 3 passed.

- [ ] **Step 5: Rewrite `Term.jsx` to fetch the map once and link to Learn**

Replace `src/components/money/shared/Term.jsx` with:

```jsx
import { useState, useEffect } from 'react';

// One fetch per app session; every <Term> looks up client-side.
let mapPromise = null;
function glossaryMap() {
  if (!mapPromise) {
    mapPromise = fetch('/api/money/glossary')
      .then(r => (r.ok ? r.json() : { terms: [] }))
      .then(data => new Map((data.terms || []).map(t => [String(t.term).toLowerCase(), t])))
      .catch(() => new Map());
  }
  return mapPromise;
}

export default function Term({ name, children, className = '' }) {
  const [entry, setEntry] = useState(undefined);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || entry !== undefined) return;
    glossaryMap().then(m => setEntry(m.get(String(name).toLowerCase()) || null));
  }, [open, entry, name]);

  return (
    <span className={`m-term ${className}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {children}
      {open && (
        <div className="m-term-tooltip">
          {entry === undefined ? (
            <div style={{ color: 'var(--m-muted)' }}>Loading…</div>
          ) : entry ? (
            <div>
              <div style={{ marginBottom: '6px' }}>{entry.plain}</div>
              {entry.more && <div style={{ marginBottom: '8px', color: 'var(--m-ink-2)', fontSize: '12px' }}>{entry.more}</div>}
              <a href={`#/learn?term=${encodeURIComponent(entry.term)}`} style={{ fontSize: '12px', color: 'var(--m-accent)', textDecoration: 'none', fontWeight: 600 }}>
                Learn more {String.fromCharCode(8594)}
              </a>
            </div>
          ) : (
            <div style={{ color: 'var(--m-muted)' }}>No definition available</div>
          )}
        </div>
      )}
    </span>
  );
}
```

- [ ] **Step 6: Create the Learn glossary stub section**

Create `src/components/money/sections/Learn.jsx`:

```jsx
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GraduationCap, Search } from 'lucide-react';
import SectionHeader from '../shared/SectionHeader';
import Card from '../shared/Card';
import { useApi } from '../../../lib/query';

export default function Learn() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('term') || '');
  const { data, isLoading } = useApi('money/glossary');
  const terms = data?.terms || [];
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return terms;
    return terms.filter(t => t.term.toLowerCase().includes(s) || t.plain.toLowerCase().includes(s));
  }, [terms, q]);

  return (
    <div>
      <SectionHeader icon={GraduationCap} title="Learn" subtitle="Glossary today. Lessons, reviews and programs arrive in a later build." />
      <div style={{ position: 'relative', maxWidth: 420, marginBottom: 16 }}>
        <Search size={16} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--m-muted)' }} />
        <input className="m-input" style={{ paddingLeft: 32 }} placeholder="Search terms…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
      </div>
      {isLoading ? (
        <div style={{ color: 'var(--m-muted)' }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {filtered.map(t => (
            <Card key={t.term} className="m-card-sm m-card-no-hover" style={{ padding: 16 }}>
              <div style={{ fontWeight: 600, color: 'var(--m-ink)', marginBottom: 4 }}>{t.term}</div>
              <div style={{ color: 'var(--m-ink-2)', fontSize: 14 }}>{t.plain}</div>
              {t.more && <div style={{ color: 'var(--m-muted)', fontSize: 13, marginTop: 6 }}>{t.more}</div>}
            </Card>
          ))}
          {!filtered.length && <div style={{ color: 'var(--m-muted)' }}>No terms match "{q}".</div>}
        </div>
      )}
    </div>
  );
}
```
Check `SectionHeader`'s props first (`grep -n "export default function SectionHeader" -A 5 src/components/money/shared/SectionHeader.jsx`) and adapt the prop names if they differ from `icon/title/subtitle`.

- [ ] **Step 7: Register the section**

In `src/components/money/MoneyHub.jsx`: add `GraduationCap` to the lucide import; add `learn: () => import('./sections/Learn'),` to `IMPORTERS`; add `{ id: 'learn', label: 'Learn', icon: GraduationCap },` to `SECTIONS` immediately before the `settings` entry.

- [ ] **Step 8: Build, test, commit**

Run: `npx vite build src -c vite.config.mjs 2>&1 | tail -3; echo VITE_EXIT=${PIPESTATUS[0]}` → `VITE_EXIT=0`.
Run: `npm test 2>&1 | tail -4` → `94 passed`.

```bash
git add server/money/routes.js src/components/money/shared/Term.jsx src/components/money/sections/Learn.jsx src/components/money/MoneyHub.jsx tests/glossary-route.test.mjs
git commit -F - <<'EOF'
fix(glossary): honour ?term=, make Term tooltips render, add Learn glossary section

GET /glossary?term= returns {term, definition, more}; Term.jsx fetches the
list once and looks up client-side (all 11 call sites now show text); the
"Learn more" link lands on the new #/learn section, a searchable glossary
that seeds the Phase 10 Learn build.
EOF
```

---

### Task 6: Runway headline — pure module, route, widget, evidence badge

**Files:**
- Create: `server/money/runway.js`
- Modify: `server/money/routes.js` (add `GET /runway`), `server/money/store.js` (export `computeRunway` wrapper)
- Create: `src/components/money/shared/Grade.jsx`
- Modify: `src/components/money/widgets/index.jsx` (new `runway` widget + `DEFAULT_LAYOUT`/`PRESETS`)
- Test: `tests/runway.test.mjs`

**Interfaces:**
- Produces: `computeRunway({ accounts, transactions, recurring, today }) → { liquid, monthlyBurn, burnSource:'actual'|'recurring'|'none', months, daysLeft, dateMoneyRunsOut:'YYYY-MM-DD'|null, band:'safe'|'tight'|'critical'|'unknown', largestOutflow:{payee, amount}|null, grade:'A'|'B'|'C', historyDays }` (dollars, not cents — inputs come from the store's dollar boundary). `GET /api/money/runway` returns it. `<Grade grade="A|B|C" />` renders a small badge with a title.

- [ ] **Step 1: Write the failing tests**

Create `tests/runway.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { computeRunway } from '../server/money/runway.js';

const today = new Date(2026, 8, 16); // Sep 16 2026
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };

const accounts = [
  { type: 'checking', balance: 3000 },
  { type: 'savings', balance: 2000 },
  { type: 'credit', balance: -400 },      // not liquid
  { type: 'brokerage', balance: 9000 },   // not liquid
];

describe('computeRunway', () => {
  it('uses trailing-90-day actual spend when it exceeds recurring bills', () => {
    const transactions = [
      { date: daysAgo(10), amount: -1500, payee: 'Rent' },
      { date: daysAgo(40), amount: -1500, payee: 'Rent' },
      { date: daysAgo(70), amount: -1500, payee: 'Rent' },
      { date: daysAgo(100), amount: -9999, payee: 'Old' },   // outside window
      { date: daysAgo(5), amount: 2000, payee: 'Income' },   // ignored
    ];
    const r = computeRunway({ accounts, transactions, recurring: [{ kind: 'bill', amount: 800, cadence: 'monthly' }], today });
    expect(r.liquid).toBe(5000);
    expect(r.monthlyBurn).toBe(1500);
    expect(r.burnSource).toBe('actual');
    expect(r.months).toBeCloseTo(3.33, 2);
    expect(r.daysLeft).toBe(100);                 // 5000 / (1500/30)
    expect(r.dateMoneyRunsOut).toBe('2026-12-25');
    expect(r.band).toBe('tight');
    expect(r.largestOutflow).toEqual({ payee: 'Rent', amount: 4500 });
    expect(r.grade).toBe('A');
    expect(r.historyDays).toBeGreaterThanOrEqual(70);
  });

  it('falls back to recurring bills (grade B) when history is thin', () => {
    const r = computeRunway({
      accounts, today,
      transactions: [{ date: daysAgo(2), amount: -20, payee: 'Coffee' }],
      recurring: [{ kind: 'bill', amount: 1000, cadence: 'monthly' }, { kind: 'bill', amount: 25, cadence: 'weekly' }],
    });
    expect(r.burnSource).toBe('recurring');
    expect(r.monthlyBurn).toBeCloseTo(1108.33, 1);
    expect(r.grade).toBe('B');
  });

  it('is unknown with no spend data and safe above six months', () => {
    expect(computeRunway({ accounts, transactions: [], recurring: [], today }).band).toBe('unknown');
    const r = computeRunway({ accounts, transactions: [{ date: daysAgo(1), amount: -100, payee: 'x' }], recurring: [], today });
    expect(r.band).toBe('safe'); // 5000 / 33.33 ≈ 150 months
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/runway.test.mjs` → cannot find module.

- [ ] **Step 3: Implement `server/money/runway.js`**

```js
// Runway: how long liquid cash lasts at the current burn. Pure; dollars in,
// dollars out; local-calendar dates. Evidence grade: A = >=60 days of real
// spend history drives the burn; B = burn imputed from recurring bills;
// C = nothing to go on.
const LIQUID_TYPES = new Set(['checking', 'savings', 'cash']);
const WINDOW_DAYS = 90;

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function perMonth(amount, cadence) {
  const a = Math.abs(parseFloat(amount) || 0);
  if (cadence === 'weekly') return a * 52 / 12;
  if (cadence === 'biweekly') return a * 26 / 12;
  return a;
}

function computeRunway({ accounts = [], transactions = [], recurring = [], today = new Date() } = {}) {
  const liquid = accounts
    .filter(a => LIQUID_TYPES.has(a.type))
    .reduce((s, a) => s + Math.max(0, parseFloat(a.balance) || 0), 0);

  const cutoffDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - WINDOW_DAYS);
  const cutoff = ymd(cutoffDate);
  const todayStr = ymd(today);
  const spend = transactions.filter(t => t.amount < 0 && String(t.date).slice(0, 10) >= cutoff && String(t.date).slice(0, 10) <= todayStr);
  const actualTotal = spend.reduce((s, t) => s + Math.abs(parseFloat(t.amount) || 0), 0);
  const actualMonthly = actualTotal / 3;

  let historyDays = 0;
  if (spend.length) {
    const oldest = spend.reduce((m, t) => (String(t.date) < m ? String(t.date) : m), todayStr).slice(0, 10);
    const [y, mo, d] = oldest.split('-').map(Number);
    historyDays = Math.round((today - new Date(y, mo - 1, d)) / 86400000);
  }

  const recurringMonthly = recurring.filter(r => r.kind !== 'income').reduce((s, r) => s + perMonth(r.amount, r.cadence), 0);

  let monthlyBurn = 0; let burnSource = 'none'; let grade = 'C';
  if (actualMonthly >= recurringMonthly && actualMonthly > 0) { monthlyBurn = actualMonthly; burnSource = 'actual'; grade = historyDays >= 60 ? 'A' : 'B'; }
  else if (recurringMonthly > 0) { monthlyBurn = recurringMonthly; burnSource = 'recurring'; grade = 'B'; }
  monthlyBurn = Math.round(monthlyBurn * 100) / 100;

  const byPayee = {};
  for (const t of spend) { const k = t.payee || 'Unknown'; byPayee[k] = (byPayee[k] || 0) + Math.abs(parseFloat(t.amount) || 0); }
  const top = Object.entries(byPayee).sort((a, b) => b[1] - a[1])[0];
  const largestOutflow = top ? { payee: top[0], amount: Math.round(top[1] * 100) / 100 } : null;

  if (!monthlyBurn) {
    return { liquid, monthlyBurn: 0, burnSource, months: null, daysLeft: null, dateMoneyRunsOut: null, band: 'unknown', largestOutflow, grade, historyDays };
  }
  const months = liquid / monthlyBurn;
  const daysLeft = Math.floor(liquid / (monthlyBurn / 30));
  const out = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysLeft);
  const band = months >= 6 ? 'safe' : months >= 3 ? 'tight' : 'critical';
  return { liquid, monthlyBurn, burnSource, months: Math.round(months * 100) / 100, daysLeft, dateMoneyRunsOut: ymd(out), band, largestOutflow, grade, historyDays };
}

module.exports = { computeRunway };
```

- [ ] **Step 4: Run the tests** → Expected: 3 passed. If `dateMoneyRunsOut` is off by one day, the test date math is local-calendar; check `WINDOW_DAYS` inclusivity, not the test.

- [ ] **Step 5: Store wrapper + route**

In `server/money/store.js` add near `projectCashflow`:
```js
const { computeRunway } = require('./runway');
function getRunway() {
  const data = readData();
  const recurring = calc.detectRecurring(getTransactions(), getDeclaredRecurring());
  return computeRunway({ accounts: getAccounts(), transactions: data.transactions, recurring });
}
```
(place the `require` with the other top-of-file requires; confirm `readData`, `getTransactions`, `getDeclaredRecurring`, `getAccounts` are the existing function names in `store.js` — they are used by `routes.js` today). Export `getRunway`.

In `server/money/routes.js`, next to `GET /cashflow`:
```js
router.get('/runway', (req, res) => {
  try { res.json(store.getRunway()); } catch (err) { res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 6: Grade badge + runway widget**

Create `src/components/money/shared/Grade.jsx`:
```jsx
const LABEL = { A: 'Computed from your real transactions', B: 'Estimated from recurring bills or thin history', C: 'Rough guess — add data to improve' };
export default function Grade({ grade = 'C', style }) {
  const color = grade === 'A' ? 'var(--m-green)' : grade === 'B' ? 'var(--m-accent)' : 'var(--m-muted)';
  return (
    <span title={LABEL[grade] || LABEL.C} aria-label={`Evidence grade ${grade}`} style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, lineHeight: '16px', padding: '0 6px', borderRadius: 999, border: `1px solid ${color}`, color, ...style }}>
      {grade}
    </span>
  );
}
```

In `src/components/money/widgets/index.jsx` add `Hourglass` to the lucide import, `import Grade from '../shared/Grade';`, and this widget (before the registry):
```jsx
function Runway() {
  const { data, isLoading } = useApi('money/runway');
  if (isLoading) return <Loading />;
  if (!data || data.band === 'unknown') return <Empty>Add a few expenses or recurring bills and your runway appears here.</Empty>;
  const color = data.band === 'safe' ? 'var(--m-green)' : data.band === 'tight' ? 'var(--m-amber, #f59e0b)' : 'var(--m-red)';
  const dateLabel = new Date(...String(data.dateMoneyRunsOut).split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v)))).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 30, fontWeight: 700, color, ...num }}>{data.months.toFixed(1)} mo</div>
        <Grade grade={data.grade} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--m-ink-2)', marginTop: 4 }}>
        Cash lasts until <strong style={{ color: 'var(--m-ink)' }}>{dateLabel}</strong> at {f$(data.monthlyBurn)}/mo
      </div>
      <div style={{ marginTop: 10 }}><Bar pct={Math.min(100, (data.months / 6) * 100)} color={color} /></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--m-muted)', marginTop: 4 }}>
        <span>{f$(data.liquid)} liquid</span>
        <span>{data.largestOutflow ? `Biggest: ${data.largestOutflow.payee}` : ''}</span>
      </div>
    </div>
  );
}
```
Register: `runway: { title: 'Runway', icon: Hourglass, layout: { w: 4, h: 2, minW: 3, minH: 2 }, Component: Runway },` as the FIRST entry of `WIDGETS`. Add `{ i: 'runway', x: 8, y: 0, w: 4, h: 2 },` to `DEFAULT_LAYOUT` and both `PRESETS`, shifting the existing `netWorth`/`cashFlow`/`spendingDonut`/`accounts` entries in the right column down by 2 rows (`y: 2, 4, 6…`). Check that `--m-amber` exists in `money-theme.css`; if not, use the literal fallback as written.

- [ ] **Step 7: Build, test, commit**

Run: `npx vite build src -c vite.config.mjs 2>&1 | tail -3; echo VITE_EXIT=${PIPESTATUS[0]}` → `VITE_EXIT=0`. `npm test` → `97 passed`.

```bash
git add server/money/runway.js server/money/store.js server/money/routes.js src/components/money/shared/Grade.jsx src/components/money/widgets/index.jsx tests/runway.test.mjs
git commit -F - <<'EOF'
feat(overview): runway headline widget with evidence grade

computeRunway (pure, tested): liquid ÷ max(trailing-90-day spend/3,
recurring monthly bills) → months, days left, the date cash hits $0, a
safe/tight/critical band and an A/B/C evidence grade. GET /api/money/runway.
EOF
```

---

### Task 7: Collapse the Overview layout-healing flags into one `schemaVersion`

**Files:**
- Create: `src/components/money/widgets/layoutMigrations.js`
- Modify: `src/components/money/sections/Overview.jsx:38-69` (init effect)
- Test: `tests/layoutMigrations.test.mjs`

**Interfaces:**
- Produces: `migrateLayout(saved, fromVersion, defs) → { layout, version }` where `defs` maps widget id → `{ w, h }`; `LAYOUT_VERSION` (currently 3). Migrations: v1 seed `insights` on top; v2 grow `insights` to `h ≥ 6`; v3 seed `runway` into the right column at `y:0` pushing right-column widgets down. Persisted as `settings.dashboards.overview.schemaVersion`. Legacy flags `insightsSeeded`/`insightsGrown` are read once to infer the starting version (both true → 2; seeded only → 1; none → 0) and then ignored.

- [ ] **Step 1: Write the failing tests**

Create `tests/layoutMigrations.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { migrateLayout, LAYOUT_VERSION, inferLegacyVersion } from '../src/components/money/widgets/layoutMigrations.js';

const defs = { insights: { w: 8, h: 6 }, runway: { w: 4, h: 2 }, netWorth: { w: 4, h: 2 } };

describe('migrateLayout', () => {
  it('seeds insights, grows it, then seeds runway for a v0 layout', () => {
    const saved = [{ i: 'netWorth', x: 8, y: 0, w: 4, h: 2 }];
    const { layout, version } = migrateLayout(saved, 0, defs);
    expect(version).toBe(LAYOUT_VERSION);
    expect(layout.find(l => l.i === 'insights')).toMatchObject({ x: 0, y: 0, w: 8, h: 6 });
    expect(layout.find(l => l.i === 'runway')).toMatchObject({ x: 8, y: 0, w: 4, h: 2 });
    expect(layout.find(l => l.i === 'netWorth').y).toBeGreaterThanOrEqual(2);
  });

  it('is a no-op at the current version', () => {
    const saved = [{ i: 'runway', x: 8, y: 0, w: 4, h: 2 }];
    expect(migrateLayout(saved, LAYOUT_VERSION, defs).layout).toEqual(saved);
  });

  it('does not re-add a widget the user removed after its seeding version', () => {
    const saved = [{ i: 'netWorth', x: 8, y: 0, w: 4, h: 2 }];
    const { layout } = migrateLayout(saved, 2, defs); // v3 only
    expect(layout.some(l => l.i === 'insights')).toBe(false);
    expect(layout.some(l => l.i === 'runway')).toBe(true);
  });
});

describe('inferLegacyVersion', () => {
  it('maps the old flags onto versions', () => {
    expect(inferLegacyVersion({})).toBe(0);
    expect(inferLegacyVersion({ insightsSeeded: true })).toBe(1);
    expect(inferLegacyVersion({ insightsSeeded: true, insightsGrown: true })).toBe(2);
    expect(inferLegacyVersion({ dashboards: { overview: { schemaVersion: 3 } } })).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module not found.

- [ ] **Step 3: Implement**

Create `src/components/money/widgets/layoutMigrations.js` (plain JS, no JSX, no imports — testable in vitest):
```js
// Ordered, idempotent dashboard-layout migrations. Replaces the old
// insightsSeeded / insightsGrown / isCollapsedLayout flag pile.
export const LAYOUT_VERSION = 3;

const RIGHT_COL_X = 8;
function pushDown(layout, pred, by) { return layout.map(l => (pred(l) ? { ...l, y: l.y + by } : l)); }

const MIGRATIONS = [
  { v: 1, up: (layout, defs) => (layout.some(l => l.i === 'insights') ? layout
      : [{ i: 'insights', x: 0, y: 0, w: defs.insights.w, h: defs.insights.h }, ...pushDown(layout, () => true, defs.insights.h)]) },
  { v: 2, up: (layout) => layout.map(l => (l.i === 'insights' && l.h < 6 ? { ...l, h: 6 } : l)) },
  { v: 3, up: (layout, defs) => (layout.some(l => l.i === 'runway') ? layout
      : [{ i: 'runway', x: RIGHT_COL_X, y: 0, w: defs.runway.w, h: defs.runway.h }, ...pushDown(layout, l => l.x >= RIGHT_COL_X, defs.runway.h)]) },
];

export function migrateLayout(saved, fromVersion, defs) {
  let layout = saved;
  let version = Number(fromVersion) || 0;
  for (const m of MIGRATIONS) {
    if (m.v <= version) continue;
    layout = m.up(layout, defs);
    version = m.v;
  }
  return { layout, version };
}

export function inferLegacyVersion(settings = {}) {
  const v = settings?.dashboards?.overview?.schemaVersion;
  if (Number.isInteger(v)) return v;
  if (settings.insightsSeeded && settings.insightsGrown) return 2;
  if (settings.insightsSeeded) return 1;
  return 0;
}
```

- [ ] **Step 4: Run the tests** → 4 passed.

- [ ] **Step 5: Use it in Overview.jsx**

Replace the init effect body (lines 39-69) with:
```js
  useEffect(() => {
    if (settings && layout !== null) return;
    if (!settings) return;
    const saved = (settings?.dashboards?.overview?.layout || []).filter((l) => WIDGETS[l.i]);
    if (!saved.length || isCollapsedLayout(saved)) {
      setLayout(DEFAULT_LAYOUT);
      persistVersioned(DEFAULT_LAYOUT, LAYOUT_VERSION, { now: true });
      return;
    }
    const from = inferLegacyVersion(settings);
    const defs = Object.fromEntries(Object.entries(WIDGETS).map(([id, w]) => [id, w.layout]));
    const { layout: next, version } = migrateLayout(saved, from, defs);
    setLayout(next);
    if (version !== from) persistVersioned(next, version, { now: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, layout]);

  function persistVersioned(next, version, opts) {
    const overview = { ...(settings?.dashboards?.overview || {}), layout: next, schemaVersion: version };
    const dashboards = { ...(settings?.dashboards || {}), overview };
    saveSettings({ dashboards }).then((s) => queryClient.setQueryData(['settings'], s)).catch(() => {});
  }
```
Add `import { migrateLayout, inferLegacyVersion, LAYOUT_VERSION } from '../widgets/layoutMigrations';`. In `persist()`, `resetLayout()` and `applyPreset()` include `schemaVersion: LAYOUT_VERSION` in the `overview` object so a reset never re-triggers migrations. Keep `isCollapsedLayout` (it guards RGL corruption, not versioning).

- [ ] **Step 6: Build, test, commit**

`npx vite build …` → `VITE_EXIT=0`; `npm test` → `101 passed`.
```bash
git add src/components/money/widgets/layoutMigrations.js src/components/money/sections/Overview.jsx tests/layoutMigrations.test.mjs
git commit -F - <<'EOF'
refactor(overview): versioned layout migrations replace the healing-flag pile
EOF
```

---

### Task 8: Server hygiene — CORS env, stale comment, coach timeout exemption, historical doc marker

**Files:**
- Modify: `server/index.js:25, 30, 41-51`
- Modify: `docs/superpowers/2026-07-03-app-survey.md` (prepend one line)
- Modify: `env.example` (document `MMM_CORS_ORIGINS`)

- [ ] **Step 1: Apply the edits**

`server/index.js` line 25 →
```js
const ORIGINS = (process.env.MMM_CORS_ORIGINS || 'http://localhost:5006,http://localhost:5173,http://127.0.0.1:5006,file://').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: ORIGINS }));
```
Line 30 comment → `// ─── Body parsing — 2 MB cap (settings + CSV/backup import) ───`.
Request timeout block →
```js
// Hard-kill any request not finished within 30s — except local-LLM routes,
// which legitimately run longer (ollama.js allows 40s per call).
const REQUEST_TIMEOUT_MS = 30_000;
const TIMEOUT_EXEMPT = [/^\/api\/money\/coach/];
app.use((req, res, next) => {
  if (TIMEOUT_EXEMPT.some((re) => re.test(req.path))) return next();
  const timer = setTimeout(() => {
    if (!res.headersSent) res.status(503).json({ error: 'Request timed out.' });
  }, REQUEST_TIMEOUT_MS);
  res.on('finish', () => clearTimeout(timer));
  res.on('close',  () => clearTimeout(timer));
  next();
});
```
`env.example`: add `# MMM_CORS_ORIGINS=http://localhost:5006,http://localhost:5173,http://127.0.0.1:5006,file://`.
`docs/superpowers/2026-07-03-app-survey.md`: insert as the first line: `> **HISTORICAL (pre-overhaul snapshot, 2026-07-03).** Most risks listed here were fixed in commits 07b08f3…63859ae. Do not plan from this document; see docs/superpowers/plans/ and the v3 plan.`

- [ ] **Step 2: Smoke the server manually, test, commit**

Run (foreground, one turn): `PORT=5117 MMM_DATA_DIR="$TMP/mmm-p0" node server/index.js & sleep 4; curl -s http://127.0.0.1:5117/api/health; curl -s http://127.0.0.1:5117/api/money/runway | head -c 200; kill %1`
Expected: `{"ok":true…}` then a runway JSON with `"band"`.
`npm test` → `101 passed`.
```bash
git add server/index.js env.example docs/superpowers/2026-07-03-app-survey.md
git commit -F - <<'EOF'
chore(server): CORS origins from env, exempt coach from the 30s timeout, mark the July survey historical
EOF
```

---

### Task 9: Package, verify in the app, hand off the shortcut refresh

**Files:**
- Run only: `scripts/build-portable.mjs`; no source changes expected.

- [ ] **Step 1: Build the portable exe**

Run: `npm run build:portable 2>&1 | tail -15` (foreground, timeout 600000).
Expected: ends with the smoke test passing (`/api/health` 200 and `/api/money/overview` 200 on the temp data dir) and `build/MMM-portable/MMM.exe` present.

- [ ] **Step 2: In-app verification checklist (Aaron or Playwright against the built SPA)**

Start the built SPA server: `PORT=5006 node server/index.js` (background within the same turn) and open `http://127.0.0.1:5006` — or launch `build/MMM-portable/MMM.exe`. Tick:
- Overview: **Runway** card in the right column shows `N.N mo`, a date, an A/B/C badge; existing widgets are intact (no left-column collapse).
- Cash Flow: Income vs Spending shows solid past months and hatched future months; "Log a daily expense" saves a transaction.
- Any `<Term>` (Budget "Envelope budgeting", Debt "Avalanche") shows a definition; "Learn more →" opens Learn pre-filtered.
- Learn: search filters the 51 terms.
- Create a recurring bill linked to Checking with `next_date` = yesterday, restart the server → a toast "Posted 1 recurring bill while you were away" appears once.
- `npm test` → `101 passed`.

- [ ] **Step 3: Hand-off**

Aaron runs from his own shell: `! powershell -ExecutionPolicy Bypass -File "C:\Users\aaron\projects\Finance agent\mmm-app\make-mmm-shortcut.ps1"` to refresh `MMMoney.lnk` (the exe path is unchanged, so this is only needed if the icon changed — optional).
Record in `docs/superpowers/plans/2026-09-16-phase0-land-and-fix.md` (this file) a final line: `Phase 0 shipped <date>, <commit>`.

---

## Self-review

- **Spec coverage:** Phase 0 items from the v3 plan — computeGoalInsights tests (T2) ✓; truncation reported + off the startup path + toast (T3) ✓; memoized/extracted chart + hatched projected months (T4) ✓; glossary contract + Term + Learn stub + `#/learn` route (T5) ✓; runway headline + Grade + `GET /runway` (T6) ✓; schemaVersion collapse before adding the widget (T7 — note: T6 adds `runway` to `DEFAULT_LAYOUT` for fresh dashboards and T7 seeds it onto existing ones; both land before the exe ships) ✓; `.gitignore` `.omc/` + untrack, CORS env, comment fix, coach timeout exemption, survey doc marker (T1, T8) ✓; commits + repackage + shortcut hand-off (T9) ✓. Deferred on purpose (noted in the v3 plan): `glossary.json` `section`/`see_also` fields, the `runway-critical|tight|ok` advice rule rewrite (Phase 1, to avoid touching advice tests now), splitting `CashFlow.jsx` beyond the chart card.
- **Placeholder scan:** no TBD/TODO; every code step carries code. T5 Step 6 and T6 Step 6 ask the executor to confirm two existing prop/token names before use — that is a check, not a placeholder.
- **Type consistency:** `postDueRecurring() → {posted, truncated}` used identically in T3 store/route/index/MoneyHub; `computeIncomeVsSpending({transactions, recurring, today}) → {rows, totals}` used identically in T4 test/module/card/section; `computeRunway` field names match between test, module and widget; `migrateLayout/inferLegacyVersion/LAYOUT_VERSION` match between test, module and Overview.

Phase 0 shipped 2026-09-17 — commits ca428e5..PENDING (103 tests green, MMM.exe rebuilt).
