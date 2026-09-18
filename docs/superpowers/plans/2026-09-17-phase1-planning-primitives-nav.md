# Phase 1 — Planning primitives + nav — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give MMM a grouped, deep-linkable navigation shell with a Ctrl+K palette, port NEXUS's pure loan and
financial-planning math onto the server with tests, and ship a Plan section (take-home, "Model an offer", raise,
Roth, FIRE, what-if) plus profile intake, server-backed Debt calculators, and a subscriptions view.

**Architecture:** All money math moves server-side into a new `server/tools/` package of pure, dependency-free
CommonJS modules (`loans.js`, `planning.js`, `profile.js`) exposed through one router mounted at `/api/plan`.
The client calls those endpoints and renders; no financial math lives in a component after this phase. Navigation
gains a `group` field on `SECTIONS`, a collapsible grouped sidebar persisted in `settings.nav`, and nested routes
(`/plan/:tab`) so every panel is deep-linkable. Profile facts live in `settings.profile` and are fused with real
account balances by `profileFromMmm()` — the single snapshot builder every planning model consumes.

**Tech Stack:** npm, Node 20 CommonJS on the server, Express 4, better-sqlite3, React 18 JSX, react-router-dom 7,
Vite 5, vitest 3, `motion` v12, `lucide-react`. **No TypeScript. No Bun. No new runtime dependency in this phase.**

**Spec:** `C:\Users\aaron\.claude\plans\lets-make-a-plan-floating-pine.md` — §3 (hard constraints), §4.1/§4.2
(nav + `server/tools`), §5 "Phase 1 — Planning primitives + nav", §7 (cross-cutting), §9 (deliberately cut).
Read the spec alongside this plan.

**Prior ledger:** `C:\Users\aaron\.claude\projects\C--Users-aaron\memory\project_mmm_v3_plan.md`
(Phase 0 and Phase D shipped; master is at `e465048`; baseline **108 tests in 11 files**).

---

## Global Constraints

Copied verbatim from the spec — every task's requirements implicitly include these.

- **Money = integer cents; balances derived; dates compared as local `YYYY-MM-DD` strings.** The existing
  `store.readData()` layer already converts to dollars for `accounts[].balance`; the pure modules in this phase take
  **dollars** in and return **dollars** out, mirroring `server/money/runway.js`. Never introduce a float cents field.
- **No TypeScript migration, no Bun, no bundler change.** JSDoc on new modules instead of type annotations.
- **Any new server dependency goes into `SERVER_DEPS` in `scripts/build-portable.mjs` in the same commit.**
  Phase 1 adds no new server dependency — if a task finds it needs one, stop and escalate.
- **Never run `npm run build` and `npm run build:portable` at the same time** — they both write `src/dist` and
  `build/MMM-portable`, and the loser dies with `EPERM ... syscall: 'rm'`. Close a running `MMM.exe` before packaging.
- **Every figure shown carries an evidence grade (A/B/C).** Use the existing `shared/Grade.jsx`. In this phase:
  `A` = derived from real MMM account balances / transactions; `B` = derived from a user-declared profile value or a
  prior-tax-year table; `C` = a default assumption the user never entered.
- **Every new table round-trips through `repo.readAll/writeAll`.** Phase 1 adds **no new table** — profile lives in
  `settings.profile`, which already round-trips.
- **No `cursor: pointer` on cards. Colour is always paired with a sign or icon. Numbers are always tabular mono**
  (`fontVariantNumeric: 'tabular-nums'`).
- **Use v3 semantic tokens (`docs/design/v3-tokens.md`); never hardcode a hex.** Preserve every `--m-*` bridge name.
  `npm run check:contrast` must stay green.
- **Multi-line commit messages go through `git commit -F -` with a heredoc.** The commit hook rejects `-m` with a
  heredoc. Never stage `.omc/`, `build/`, `src/dist/`, `.superpowers/`, or `.playwright-cli/`.
- **`rm` is denied to the agent shell.** To delete a file, use `git rm` (tracked files) or write a `.sh` script and
  ask Aaron to run it with `! bash /c/...`.
- **`curl` is blocked.** Use node's `fetch` or `http.get`.
- **Build only what this phase specifies.** Everything in spec §9 stays cut.

---

## Rulings made while writing this plan

These resolve spec ambiguities or defects. They are binding for execution and must be copied into the phase ledger.

- **R1 — `calcLoanPayoff` is NOT ported.** Spec §4.2 is explicit: MMM's `POST /api/money/debt/payoff`
  (`server/money/routes.js:535`) already does avalanche/snowball against real accounts. Porting NEXUS's version would
  duplicate it against fake debts. `server/tools/loans.js` exports four functions, not five.
- **R2 — The spec's mortgage fixture is a $400k *loan*, not a $400k purchase price.** Spec §5 says
  "$400k/7%/30y → $2,661/mo & ~$558k interest". With the function's default 20% down that is $2,128.97 and $446,428.
  The spec's numbers reproduce exactly at `down_payment_pct: 0`: `monthly_pi` = **2661.21**, `total_interest` =
  **558036**. Tests assert `monthly_pi` (not `monthly_payment`, which at 0% down includes a $233.33 PMI estimate).
- **R3 — Tax tables are dated and carry their year.** NEXUS's constants are 2024 (brackets, $14,600 standard
  deduction, $7,000 Roth limit). Shipping them unlabelled in 2026 would present stale figures as current, violating
  the grading rule. `calcTakeHome` keeps the 2024 table verbatim but returns `tax_year: 2024` and `grade: 'B'`, and
  every UI surface renders "2024 brackets" next to the number. **Do not invent 2025/2026 figures.**
- **R4 — `modelEmergencyFund` drops its hardcoded `0.74` take-home factor** and computes surplus as
  `calcTakeHome(gross, state).monthly_take_home - expenses`. The magic factor is a weak part the locked decisions
  authorize rebuilding, and it disagrees with `calcTakeHome` by ~$350/mo on an $65k salary.
- **R5 — `modelRaise` loses its fabricated `|| 65000` salary fallback.** With no `income.current_gross` it returns
  `{ needs_profile: true }` and the UI prompts for intake. Never fabricate a number.
- **R6 — `months_to_emergency_fund` is derived from the allocation plan**, not from the full monthly delta. As
  ported the two disagree (9 vs 14 months on the same input). One source of truth: the EF row's `months_to_goal`.
- **R7 — Nested routes apply to new sections; Debt's calculators use a search param.** Spec §4.1's "sub-tabs are
  nested routes, never `useState`" is satisfied for Plan via `/plan/:tab`. Debt's calculators are a panel inside an
  existing 640-line section, not a section sub-tab; they become deep-linkable via `?calc=mortgage` rather than
  restructuring Debt in a phase that does not own it.
- **R8 — `modelRothIra` rounds its `assumed_rate` string.** `${0.07 * 100}%` renders `7.000000000000001%`.

---

## File Structure

**Created — server**
| File | Responsibility |
|---|---|
| `server/tools/loans.js` | Pure mortgage / auto / refi / DTI math. No I/O. |
| `server/tools/planning.js` | Pure take-home, raise, emergency fund, Roth, 18-mo net worth, FIRE, milestones. No I/O. |
| `server/tools/profile.js` | `profileFromMmm(data, settings)` → the snapshot every planning model consumes. Reads only what it is handed. |
| `server/tools/routes.js` | Express router mounted at `/api/plan`. Validates input, calls the pure modules, returns `{ ...result, grade }`. |

**Created — client**
| File | Responsibility |
|---|---|
| `src/components/money/shared/Tooltip.jsx` | Hover/focus tooltip on v3 tokens. |
| `src/components/money/shared/InfoIcon.jsx` | `<Tooltip>`-wrapped `Info` glyph. |
| `src/components/money/shared/AnimatedNumber.jsx` | Count-up number, respects `prefers-reduced-motion`. |
| `src/components/money/shared/MetricCard.jsx` | Label + value + optional delta/grade tile. |
| `src/components/money/shared/ErrorState.jsx` | Inline error with a retry button. |
| `src/components/money/shared/Skeleton.jsx` | Reusable `m-skeleton` block. |
| `src/components/money/shared/CommandPalette.jsx` | Ctrl+K palette over sections / accounts / payees / actions. |
| `src/components/money/shared/KeyboardShortcuts.jsx` | `?` shortcut-reference overlay. |
| `src/components/money/sections/Plan.jsx` | Plan section shell; nested `/plan/:tab` routes. |
| `src/components/money/sections/parts/plan/TakeHome.jsx` | Take-home panel. |
| `src/components/money/sections/parts/plan/ModelOffer.jsx` | "Model an offer" — Δ take-home / Δ runway / Δ 18-mo net worth. |
| `src/components/money/sections/parts/plan/Raise.jsx` | Raise model + allocation plan. |
| `src/components/money/sections/parts/plan/Retirement.jsx` | Roth IRA + FIRE. |
| `src/components/money/sections/parts/plan/WhatIf.jsx` | Server-backed what-if sliders + 18-mo timeline + milestones. |
| `src/components/money/sections/parts/onboarding/OnboardingModal.jsx` | 3-step welcome-gate profile intake. |
| `src/components/money/sections/parts/settings/ProfilePanel.jsx` | Settings → Profile editor (same fields). |
| `src/components/money/sections/parts/cashflow/Subscriptions.jsx` | Subscriptions filter over `recurring`. |

**Created — tests**
`tests/loans.test.mjs`, `tests/planning.test.mjs`, `tests/profile.test.mjs`, `tests/plan-routes.test.mjs`,
`tests/cadence.test.mjs`

**Modified**
| File | Change |
|---|---|
| `server/index.js` | Mount `/api/plan`. |
| `server/middleware/validators.js` | `CADENCES` gains `quarterly`, `annual`. |
| `server/money/store.js` | `advanceDate` handles `quarterly`/`annual`. |
| `server/money/runway.js` | `perMonth` handles `quarterly`/`annual`. |
| `server/money/calc.js` | Its `perMonth` handles `quarterly`/`annual`. |
| `server/money/advice.js` | `recurring-heavy` links to the subscriptions view. |
| `src/components/money/MoneyHub.jsx` | Grouped sidebar, `group` on `SECTIONS`, nested routes, palette + shortcuts mount, onboarding gate. |
| `src/components/money/sections/Debt.jsx` | Calculator selection via `?calc=`; `$0` empty state. |
| `src/components/money/sections/parts/debt/CalcPanel.jsx` | Calls `/api/plan/*` instead of local `pmt()`; gains Refi + DTI + Auto. |
| `src/components/money/sections/CashFlow.jsx` | Renders the Subscriptions panel. |
| `src/components/money/sections/Settings.jsx` | Mounts `ProfilePanel`. |
| `src/styles/money-theme.css` | Sidebar-group, palette, and tooltip classes on v3 tokens. |

---

### Task 1: `server/tools/loans.js` — mortgage, auto, refi, DTI

**Files:**
- Create: `server/tools/loans.js`
- Test: `tests/loans.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `calcMonthlyPayment(principal: number, annualRateFraction: number, termMonths: number) → number`
  - `calcMortgage({ purchase_price, down_payment_pct = 20, annual_rate, term_years = 30 })` →
    `{ monthly_payment, monthly_pi, pmi_estimate, loan_amount, down_payment, total_cost, total_interest, amortization[] }`
    where `amortization[]` is `{ year, principal_paid, interest_paid, balance }`, one row per year.
  - `calcAutoLoan({ vehicle_price, down_payment = 0, trade_in = 0, annual_rate, term_months = 60 })` →
    `{ monthly_payment, loan_amount, total_interest, total_cost }`
  - `calcRefiBreakeven({ current_rate, new_rate, balance, years_remaining, closing_costs })` →
    `{ current_monthly_payment, new_monthly_payment, monthly_savings, breakeven_months, breakeven_years, total_savings, verdict }`
  - `calcDti({ monthly_debts, gross_monthly_income })` →
    `{ dti, mortgage_readiness, max_mortgage_payment, notes[] }`
  - `annual_rate` is a **percent** (7 means 7%); `calcMonthlyPayment` takes a **fraction** (0.07).

- [ ] **Step 1: Write the failing test file**

Create `tests/loans.test.mjs`. Every expected value below was computed from the NEXUS source, so they are
regression-locked, not guesses.

```javascript
import { describe, it, expect } from 'vitest';
import {
  calcMortgage, calcAutoLoan, calcRefiBreakeven, calcDti,
} from '../server/tools/loans.js';

describe('calcMortgage', () => {
  // Spec fixture (ruling R2): "$400k / 7% / 30y -> $2,661/mo & ~$558k interest" is a
  // $400k LOAN, i.e. zero down. monthly_payment additionally carries a PMI estimate.
  it('matches the spec fixture on a $400k loan at 7% over 30 years', () => {
    const m = calcMortgage({ purchase_price: 400000, down_payment_pct: 0, annual_rate: 7, term_years: 30 });
    expect(m.monthly_pi).toBeCloseTo(2661.21, 2);
    expect(m.total_interest).toBe(558036);
    expect(m.loan_amount).toBe(400000);
    expect(m.down_payment).toBe(0);
  });

  it('charges no PMI at 20% down and reports the smaller principal', () => {
    const m = calcMortgage({ purchase_price: 400000, down_payment_pct: 20, annual_rate: 7, term_years: 30 });
    expect(m.pmi_estimate).toBeNull();
    expect(m.monthly_payment).toBeCloseTo(2128.97, 2);
    expect(m.monthly_payment).toBe(m.monthly_pi);
    expect(m.loan_amount).toBe(320000);
    expect(m.down_payment).toBe(80000);
    expect(m.total_interest).toBe(446428);
  });

  it('adds a PMI estimate below the 20% down threshold', () => {
    const m = calcMortgage({ purchase_price: 400000, down_payment_pct: 10, annual_rate: 7, term_years: 30 });
    expect(m.pmi_estimate).toBeCloseTo(210, 2);
    expect(m.monthly_pi).toBeCloseTo(2395.09, 2);
    expect(m.monthly_payment).toBeCloseTo(2605.09, 2);
  });

  it('amortizes to zero over one row per year', () => {
    const m = calcMortgage({ purchase_price: 400000, down_payment_pct: 20, annual_rate: 7, term_years: 30 });
    expect(m.amortization).toHaveLength(30);
    expect(m.amortization[0]).toEqual({ year: 1, principal_paid: 3251, interest_paid: 22297, balance: 316749 });
    expect(m.amortization[29].balance).toBe(0);
  });

  it('handles a 0% rate as straight-line principal', () => {
    const m = calcMortgage({ purchase_price: 120000, down_payment_pct: 0, annual_rate: 0, term_years: 10 });
    expect(m.monthly_pi).toBeCloseTo(1000, 6);
    expect(m.total_interest).toBe(0);
  });

  it('clamps a down payment over 100% and a negative rate', () => {
    const m = calcMortgage({ purchase_price: 100000, down_payment_pct: 150, annual_rate: -3, term_years: 10 });
    expect(m.loan_amount).toBe(0);
    expect(m.monthly_pi).toBe(0);
  });
});

describe('calcAutoLoan', () => {
  it('nets down payment and trade-in out of the principal', () => {
    const a = calcAutoLoan({ vehicle_price: 35000, down_payment: 5000, annual_rate: 6, term_months: 60 });
    expect(a.loan_amount).toBe(30000);
    expect(a.monthly_payment).toBeCloseTo(579.98, 2);
    expect(a.total_interest).toBe(4799);
    expect(a.total_cost).toBe(39799);
  });

  it('never goes negative when the trade-in exceeds the price', () => {
    const a = calcAutoLoan({ vehicle_price: 10000, down_payment: 2000, trade_in: 12000, annual_rate: 6 });
    expect(a.loan_amount).toBe(0);
    expect(a.monthly_payment).toBe(0);
  });
});

describe('calcRefiBreakeven', () => {
  it('reports breakeven and a strong verdict on a 1.5-point drop', () => {
    const r = calcRefiBreakeven({ current_rate: 7, new_rate: 5.5, balance: 300000, years_remaining: 25, closing_costs: 6000 });
    expect(r.current_monthly_payment).toBeCloseTo(2120.34, 2);
    expect(r.new_monthly_payment).toBeCloseTo(1842.26, 2);
    expect(r.monthly_savings).toBeCloseTo(278.08, 2);
    expect(r.breakeven_months).toBe(22);
    expect(r.breakeven_years).toBeCloseTo(1.83, 2);
    expect(r.verdict).toMatch(/^STRONG YES/);
  });

  it('refuses to invent a breakeven when the new rate is worse', () => {
    const r = calcRefiBreakeven({ current_rate: 5, new_rate: 6, balance: 300000, years_remaining: 25, closing_costs: 6000 });
    expect(r.breakeven_months).toBeNull();
    expect(r.total_savings).toBeNull();
    expect(r.verdict).toMatch(/No benefit/);
  });

  it('downgrades the verdict as the breakeven stretches out', () => {
    const mid = calcRefiBreakeven({ current_rate: 7, new_rate: 6.7, balance: 300000, years_remaining: 25, closing_costs: 6000 });
    expect(mid.breakeven_months).toBeGreaterThan(24);
    expect(mid.verdict).toMatch(/^YES/);
    const slow = calcRefiBreakeven({ current_rate: 7, new_rate: 6.9, balance: 300000, years_remaining: 25, closing_costs: 12000 });
    expect(slow.breakeven_months).toBeGreaterThan(48);
    expect(slow.verdict).toMatch(/^CONSIDER/);
  });
});

describe('calcDti', () => {
  it('bands a 20% ratio as good and sizes the remaining 43% headroom', () => {
    const d = calcDti({ monthly_debts: 1200, gross_monthly_income: 6000 });
    expect(d.dti).toBe(20);
    expect(d.mortgage_readiness).toBe('good');
    expect(d.max_mortgage_payment).toBe(1380);
    expect(d.notes.length).toBe(2);
  });

  it('bands each threshold', () => {
    expect(calcDti({ monthly_debts: 500,  gross_monthly_income: 6000 }).mortgage_readiness).toBe('excellent');
    expect(calcDti({ monthly_debts: 2400, gross_monthly_income: 6000 }).mortgage_readiness).toBe('fair');
    expect(calcDti({ monthly_debts: 3000, gross_monthly_income: 6000 }).mortgage_readiness).toBe('poor');
  });

  it('returns an error instead of dividing by zero income', () => {
    expect(calcDti({ monthly_debts: 1200, gross_monthly_income: 0 }).error).toMatch(/greater than 0/);
  });

  it('never reports negative headroom', () => {
    expect(calcDti({ monthly_debts: 5000, gross_monthly_income: 6000 }).max_mortgage_payment).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npx vitest run tests/loans.test.mjs
```
Expected: FAIL — `Failed to load ../server/tools/loans.js`.

- [ ] **Step 3: Write `server/tools/loans.js`**

Port `nexus-app/server/nexus/tools/loans.js` **minus `calcLoanPayoff`** (ruling R1). Keep the amortization loop,
the `r2` helper, the PMI rule (`dp < 20` → `principal * 0.007 / 12`), and the DTI note strings byte-for-byte —
the tests above are locked to them. Add a JSDoc block per export naming units (`annual_rate` is a percent).
Guard `calcAutoLoan` so a trade-in larger than the price clamps the principal to 0, and make
`calcMonthlyPayment` return 0 for a non-positive `termMonths`.

```javascript
// Loan calculators — pure math, no I/O. Rates are PERCENTS on the public API
// (7 means 7%); calcMonthlyPayment takes a fraction. Dollars in, dollars out.

/**
 * @param {number} principal
 * @param {number} annualRate  fraction, e.g. 0.07
 * @param {number} termMonths
 * @returns {number} level monthly payment
 */
function calcMonthlyPayment(principal, annualRate, termMonths) {
  if (principal <= 0 || termMonths <= 0) return 0;
  if (annualRate === 0) return principal / termMonths;
  const r = annualRate / 12;
  return principal * (r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1);
}

const r2 = (n) => Math.round(n * 100) / 100;
```

…then `calcMortgage`, `calcAutoLoan`, `calcRefiBreakeven`, `calcDti` exactly as in the NEXUS source,
ending with:

```javascript
module.exports = { calcMonthlyPayment, calcMortgage, calcAutoLoan, calcRefiBreakeven, calcDti };
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run tests/loans.test.mjs
```
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add server/tools/loans.js tests/loans.test.mjs
git commit -F - <<'EOF'
feat(tools): port NEXUS loan math to server/tools/loans.js

Mortgage (with amortization + PMI), auto loan, refi breakeven and DTI as pure
functions with 15 regression-locked tests. calcLoanPayoff is deliberately not
ported — /api/money/debt/payoff already runs avalanche/snowball against real
accounts (plan ruling R1).
EOF
```

---

### Task 2: `server/tools/planning.js` — take-home, raise, emergency fund, Roth, net worth, FIRE

**Files:**
- Create: `server/tools/planning.js`
- Test: `tests/planning.test.mjs`

**Interfaces:**
- Consumes: nothing (self-contained; do **not** import `loans.js`).
- Produces:
  - `TAX_YEAR` → `2024` (number), `STATE_TAX_RATES` → object
  - `calcTakeHome(grossAnnual: number, state = 'AZ')` →
    `{ gross_annual, federal_tax, state_tax, fica, annual_take_home, monthly_take_home, effective_rate, tax_year, grade }`
  - `modelRaise(snapshot, newSalary, gapWeeks = 0)` → the NEXUS shape **plus** `needs_profile: boolean`
  - `modelEmergencyFund(snapshot)` →
    `{ current_liquid, monthly_expenses, current_months_covered, target_3mo, target_6mo, deficit_to_6mo, funded_pct, estimated_monthly_surplus, months_to_6mo_goal }`
  - `modelRothIra(annualContribution, startAge = 25, retirementAge = 65, rate = 0.07)` →
    `{ annual_contribution, monthly_contribution, years, assumed_rate, balance_at_retirement, total_contributions, investment_growth, irs_limit, tax_year }`
  - `modelNetWorth18mo(snapshot, newSalary, savingsRatePct = 0.30)` → NEXUS shape (`timeline[]` of 18 rows)
  - `modelFireNumber(snapshot)` → NEXUS shape
  - `generateMilestones(timeline, snapshot)` → `[{ month, type, net_worth, label, description }]` sorted by month
  - **`snapshot` shape** (produced by Task 3, consumed here):
    ```
    { context: { state, current_net_worth, gap_period_weeks },
      income:  { current_gross },              // null when the user has not declared one
      expenses:{ total_monthly },
      assets:  { checking, savings, retirement },
      goals:   { emergency_fund_target, roth_ira_monthly, target_net_worth_18mo },
      grade:   'A'|'B'|'C' }
    ```

- [ ] **Step 1: Write the failing test file**

Create `tests/planning.test.mjs`.

```javascript
import { describe, it, expect } from 'vitest';
import {
  TAX_YEAR, calcTakeHome, modelRaise, modelEmergencyFund,
  modelRothIra, modelNetWorth18mo, modelFireNumber, generateMilestones,
} from '../server/tools/planning.js';

// A realistic snapshot: $65k gross, $3,200/mo expenses, $10k liquid, $12k net worth.
const snap = () => ({
  context:  { state: 'AZ', current_net_worth: 12000, gap_period_weeks: 0 },
  income:   { current_gross: 65000 },
  expenses: { total_monthly: 3200 },
  assets:   { checking: 4000, savings: 6000, retirement: 0 },
  goals:    {},
  grade: 'A',
});

describe('calcTakeHome', () => {
  it('applies 2024 federal brackets, state tax and FICA', () => {
    const t = calcTakeHome(85000, 'AZ');
    expect(t.federal_tax).toBe(10541);
    expect(t.state_tax).toBe(2125);
    expect(t.fica).toBe(6503);
    expect(t.annual_take_home).toBe(65832);
    expect(t.monthly_take_home).toBe(5486);
    expect(t.effective_rate).toBe(22.6);
  });

  it('carries its tax year and a B grade so stale brackets are visible', () => {
    const t = calcTakeHome(85000, 'AZ');
    expect(t.tax_year).toBe(TAX_YEAR);
    expect(TAX_YEAR).toBe(2024);
    expect(t.grade).toBe('B');
  });

  it('zeroes state tax in a no-income-tax state', () => {
    expect(calcTakeHome(85000, 'TX').state_tax).toBe(0);
    expect(calcTakeHome(85000, 'tx').state_tax).toBe(0); // case-insensitive
  });

  it('falls back to a 5% blended rate for an unlisted state', () => {
    expect(calcTakeHome(100000, 'ME').state_tax).toBe(5000);
  });

  it('never taxes below the standard deduction', () => {
    const t = calcTakeHome(10000, 'AZ');
    expect(t.federal_tax).toBe(0);
    expect(t.annual_take_home).toBeGreaterThan(0);
  });

  it('returns zeros rather than NaN at zero income', () => {
    const t = calcTakeHome(0, 'AZ');
    expect(t.annual_take_home).toBe(0);
    expect(t.effective_rate).toBe(0);
  });
});

describe('modelRaise', () => {
  it('computes the monthly and annual delta between two salaries', () => {
    const r = modelRaise(snap(), 85000, 0);
    expect(r.needs_profile).toBe(false);
    expect(r.current_monthly_takehome).toBe(4355);
    expect(r.new_monthly_takehome).toBe(5486);
    expect(r.monthly_delta).toBe(1131);
    expect(r.annual_delta).toBe(13572);
    expect(r.net_12mo_gain).toBe(13572);
  });

  it('charges an unemployment gap against the first-year gain', () => {
    const r = modelRaise(snap(), 85000, 8);
    expect(r.gap_cost).toBe(Math.round(8 * (3200 / 4.33)));
    expect(r.net_12mo_gain).toBe(r.annual_delta - r.gap_cost);
  });

  it('allocates the raise to emergency fund, then Roth, then taxable', () => {
    const r = modelRaise(snap(), 120000, 0);
    expect(r.allocation_plan.map((a) => a.goal)).toEqual([
      'Emergency Fund', 'Roth IRA', 'Taxable Investments / Savings',
    ]);
  });

  // Ruling R6: one source of truth for the emergency-fund timeline.
  it('reports months_to_emergency_fund from the allocation plan', () => {
    const r = modelRaise(snap(), 85000, 0);
    const ef = r.allocation_plan.find((a) => a.goal === 'Emergency Fund');
    expect(r.months_to_emergency_fund).toBe(ef.months_to_goal);
  });

  // Ruling R5: never fabricate a current salary.
  it('flags a missing profile instead of assuming $65k', () => {
    const s = snap();
    s.income.current_gross = null;
    const r = modelRaise(s, 85000, 0);
    expect(r.needs_profile).toBe(true);
    expect(r.monthly_delta).toBeNull();
  });

  it('reports a pay cut as a negative delta without crashing', () => {
    const r = modelRaise(snap(), 45000, 0);
    expect(r.monthly_delta).toBeLessThan(0);
    expect(r.allocation_plan).toEqual([]);
  });
});

describe('modelEmergencyFund', () => {
  // Ruling R4: surplus comes from calcTakeHome, not a hardcoded 0.74 factor.
  it('derives the monthly surplus from real take-home math', () => {
    const e = modelEmergencyFund(snap());
    expect(e.estimated_monthly_surplus).toBe(calcTakeHome(65000, 'AZ').monthly_take_home - 3200);
    expect(e.estimated_monthly_surplus).toBe(1155);
    expect(e.months_to_6mo_goal).toBe(8);
  });

  it('sizes the 3- and 6-month targets and the funded percentage', () => {
    const e = modelEmergencyFund(snap());
    expect(e.current_liquid).toBe(10000);
    expect(e.target_3mo).toBe(9600);
    expect(e.target_6mo).toBe(19200);
    expect(e.deficit_to_6mo).toBe(9200);
    expect(e.current_months_covered).toBe(3.1);
    expect(e.funded_pct).toBe(52);
  });

  it('returns null months when there is no surplus', () => {
    const s = snap();
    s.expenses.total_monthly = 9000;
    expect(modelEmergencyFund(s).months_to_6mo_goal).toBeNull();
  });

  it('reports zero coverage rather than Infinity at zero expenses', () => {
    const s = snap();
    s.expenses.total_monthly = 0;
    const e = modelEmergencyFund(s);
    expect(Number.isFinite(e.current_months_covered)).toBe(true);
    expect(e.funded_pct).toBe(0);
  });
});

describe('modelRothIra', () => {
  it('compounds an annual contribution to retirement', () => {
    const r = modelRothIra(7000, 30, 65, 0.07);
    expect(r.years).toBe(35);
    expect(r.balance_at_retirement).toBe(1035394);
    expect(r.total_contributions).toBe(245000);
    expect(r.investment_growth).toBe(790394);
    expect(r.monthly_contribution).toBe(583);
  });

  it('caps the contribution at the IRS limit and says which year', () => {
    const r = modelRothIra(20000, 30, 65);
    expect(r.annual_contribution).toBe(7000);
    expect(r.irs_limit).toBe(7000);
    expect(r.tax_year).toBe(TAX_YEAR);
  });

  // Ruling R8.
  it('formats the assumed rate without float noise', () => {
    expect(modelRothIra(7000, 30, 65, 0.07).assumed_rate).toBe('7%');
  });

  it('returns a zero balance when retirement is not in the future', () => {
    expect(modelRothIra(7000, 65, 65).balance_at_retirement).toBe(0);
  });
});

describe('modelNetWorth18mo', () => {
  it('projects 18 rows of net worth from the savings rate', () => {
    const n = modelNetWorth18mo(snap(), 85000, 0.30);
    expect(n.timeline).toHaveLength(18);
    expect(n.monthly_save).toBe(686);
    expect(n.timeline[0]).toEqual({ month: 1, net_worth: 12686, monthly_save: 686 });
    expect(n.final_net_worth).toBe(24344);
  });

  it('subtracts the gap cost before the first month', () => {
    const s = snap();
    s.context.gap_period_weeks = 4;
    const n = modelNetWorth18mo(s, 85000, 0.30);
    expect(n.gap_cost).toBe(Math.round((3200 / 4.33) * 4));
    expect(n.timeline[0].net_worth).toBeLessThan(12686);
  });

  it('reports the month the target is reached, or null', () => {
    const s = snap();
    s.goals.target_net_worth_18mo = 20000;
    expect(modelNetWorth18mo(s, 85000, 0.30).months_to_target).toBe(12);
    expect(modelNetWorth18mo(snap(), 85000, 0.30).months_to_target).toBeNull(); // default 35000 target
  });
});

describe('modelFireNumber', () => {
  it('applies the 25x rule', () => {
    const f = modelFireNumber(snap());
    expect(f.annual_expenses).toBe(38400);
    expect(f.fire_number).toBe(960000);
    expect(f.deficit_to_fire).toBe(948000);
    expect(f.funded_pct).toBe(1);
  });

  it('reports zero rather than NaN with no expenses', () => {
    const s = snap();
    s.expenses.total_monthly = 0;
    expect(modelFireNumber(s).funded_pct).toBe(0);
  });
});

describe('generateMilestones', () => {
  it('emits the 6/12/18-month checkpoints in order', () => {
    const { timeline } = modelNetWorth18mo(snap(), 85000, 0.30);
    const ms = generateMilestones(timeline, snap());
    const checkpoints = ms.filter((m) => m.type === 'net_worth').map((m) => m.month);
    expect(checkpoints).toEqual([6, 12, 18]);
    expect(ms.map((m) => m.month)).toEqual([...ms.map((m) => m.month)].sort((a, b) => a - b));
  });

  it('emits a Roth milestone once the cumulative saving clears the limit', () => {
    const { timeline } = modelNetWorth18mo(snap(), 85000, 0.30);
    const ms = generateMilestones(timeline, snap());
    expect(ms.filter((m) => m.type === 'roth_ira')).toHaveLength(1);
  });

  it('skips the emergency-fund milestone when it is already funded', () => {
    const s = snap();
    s.assets.savings = 60000;
    const { timeline } = modelNetWorth18mo(s, 85000, 0.30);
    expect(generateMilestones(timeline, s).some((m) => m.type === 'emergency_fund')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npx vitest run tests/planning.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/tools/planning.js`**

Port `nexus-app/server/nexus/tools/planning.js` plus `generateMilestones` from
`nexus-app/server/routes/planning.js:63`, applying rulings R3–R6 and R8:

```javascript
// Financial planning models — pure, no I/O. Dollars in, dollars out.
// TAX TABLES ARE 2024 (plan ruling R3): every take-home figure carries
// tax_year + grade 'B' so a stale bracket is visible at the point of use.
// Do not invent newer figures; update the table only against a cited source.
const TAX_YEAR = 2024;
const FICA_RATE = 0.0765;
const STANDARD_DEDUCTION = 14600;
const ROTH_IRA_LIMIT = 7000;
const DEFAULT_STATE_RATE = 0.05;

const FEDERAL_BRACKETS = [
  { rate: 0.10, upTo: 11600 },
  { rate: 0.12, upTo: 47150 },
  { rate: 0.22, upTo: 100525 },
  { rate: 0.24, upTo: 191950 },
  { rate: 0.32, upTo: 243725 },
  { rate: 0.35, upTo: 609350 },
  { rate: 0.37, upTo: Infinity },
];

const STATE_TAX_RATES = {
  AZ: 0.025, TX: 0, FL: 0, WA: 0, NV: 0,
  CA: 0.093, NY: 0.0685, IL: 0.0495, CO: 0.044,
};
```

`calcTakeHome` keeps the NEXUS arithmetic and appends `tax_year: TAX_YEAR, grade: 'B'`; it must return
`effective_rate: 0` (not `NaN`) when `grossAnnual` is 0.

`modelRaise` — R5 and R6:

```javascript
function modelRaise(snapshot, newSalary, gapWeeks = 0) {
  const gross = snapshot.income?.current_gross;
  if (!gross || gross <= 0) {
    return { needs_profile: true, monthly_delta: null, annual_delta: null,
             net_12mo_gain: null, allocation_plan: [], new_salary: newSalary };
  }
  // …NEXUS body, with `current = calcTakeHome(gross, state)`…
  // Build allocationPlan first, then:
  //   const ef = allocationPlan.find((a) => a.goal === 'Emergency Fund');
  //   months_to_emergency_fund: ef ? ef.months_to_goal : 0
  // and skip the whole allocation when monthlyDelta <= 0 (allocation_plan: []).
  // Always include needs_profile: false.
}
```

`modelEmergencyFund` — R4:

```javascript
const expenses = snapshot.expenses?.total_monthly || 0;
const liquid = (snapshot.assets?.checking || 0) + (snapshot.assets?.savings || 0);
const gross = snapshot.income?.current_gross || 0;
const state = snapshot.context?.state || 'AZ';
const surplus = gross > 0 ? calcTakeHome(gross, state).monthly_take_home - expenses : 0;
const currentMonths = expenses > 0 ? liquid / expenses : 0;
const funded_pct = target6mo > 0 ? Math.round((liquid / target6mo) * 100) : 0;
```

`modelRothIra` — R8 and the retirement guard:

```javascript
const years = Math.max(0, retirementAge - startAge);
const contribution = Math.min(annualContribution, ROTH_IRA_LIMIT);
// …compound…
assumed_rate: `${Math.round(rate * 1000) / 10}%`,
irs_limit: ROTH_IRA_LIMIT,
tax_year: TAX_YEAR,
```

`modelNetWorth18mo` and `modelFireNumber` port verbatim, with `funded_pct` guarded against a zero denominator.

`generateMilestones(timeline, snapshot)` takes **two** arguments (NEXUS passed the snapshot twice); keep the
emergency-fund / Roth / 6-12-18 checkpoint logic and the trailing `.sort((a, b) => a.month - b.month)`.

```javascript
module.exports = {
  TAX_YEAR, STATE_TAX_RATES, calcTakeHome, modelRaise, modelEmergencyFund,
  modelRothIra, modelNetWorth18mo, modelFireNumber, generateMilestones,
};
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run tests/planning.test.mjs
```
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add server/tools/planning.js tests/planning.test.mjs
git commit -F - <<'EOF'
feat(tools): port NEXUS planning math with dated tax tables

calcTakeHome now reports tax_year 2024 and evidence grade B so a stale bracket
is visible where the number is used (ruling R3). Rebuilt three weak parts:
modelEmergencyFund derives surplus from calcTakeHome instead of a hardcoded
0.74 factor (R4), modelRaise no longer invents a $65k salary and flags
needs_profile instead (R5), and months_to_emergency_fund now agrees with the
allocation plan (R6). 24 tests.
EOF
```

---

### Task 3: `server/tools/profile.js` — one snapshot from real accounts + declared profile

**Files:**
- Create: `server/tools/profile.js`
- Test: `tests/profile.test.mjs`

**Interfaces:**
- Consumes: the `snapshot` shape defined in Task 2; `store.readData()`'s `data` shape
  (`{ accounts: [{ id, name, type, balance, apr, min_payment }], transactions, recurring, categories, goals }`,
  balances in **dollars**).
- Produces:
  - `profileFromMmm(data, settings)` → `snapshot` (Task 2 shape) — **pure**, takes its inputs, opens nothing.
  - `PROFILE_FIELDS` → the ordered field list the intake UI and the settings validator share:
    `['name','age','state','filing_status','gross_salary','employment_status','income_end_date','retirement_age','risk_tolerance']`
  - `validateProfile(partial)` → `{ ok: boolean, errors: string[], value: object }`

- [ ] **Step 1: Write the failing test file**

Create `tests/profile.test.mjs`.

```javascript
import { describe, it, expect } from 'vitest';
import { profileFromMmm, validateProfile, PROFILE_FIELDS } from '../server/tools/profile.js';

const data = () => ({
  accounts: [
    { id: 'a1', name: 'Checking',  type: 'checking',   balance: 4000 },
    { id: 'a2', name: 'Savings',   type: 'savings',    balance: 6000 },
    { id: 'a3', name: 'Cash',      type: 'cash',       balance: 200 },
    { id: 'a4', name: '401k',      type: 'investment', balance: 18000 },
    { id: 'a5', name: 'Visa',      type: 'credit',     balance: -2500 },
    { id: 'a6', name: 'Car loan',  type: 'loan',       balance: -11000 },
  ],
  transactions: [],
  // NOTE: repo.readAll() converts amount_cents -> `amount` in DOLLARS before
  // any consumer sees a recurring row (server/db/repo.js rowRecurring). Every
  // fixture here and in Task 5 uses `amount`, matching tests/runway.test.mjs.
  recurring: [
    { id: 'r1', payee: 'Rent',     amount: 1400,  cadence: 'monthly',   kind: 'bill' },
    { id: 'r2', payee: 'Netflix',  amount: 15.99, cadence: 'monthly',   kind: 'bill' },
    { id: 'r3', payee: 'Car ins',  amount: 600,   cadence: 'quarterly', kind: 'bill' },
    { id: 'r4', payee: 'Paycheck', amount: 2500,  cadence: 'biweekly',  kind: 'income' },
  ],
  categories: [],
  goals: [],
});

describe('profileFromMmm', () => {
  it('derives liquid and retirement assets from real account types', () => {
    const s = profileFromMmm(data(), { profile: { gross_salary: 65000, state: 'AZ' } });
    expect(s.assets.checking).toBe(4000);
    expect(s.assets.savings).toBe(6200);       // savings + cash
    expect(s.assets.retirement).toBe(18000);
  });

  it('nets liabilities into current_net_worth', () => {
    const s = profileFromMmm(data(), { profile: { gross_salary: 65000 } });
    expect(s.context.current_net_worth).toBe(4000 + 6000 + 200 + 18000 - 2500 - 11000);
  });

  it('normalizes every recurring bill cadence into a monthly expense total', () => {
    const s = profileFromMmm(data(), { profile: {} });
    // 1400 + 15.99 + (600 / 3) = 1615.99
    expect(s.expenses.total_monthly).toBeCloseTo(1615.99, 2);
  });

  it('carries the declared salary and state through', () => {
    const s = profileFromMmm(data(), { profile: { gross_salary: 85000, state: 'TX' } });
    expect(s.income.current_gross).toBe(85000);
    expect(s.context.state).toBe('TX');
  });

  it('leaves current_gross null rather than guessing when undeclared', () => {
    const s = profileFromMmm(data(), {});
    expect(s.income.current_gross).toBeNull();
  });

  it('defaults the state to AZ and never re-types an account', () => {
    const d = data();
    const s = profileFromMmm(d, {});
    expect(s.context.state).toBe('AZ');
    expect(d.accounts.map((a) => a.type)).toEqual(
      ['checking', 'savings', 'cash', 'investment', 'credit', 'loan']);
  });

  it('grades A with a declared salary and real accounts, C with neither', () => {
    expect(profileFromMmm(data(), { profile: { gross_salary: 65000 } }).grade).toBe('A');
    expect(profileFromMmm({ accounts: [], transactions: [], recurring: [], categories: [], goals: [] }, {}).grade).toBe('C');
  });

  it('survives an empty database without throwing', () => {
    const s = profileFromMmm({ accounts: [], transactions: [], recurring: [], categories: [], goals: [] }, {});
    expect(s.expenses.total_monthly).toBe(0);
    expect(s.context.current_net_worth).toBe(0);
  });
});

describe('validateProfile', () => {
  it('accepts a full valid profile', () => {
    const r = validateProfile({
      name: 'Aaron', age: 24, state: 'AZ', filing_status: 'single', gross_salary: 65000,
      employment_status: 'employed', income_end_date: null, retirement_age: 65, risk_tolerance: 'moderate',
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects an out-of-range age and a bad filing status', () => {
    const r = validateProfile({ age: 300, filing_status: 'nope' });
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
  });

  it('rejects a non-YYYY-MM-DD income_end_date', () => {
    expect(validateProfile({ income_end_date: '11/02/2026' }).ok).toBe(false);
  });

  it('drops unknown keys instead of persisting them', () => {
    const r = validateProfile({ name: 'Aaron', ssn: '000-00-0000' });
    expect(r.value.ssn).toBeUndefined();
    expect(Object.keys(r.value)).toEqual(['name']);
  });

  it('exposes the field order the intake UI renders', () => {
    expect(PROFILE_FIELDS[0]).toBe('name');
    expect(PROFILE_FIELDS).toContain('gross_salary');
    expect(PROFILE_FIELDS).toHaveLength(9);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npx vitest run tests/profile.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/tools/profile.js`**

```javascript
// Fuses real MMM data with the user's declared profile into the one snapshot
// every planning model consumes. Pure: it opens nothing and mutates nothing.
const LIQUID_CHECKING = new Set(['checking']);
const LIQUID_SAVINGS  = new Set(['savings', 'cash']);
const RETIREMENT      = new Set(['investment']);

const PROFILE_FIELDS = [
  'name', 'age', 'state', 'filing_status', 'gross_salary',
  'employment_status', 'income_end_date', 'retirement_age', 'risk_tolerance',
];

const FILING_STATUSES  = ['single', 'married_joint', 'married_separate', 'head_of_household'];
const EMPLOYMENT       = ['employed', 'self_employed', 'contract', 'student', 'unemployed'];
const RISK             = ['conservative', 'moderate', 'aggressive'];

// Mirrors server/money/runway.js perMonth — keep the two in step.
function perMonth(amount, cadence) {
  const a = Math.abs(parseFloat(amount) || 0);
  if (cadence === 'weekly')    return a * 52 / 12;
  if (cadence === 'biweekly')  return a * 26 / 12;
  if (cadence === 'quarterly') return a / 3;
  if (cadence === 'annual')    return a / 12;
  return a;
}
```

`profileFromMmm(data, settings)`:
- `const p = settings?.profile || {}`
- sum `balance` by type set → `checking`, `savings` (savings + cash), `retirement`
- `current_net_worth` = sum of **all** account balances (liabilities already carry a negative balance)
- `expenses.total_monthly` = Σ `perMonth(r.amount, r.cadence)` over `recurring` where `kind === 'bill'`
  (`r.amount` is already dollars — `repo.readAll` converts `amount_cents` on the way out)
- `income.current_gross` = `Number(p.gross_salary) > 0 ? Number(p.gross_salary) : null`
- `context.state` = `p.state || 'AZ'`; `context.gap_period_weeks` = `0`
- `goals` = `{ emergency_fund_target, roth_ira_monthly, target_net_worth_18mo }` read from `p` when present,
  otherwise `undefined` so the models apply their own documented defaults
- `grade` = `'A'` when there is at least one account **and** a declared salary; `'B'` when one of the two is
  present; `'C'` when neither
- **Never write to `data`.** Never infer an account `type`.

`validateProfile(partial)` whitelists `PROFILE_FIELDS`, coerces numbers, and checks:
`age` 13–120, `retirement_age` 30–100, `gross_salary` ≥ 0, `state` a 2-letter A–Z string,
`filing_status` ∈ `FILING_STATUSES`, `employment_status` ∈ `EMPLOYMENT`, `risk_tolerance` ∈ `RISK`,
`income_end_date` `null` or `/^\d{4}-\d{2}-\d{2}$/`. Unknown keys are dropped, not rejected.

```javascript
module.exports = { profileFromMmm, validateProfile, PROFILE_FIELDS, FILING_STATUSES, EMPLOYMENT, RISK };
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run tests/profile.test.mjs
```
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add server/tools/profile.js tests/profile.test.mjs
git commit -F - <<'EOF'
feat(tools): profileFromMmm builds the planning snapshot from real accounts

One pure snapshot builder fuses declared settings.profile facts with real
account balances and recurring bills; never re-types an account and never
guesses a salary. Adds validateProfile over a 9-field whitelist. 13 tests.
EOF
```

---

### Task 4: `/api/plan` router

**Files:**
- Create: `server/tools/routes.js`
- Modify: `server/index.js` (mount the router)
- Test: `tests/plan-routes.test.mjs`

**Interfaces:**
- Consumes: `loans.js`, `planning.js`, `profile.js` from Tasks 1–3; `server/money/store.js` `readData()`;
  `server/db/repo.js` `getSettings`/`setSettings` and `server/db/connection.js` `db()`.
- Produces these endpoints (all under `/api/plan`), consumed by Tasks 9–11:
  | Method | Path | Body / query | Returns |
  |---|---|---|---|
  | GET  | `/snapshot` | — | the snapshot + `grade` |
  | GET  | `/profile` | — | `{ profile, complete: boolean }` |
  | PUT  | `/profile` | partial profile | `{ profile }` or 400 `{ error }` |
  | POST | `/take-home` | `{ gross_salary, state? }` | `calcTakeHome` result |
  | POST | `/offer` | `{ new_salary, gap_weeks?, state? }` | `{ current, offer, delta_monthly_take_home, delta_runway_months, delta_net_worth_18mo, net_12mo_gain, tax_year, grade }` |
  | POST | `/raise` | `{ new_salary, gap_weeks? }` | `modelRaise` result |
  | GET  | `/emergency-fund` | — | `modelEmergencyFund` result |
  | POST | `/roth` | `{ annual_contribution, start_age?, retirement_age?, rate? }` | `modelRothIra` result |
  | GET  | `/fire` | — | `modelFireNumber` result |
  | POST | `/what-if` | `{ new_salary, savings_rate?, expenses_monthly?, gap_weeks? }` | `{ ...modelNetWorth18mo, milestones }` |
  | POST | `/mortgage` | `{ purchase_price, down_payment_pct?, annual_rate, term_years? }` | `calcMortgage` result |
  | POST | `/auto-loan` | `{ vehicle_price, down_payment?, trade_in?, annual_rate, term_months? }` | `calcAutoLoan` result |
  | POST | `/refi` | `{ current_rate, new_rate, balance, years_remaining, closing_costs }` | `calcRefiBreakeven` result |
  | POST | `/dti` | `{ monthly_debts?, gross_monthly_income? }` | `calcDti` result |

- [ ] **Step 1: Write the failing route test**

Create `tests/plan-routes.test.mjs`, following the ephemeral-server pattern from `tests/glossary-route.test.mjs`.

```javascript
// Route-level test: mounts the plan router on an ephemeral Express server
// against the temp MMM_DATA_DIR from tests/setup.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import routes from '../server/tools/routes.js';
import store from '../server/money/store.js';

let server; let base;

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  store.reset();
  const data = store.readData();
  data.accounts = [
    { id: 'a1', name: 'Checking', type: 'checking', balance: 4000, opening_balance: 4000 },
    { id: 'a2', name: 'Savings',  type: 'savings',  balance: 6000, opening_balance: 6000 },
  ];
  data.recurring = [
    { id: 'r1', payee: 'Rent', amount: 3200, cadence: 'monthly', kind: 'bill', next_date: '2026-10-01' },
  ];
  store.writeData(data);

  const app = express();
  app.use(express.json());
  app.use('/api/plan', routes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/plan`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('profile round-trip', () => {
  it('starts incomplete', async () => {
    const res = await fetch(`${base}/profile`);
    expect((await res.json()).complete).toBe(false);
  });

  it('persists a valid profile and reports complete', async () => {
    const put = await fetch(`${base}/profile`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Aaron', state: 'AZ', gross_salary: 65000, age: 24 }),
    });
    expect(put.status).toBe(200);
    const res = await fetch(`${base}/profile`);
    const body = await res.json();
    expect(body.profile.gross_salary).toBe(65000);
    expect(body.complete).toBe(true);
  });

  it('400s an invalid profile with a real message', async () => {
    const res = await fetch(`${base}/profile`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ age: 300 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/age/i);
  });
});

describe('GET /snapshot', () => {
  it('fuses the declared salary with real balances', async () => {
    const body = await (await fetch(`${base}/snapshot`)).json();
    expect(body.assets.checking).toBe(4000);
    expect(body.expenses.total_monthly).toBe(3200);
    expect(body.income.current_gross).toBe(65000);
    expect(body.grade).toBe('A');
  });
});

describe('POST /offer', () => {
  it('returns the three deltas the Plan section shows', async () => {
    const { status, body } = await post('/offer', { new_salary: 85000, gap_weeks: 0 });
    expect(status).toBe(200);
    expect(body.delta_monthly_take_home).toBe(1131);
    expect(typeof body.delta_runway_months).toBe('number');
    expect(typeof body.delta_net_worth_18mo).toBe('number');
    expect(body.tax_year).toBe(2024);
  });

  it('400s without a new_salary', async () => {
    expect((await post('/offer', {})).status).toBe(400);
  });
});

describe('loan endpoints', () => {
  it('computes a mortgage', async () => {
    const { body } = await post('/mortgage', { purchase_price: 400000, down_payment_pct: 0, annual_rate: 7, term_years: 30 });
    expect(body.monthly_pi).toBeCloseTo(2661.21, 2);
  });

  it('computes a refi breakeven', async () => {
    const { body } = await post('/refi', { current_rate: 7, new_rate: 5.5, balance: 300000, years_remaining: 25, closing_costs: 6000 });
    expect(body.breakeven_months).toBe(22);
  });

  it('defaults DTI inputs from real data when the body omits them', async () => {
    const { body } = await post('/dti', {});
    expect(body.gross_monthly_income).toBeGreaterThan(0);
  });

  it('400s a mortgage with a missing rate', async () => {
    expect((await post('/mortgage', { purchase_price: 400000 })).status).toBe(400);
  });
});

describe('POST /what-if', () => {
  it('returns an 18-row timeline with milestones', async () => {
    const { body } = await post('/what-if', { new_salary: 85000, savings_rate: 0.3 });
    expect(body.timeline).toHaveLength(18);
    expect(Array.isArray(body.milestones)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npx vitest run tests/plan-routes.test.mjs
```
Expected: FAIL — `server/tools/routes.js` not found.

- [ ] **Step 3: Write `server/tools/routes.js` and mount it**

Follow the shape of `server/money/routes.js`: `express.Router()`, `try/catch` per handler, `res.status(400)` with
`{ error }` on bad input.

```javascript
const express = require('express');
const store   = require('../money/store');
const repo    = require('../db/repo');
const { db }  = require('../db/connection');
const loans   = require('./loans');
const planning = require('./planning');
const { profileFromMmm, validateProfile } = require('./profile');
const { computeRunway } = require('../money/runway');

const router = express.Router();

function snapshot() {
  return profileFromMmm(store.readData(), repo.getSettings(db()) || {});
}
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
function need(res, name, v) {
  if (v === null || !Number.isFinite(v)) { res.status(400).json({ error: `${name} is required` }); return false; }
  return true;
}
```

`PUT /profile` merges through `validateProfile` and writes with
`repo.setSettings(db(), { profile: { ...existing, ...value } })`. `complete` means `gross_salary` and `state`
are both present.

`POST /offer` is the one composite endpoint — it is what "Model an offer" (spec §5) renders:

```javascript
router.post('/offer', (req, res) => {
  try {
    const newSalary = num(req.body.new_salary);
    if (!need(res, 'new_salary', newSalary)) return;
    const gapWeeks = num(req.body.gap_weeks) || 0;
    const snap = snapshot();
    const state = req.body.state || snap.context.state;
    const data = store.readData();

    const current = snap.income.current_gross
      ? planning.calcTakeHome(snap.income.current_gross, state) : null;
    const offer = planning.calcTakeHome(newSalary, state);

    // Δ runway: re-run the real runway engine with the new monthly take-home
    // added to liquid cash for one month. Same engine as the Overview headline,
    // so the two can never disagree.
    const baseRunway = computeRunway({ ...data });
    const withOffer = computeRunway({
      ...data,
      accounts: data.accounts.map((a) => (a.type === 'checking'
        ? { ...a, balance: (parseFloat(a.balance) || 0) + offer.monthly_take_home }
        : a)),
    });

    const nwBase = snap.income.current_gross
      ? planning.modelNetWorth18mo(snap, snap.income.current_gross, 0.30).final_net_worth : null;
    const nwOffer = planning.modelNetWorth18mo(snap, newSalary, 0.30).final_net_worth;
    const raise = planning.modelRaise(snap, newSalary, gapWeeks);

    res.json({
      current, offer,
      delta_monthly_take_home: current ? offer.monthly_take_home - current.monthly_take_home : null,
      delta_runway_months: Math.round(((withOffer.months || 0) - (baseRunway.months || 0)) * 10) / 10,
      delta_net_worth_18mo: nwBase === null ? null : nwOffer - nwBase,
      net_12mo_gain: raise.net_12mo_gain,
      needs_profile: raise.needs_profile === true,
      tax_year: offer.tax_year,
      grade: snap.grade === 'A' ? 'B' : snap.grade, // projection off a dated bracket table
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

`POST /dti` with an empty body defaults `gross_monthly_income` to
`snap.income.current_gross / 12` and `monthly_debts` to the sum of `min_payment` over `loan`/`credit` accounts
(same derivation as `server/money/routes.js:551`), returning both inputs in the response so the UI can show
what it used.

`POST /what-if` calls `modelNetWorth18mo` on a snapshot whose `expenses.total_monthly` is overridden by
`expenses_monthly` when supplied, then attaches `generateMilestones(result.timeline, snap)`.

Mount in `server/index.js` beside the other routers:

```javascript
const planRoutes = require('./tools/routes');
// …
app.use('/api/plan', planRoutes);
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run tests/plan-routes.test.mjs
```
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add server/tools/routes.js server/index.js tests/plan-routes.test.mjs
git commit -F - <<'EOF'
feat(plan): expose loan and planning math at /api/plan

Fourteen endpoints over the pure tools modules, including the composite
/offer that returns the three deltas Model-an-offer renders. Delta runway
reuses server/money/runway.js so the Plan section and the Overview headline
can never disagree. 11 route tests against an ephemeral server.
EOF
```

---

### Task 5: quarterly and annual recurring cadences

**Files:**
- Modify: `server/middleware/validators.js`, `server/money/store.js`, `server/money/runway.js`, `server/money/calc.js`
- Test: `tests/cadence.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CADENCES` = `['monthly', 'biweekly', 'weekly', 'quarterly', 'annual']`, honoured by
  `advanceDate` (store) and every monthly normalizer. Task 12's subscriptions view depends on this.

**Why this is its own task:** every existing normalizer falls through to "treat as monthly". Adding the cadences
without fixing them would silently multiply a quarterly bill by 3 in runway, advice and cash-flow forecasts.
Before implementing, run this and fix **every** hit:

```bash
git grep -n "biweekly" -- server src
```

- [ ] **Step 1: Write the failing test**

Create `tests/cadence.test.mjs`.

```javascript
import { describe, it, expect, beforeAll } from 'vitest';
import { computeRunway } from '../server/money/runway.js';
import { CADENCES } from '../server/middleware/validators.js';
import store from '../server/money/store.js';

describe('CADENCES', () => {
  it('accepts quarterly and annual', () => {
    expect(CADENCES).toEqual(['monthly', 'biweekly', 'weekly', 'quarterly', 'annual']);
  });
});

describe('runway normalization', () => {
  const base = {
    accounts: [{ id: 'a1', type: 'checking', balance: 12000 }],
    transactions: [], categories: [], today: new Date(2026, 8, 17),
  };

  // `amount` is dollars and the returned key is `monthlyBurn` — see
  // tests/runway.test.mjs and server/money/runway.js:86.
  it('spreads a quarterly bill over three months', () => {
    const r = computeRunway({ ...base, recurring: [{ id: 'r1', payee: 'Ins', amount: 600, cadence: 'quarterly', kind: 'bill' }] });
    expect(r.monthlyBurn).toBeCloseTo(200, 2);
    expect(r.burnSource).toBe('recurring');
  });

  it('spreads an annual bill over twelve months', () => {
    const r = computeRunway({ ...base, recurring: [{ id: 'r1', payee: 'Domain', amount: 1200, cadence: 'annual', kind: 'bill' }] });
    expect(r.monthlyBurn).toBeCloseTo(100, 2);
  });
});

describe('advanceDate', () => {
  it('advances a quarterly item by three months', () => {
    expect(store.advanceDate('2026-01-31', 'quarterly')).toBe('2026-04-30');
  });
  it('advances an annual item by one year', () => {
    expect(store.advanceDate('2026-02-29', 'annual')).toBe('2027-02-28');
  });
  it('still advances weekly and monthly', () => {
    expect(store.advanceDate('2026-09-17', 'weekly')).toBe('2026-09-24');
    expect(store.advanceDate('2026-09-17', 'monthly')).toBe('2026-10-17');
  });
});

describe('postDueRecurring with new cadences', () => {
  beforeAll(() => { store.reset(); });

  it('posts a due quarterly bill once and schedules the next quarter', () => {
    const data = store.readData();
    data.accounts = [{ id: 'a1', name: 'Checking', type: 'checking', balance: 5000, opening_balance: 5000 }];
    data.recurring = [{ id: 'r1', payee: 'Car insurance', amount: 600, cadence: 'quarterly', kind: 'bill', next_date: '2026-01-01', account_id: 'a1' }];
    store.writeData(data);

    const { posted } = store.postDueRecurring();
    expect(posted).toBeGreaterThan(0);
    const after = store.readData();
    expect(after.recurring[0].next_date > '2026-01-01').toBe(true);
    // Every posted date must be a quarter apart.
    const dates = after.transactions.filter((t) => t.payee === 'Car insurance').map((t) => t.date).sort();
    expect(new Set(dates).size).toBe(dates.length);
  });
});
```

If `advanceDate` is not currently exported from `server/money/store.js`, add it to `module.exports` in this task.

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npx vitest run tests/cadence.test.mjs
```
Expected: FAIL — `CADENCES` has 3 entries; quarterly burn comes back as 600.

- [ ] **Step 3: Implement**

`server/middleware/validators.js:9`
```javascript
const CADENCES = ['monthly', 'biweekly', 'weekly', 'quarterly', 'annual'];
```

`server/money/store.js` — `advanceDate` (around line 281). Month arithmetic must clamp, not roll over
(Jan 31 + 3 months is Apr 30, not May 1):

```javascript
function addMonthsClamped(d, n) {
  const day = d.getDate();
  const probe = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(probe.getFullYear(), probe.getMonth() + 1, 0).getDate();
  probe.setDate(Math.min(day, lastDay));
  return probe;
}
```
Then: `weekly` +7d, `biweekly` +14d, `quarterly` → `addMonthsClamped(d, 3)`, `annual` → `addMonthsClamped(d, 12)`,
default (`monthly`) → `addMonthsClamped(d, 1)`. **Apply the same clamp to the existing monthly branch** — today it
uses `setMonth`, which rolls Jan 31 to Mar 3.

`server/money/runway.js` — `perMonth` gains `quarterly` (`a / 3`) and `annual` (`a / 12`).

`server/money/calc.js` — the `perMonth` at line ~246 gains the same two branches. Detection
(`detectRecurring`, line ~122) keeps its three interval bands; do **not** try to detect quarterly from history
in this phase — declared cadences only.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run tests/cadence.test.mjs tests/runway.test.mjs tests/store.test.mjs tests/calc.test.mjs
```
Expected: PASS. If the monthly clamp change breaks an existing `store.test.mjs` expectation, the old expectation
encoded the roll-over bug — update it and note the change in the commit body.

- [ ] **Step 5: Commit**

```bash
git add server/middleware/validators.js server/money/store.js server/money/runway.js server/money/calc.js tests/cadence.test.mjs
git commit -F - <<'EOF'
feat(recurring): add quarterly and annual cadences

Every monthly normalizer (runway burn, calc forecasting) previously fell
through to "treat as monthly", which would have overstated a quarterly bill
3x. advanceDate now clamps month arithmetic so Jan 31 + 1 month is Feb 28,
not Mar 3 — that fixes the existing monthly branch too. 8 tests.
EOF
```

---

### Task 6: shared UI primitives on v3 tokens

**Files:**
- Create: `src/components/money/shared/Tooltip.jsx`, `InfoIcon.jsx`, `AnimatedNumber.jsx`, `MetricCard.jsx`,
  `ErrorState.jsx`, `Skeleton.jsx`
- Modify: `src/styles/money-theme.css`

**Interfaces:**
- Consumes: v3 tokens from `src/styles/theme.css`; `lucide-react`; `motion` (already dependencies).
- Produces, for Tasks 7–12:
  - `<Tooltip content={node} placement="top"|"bottom">{children}</Tooltip>`
  - `<InfoIcon content={node} />`
  - `<AnimatedNumber value={number} format={(n) => string} duration={600} />`
  - `<MetricCard label={string} value={node} sublabel={node} delta={number} grade={'A'|'B'|'C'} icon={Component} />`
  - `<ErrorState message={string} onRetry={fn} />`
  - `<Skeleton width height style />`

**Porting note:** these come from `nexus-app/src/components/{layout,ui,dashboard}/`. NEXUS's versions use
`GlassCard`, a `cn()` helper and a `motionPresets` module that MMM does not have. **Rebuild on v3 tokens; no glass,
no `cn`, no new dependency.** Match MMM's existing inline-style idiom (see `shared/Grade.jsx`, `shared/BigStat.jsx`).

- [ ] **Step 1: Write `Skeleton.jsx` and `ErrorState.jsx`**

```jsx
// Skeleton.jsx
export default function Skeleton({ width = '100%', height = 16, style }) {
  return <div className="m-skeleton" style={{ width, height, ...style }} />;
}
```

```jsx
// ErrorState.jsx
import { AlertTriangle } from 'lucide-react';

export default function ErrorState({ message = 'Something went wrong.', onRetry }) {
  return (
    <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 16,
      border: '1px solid var(--m-border)', borderRadius: 8, background: 'var(--m-surface-2)' }}>
      <AlertTriangle size={18} style={{ color: 'var(--m-red)', flexShrink: 0 }} aria-hidden="true" />
      <span style={{ fontSize: 13, color: 'var(--m-ink-2)', flex: 1 }}>{message}</span>
      {onRetry && <button className="m-btn m-btn-secondary" onClick={onRetry}>Retry</button>}
    </div>
  );
}
```

- [ ] **Step 2: Write `Tooltip.jsx` and `InfoIcon.jsx`**

Hover **and** keyboard-focus triggered (spec §7 accessibility), positioned with CSS only — no measurement,
no portal. Add `.m-tooltip` / `.m-tooltip-bubble` to `src/styles/money-theme.css` using
`var(--m-surface-3)`, `var(--m-border)`, `var(--m-ink)`.

```jsx
// Tooltip.jsx
import { useState, useId } from 'react';

export default function Tooltip({ content, placement = 'top', children }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!content) return children;
  return (
    <span className="m-tooltip"
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      <span aria-describedby={open ? id : undefined} tabIndex={0} style={{ display: 'inline-flex' }}>
        {children}
      </span>
      {open && <span role="tooltip" id={id} className={`m-tooltip-bubble m-tooltip-${placement}`}>{content}</span>}
    </span>
  );
}
```

```jsx
// InfoIcon.jsx
import { Info } from 'lucide-react';
import Tooltip from './Tooltip';

export default function InfoIcon({ content, size = 13 }) {
  return (
    <Tooltip content={content}>
      <Info size={size} style={{ color: 'var(--m-muted)' }} aria-label="More information" />
    </Tooltip>
  );
}
```

- [ ] **Step 3: Write `AnimatedNumber.jsx`**

Must respect `prefers-reduced-motion` (spec §7) by rendering the final value immediately.

```jsx
import { useEffect, useRef, useState } from 'react';

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function AnimatedNumber({ value = 0, format = (n) => String(Math.round(n)), duration = 600 }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced() || duration <= 0) { setShown(value); from.current = value; return; }
    const start = performance.now();
    const a = from.current;
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      setShown(a + (value - a) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{format(shown)}</span>;
}
```

- [ ] **Step 4: Write `MetricCard.jsx`**

Colour must be paired with a sign or icon, numbers tabular, **no `cursor: pointer`** (global constraints).

```jsx
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import Grade from './Grade';

export default function MetricCard({ label, value, sublabel, delta, grade, icon: Icon }) {
  const up = Number(delta) > 0;
  const down = Number(delta) < 0;
  return (
    <div style={{ background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {Icon && <Icon size={14} style={{ color: 'var(--m-muted)' }} aria-hidden="true" />}
        <span style={{ fontSize: 12, color: 'var(--m-ink-2)' }}>{label}</span>
        {grade && <Grade grade={grade} style={{ marginLeft: 'auto' }} />}
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--m-ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {(sublabel || delta !== undefined) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 12,
          color: up ? 'var(--m-green)' : down ? 'var(--m-red)' : 'var(--m-ink-2)' }}>
          {up && <ArrowUpRight size={13} aria-hidden="true" />}
          {down && <ArrowDownRight size={13} aria-hidden="true" />}
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{sublabel}</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify the build and contrast gate**

```bash
npm run build
npm run check:contrast
```
Expected: build succeeds (read `VITE_EXIT`); contrast passes. **Do not run `build:portable` in the same breath.**

- [ ] **Step 6: Commit**

```bash
git add src/components/money/shared src/styles/money-theme.css
git commit -F - <<'EOF'
feat(ui): shared primitives on v3 tokens

Tooltip (hover + keyboard), InfoIcon, AnimatedNumber (honours reduced motion),
MetricCard, ErrorState and Skeleton. Rebuilt rather than copied from NEXUS —
its versions depend on GlassCard, cn() and motionPresets, none of which exist
here and none of which fit the v3 token system.
EOF
```

---

### Task 7: grouped sidebar + nested routes + placeholders

**Files:**
- Modify: `src/components/money/MoneyHub.jsx`, `src/styles/money-theme.css`

**Interfaces:**
- Consumes: `settings.nav` (new key, shape `{ collapsed: { [groupId]: boolean } }`), persisted via `saveSettings`.
- Produces: `SECTIONS` entries gain `group`; nested-route support (`path={`/${id}/*`}`) that Task 9 uses for
  `/plan/:tab`.

- [ ] **Step 1: Add groups to `SECTIONS`**

```javascript
const GROUPS = [
  { id: 'money',  label: 'MONEY' },
  { id: 'plan',   label: 'PLAN' },
  { id: 'invest', label: 'INVEST' },
  { id: 'grow',   label: 'GROW' },
];

const SECTIONS = [
  { id: 'overview',     label: 'Overview',             icon: LayoutDashboard, group: 'money' },
  { id: 'accounts',     label: 'Accounts & Net Worth', icon: Wallet,          group: 'money' },
  { id: 'transactions', label: 'Transactions',         icon: Receipt,         group: 'money' },
  { id: 'budget',       label: 'Budget',               icon: PiggyBank,       group: 'money' },
  { id: 'cashflow',     label: 'Cash Flow',            icon: Zap,             group: 'money' },
  { id: 'goals',        label: 'Goals',                icon: Target,          group: 'money' },
  { id: 'debt',         label: 'Debt Payoff',          icon: CreditCard,      group: 'money' },
  { id: 'investments',  label: 'Investments',          icon: TrendingUp,      group: 'money' },
  { id: 'reports',      label: 'Reports',              icon: FileText,        group: 'money' },
  // `soon` here is TEMPORARY — Task 9 creates sections/Plan.jsx, deletes this
  // `soon` string and adds the IMPORTERS entry. Without it, LAZY['plan'] is
  // undefined and `/plan` throws instead of rendering.
  { id: 'plan',         label: 'Plan',                 icon: Compass,         group: 'plan',   soon: 'Planning tools land in the next step of this phase.' },
  { id: 'markets',      label: 'Markets',              icon: LineChart,       group: 'invest', soon: 'Markets lands with the online data seam.' },
  { id: 'desk',         label: 'Desk',                 icon: Brain,           group: 'invest', soon: 'The research desk lands after the LLM contract.' },
  { id: 'trades',       label: 'Trades',               icon: CandlestickChart, group: 'invest', soon: 'Paper trading lands with the paper ledger.' },
  { id: 'learn',        label: 'Learn',                icon: GraduationCap,   group: 'grow' },
  { id: 'media',        label: 'Media',                icon: Newspaper,       group: 'grow', soon: 'News and video land with the media rebuild.' },
  { id: 'settings',     label: 'Settings & Privacy',   icon: Settings },      // ungrouped, pinned to the bottom
];
```

Import the new icons from `lucide-react`: `Compass`, `LineChart`, `Brain`, `CandlestickChart`, `Newspaper`.
Sections carrying `soon` have **no** entry in `IMPORTERS`; they render `<ComingSoon>` directly.

- [ ] **Step 2: Render the grouped, collapsible sidebar**

Replace the flat `SECTIONS.map` in the `<nav>` with a group loop. Collapsed state is read once from
`/api/settings` and written back through `saveSettings({ nav: { collapsed } })` — fire-and-forget, never blocking.
Group headers are `<button aria-expanded>` with a chevron, styled `.m-sidebar-group`, `.m-sidebar-group-label`
(uppercase, `font-size: 10px`, `letter-spacing: .08em`, `color: var(--m-muted)`). Settings renders after the
groups, separated by a `1px solid var(--m-border)` rule and `margin-top: auto`.

A collapsed group that contains the active route must still show the active item — collapse hides the other items,
never the one you are on.

- [ ] **Step 3: Switch to nested routes**

```jsx
<Routes>
  <Route path="/" element={<Navigate to="/overview" replace />} />
  {SECTIONS.map(({ id, label, soon }) => (
    <Route
      key={id}
      path={`/${id}/*`}
      element={soon ? <ComingSoon title={label} description={soon} /> : (() => { const S = LAZY[id]; return <S />; })()}
    />
  ))}
  <Route path="*" element={<Navigate to="/overview" replace />} />
</Routes>
```

The trailing `/*` is what lets Task 9 declare `/plan/:tab` inside `Plan.jsx`. Import `ComingSoon` from
`./shared/ComingSoon`. Keep `<ErrorBoundary key={location.pathname}>` and the `Suspense` fallback as they are.

- [ ] **Step 4: Verify in the running app**

```bash
npm run build
npm start
```
Then in the browser at `http://127.0.0.1:5006`:
- all four group headers render; clicking one collapses it and the state survives a reload
- `#/markets` shows a one-line status card, not a blank page or a redirect
- `#/overview`, `#/budget`, `#/cashflow`, `#/debt` all still load
- `#/plan` shows its temporary status card (Task 9 replaces it with the real section)

- [ ] **Step 5: Commit**

```bash
git add src/components/money/MoneyHub.jsx src/styles/money-theme.css
git commit -F - <<'EOF'
feat(nav): grouped collapsible sidebar and nested routes

SECTIONS gains `group`; MONEY / PLAN / INVEST / GROW headers collapse and
persist to settings.nav. Routes become `/:section/*` so sub-tabs can be
nested routes rather than useState. Unbuilt sections render a one-line
status card instead of disappearing from the nav.
EOF
```

---

### Task 8: Ctrl+K command palette and `?` shortcut sheet

**Files:**
- Create: `src/components/money/shared/CommandPalette.jsx`, `src/components/money/shared/KeyboardShortcuts.jsx`
- Modify: `src/components/money/MoneyHub.jsx`, `src/styles/money-theme.css`

**Interfaces:**
- Consumes: `SECTIONS` (Task 7), `api('money/overview')` for accounts and `api('money/payee-stats')` for payees,
  `useNavigate` from react-router.
- Produces: `<CommandPalette sections={SECTIONS} />` and `<KeyboardShortcuts />`, both self-mounting their own
  key listeners.

**Porting note:** NEXUS's `CommandPalette.jsx` is bound to market tickers, a tab-id callback, `cn()` and
`motionPresets`. Keep its **interaction model** — fuzzy subsequence match, grouped results, ↑/↓ + Enter + Esc,
input auto-focus — and rebuild the data sources over MMM's sections, accounts, payees and actions (ruling R2).

- [ ] **Step 1: Write `CommandPalette.jsx`**

```jsx
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '../../../lib/query';

function fuzzyMatch(query, str) {
  if (!query) return true;
  const q = query.toLowerCase(); const s = str.toLowerCase();
  let qi = 0;
  for (let i = 0; i < s.length && qi < q.length; i++) if (s[i] === q[qi]) qi++;
  return qi === q.length;
}

const ACTIONS = [
  { id: 'act-quickadd', label: 'Add a transaction',  meta: 'Action', run: () => window.dispatchEvent(new CustomEvent('mmm:quickadd')) },
  { id: 'act-settings', label: 'Open Settings',      meta: 'Action', to: '/settings' },
  { id: 'act-offer',    label: 'Model a job offer',  meta: 'Action', to: '/plan/offer' },
];
```

Behaviour:
- `keydown` on `window`: `Ctrl+K`/`Cmd+K` toggles open and `preventDefault()`s the browser's find;
  `Escape` closes. Register once in a `useEffect` with `[]` and remove on unmount.
- On open, lazily fetch accounts and payees **once per open** and cache them in a ref;
  a failed fetch degrades to sections + actions only, never an error.
- Result groups in order: **Sections**, **Accounts** (→ `/accounts`), **Payees** (→ `/transactions?payee=…`),
  **Actions**. Cap each group at 5 rows.
- `activeIndex` moves with ↑/↓ across the **flattened** list, wraps at both ends, resets to 0 on every query
  change. Enter runs the active row; clicking a row runs it. Every run closes the palette.
- The dialog is `role="dialog" aria-modal="true"`, the input `aria-controls` the listbox,
  rows are `role="option"` with `aria-selected`. Focus goes to the input on open and returns to
  `document.body` on close.
- Styling via `.m-palette*` classes on v3 tokens. **No `cursor: pointer` on the container**; rows are buttons,
  where a pointer cursor is correct.

- [ ] **Step 2: Write `KeyboardShortcuts.jsx`**

Opens on `?` (`event.key === '?'`) **only when the event target is not an input, textarea, or `contentEditable`**,
closes on Escape or a backdrop click. Renders a two-column table: `Ctrl K` open the command palette,
`?` this sheet, `G` then `O` overview, `G` then `P` plan, `Esc` close. Implement only the two shortcuts that
exist (`Ctrl+K`, `?`) plus Escape — **do not** invent `G`-prefixed navigation this phase; list only what works.

- [ ] **Step 3: Mount both in `MoneyHub.jsx`**

Beside `<QuickAdd />`, inside the `(entered || !isEmpty) && !isLoading` guard:

```jsx
<CommandPalette sections={SECTIONS} />
<KeyboardShortcuts />
```

Have `QuickAdd` listen for the `mmm:quickadd` window event so the palette's "Add a transaction" action opens it.

- [ ] **Step 4: Verify in the running app**

```bash
npm run build
npm start
```
- `Ctrl+K` opens; typing `cas` selects Cash Flow by subsequence; Enter navigates; Esc closes
- ↑/↓ wrap at both ends; the active row is visibly highlighted
- `?` opens the sheet; `?` typed **inside** the Quick Add note field does **not**
- with the server stopped, `Ctrl+K` still lists sections and actions

- [ ] **Step 5: Commit**

```bash
git add src/components/money/shared/CommandPalette.jsx src/components/money/shared/KeyboardShortcuts.jsx src/components/money/MoneyHub.jsx src/styles/money-theme.css
git commit -F - <<'EOF'
feat(nav): Ctrl+K command palette and ? shortcut sheet

Fuzzy subsequence search over sections, accounts, payees and actions with
full keyboard navigation and ARIA listbox semantics. Rebuilt on MMM's data
rather than ported verbatim — the NEXUS palette is bound to market tickers
and a tab-id callback. Degrades to sections + actions when offline.
EOF
```

---

### Task 9: the Plan section

**Files:**
- Create: `src/components/money/sections/Plan.jsx`,
  `src/components/money/sections/parts/plan/{TakeHome,ModelOffer,Raise,Retirement,WhatIf}.jsx`
- Modify: `src/components/money/MoneyHub.jsx` (add `plan` to `IMPORTERS`)

**Interfaces:**
- Consumes: `/api/plan/*` from Task 4; `MetricCard`, `AnimatedNumber`, `InfoIcon`, `ErrorState`, `Skeleton`
  from Task 6; `Grade`, `Card`, `SectionHeader`, `Money` from existing `shared/`.
- Produces: routes `/plan/take-home`, `/plan/offer`, `/plan/raise`, `/plan/retirement`, `/plan/what-if`;
  `/plan` redirects to `/plan/take-home`.

- [ ] **Step 1: Write the section shell with nested routes**

```jsx
import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import SectionHeader from '../shared/SectionHeader';
import Skeleton from '../shared/Skeleton';

const TABS = [
  { id: 'take-home',  label: 'Take-home',      Comp: lazy(() => import('./parts/plan/TakeHome')) },
  { id: 'offer',      label: 'Model an offer', Comp: lazy(() => import('./parts/plan/ModelOffer')) },
  { id: 'raise',      label: 'Raise',          Comp: lazy(() => import('./parts/plan/Raise')) },
  { id: 'retirement', label: 'Roth & FIRE',    Comp: lazy(() => import('./parts/plan/Retirement')) },
  { id: 'what-if',    label: 'What-if',        Comp: lazy(() => import('./parts/plan/WhatIf')) },
];

export default function Plan() {
  return (
    <div>
      <SectionHeader title="Plan" subtitle="Model the money decisions in front of you." />
      <div className="m-tabs" role="tablist">
        {TABS.map((t) => (
          <NavLink key={t.id} to={`/plan/${t.id}`} role="tab"
            className={({ isActive }) => `m-tab ${isActive ? 'active' : ''}`}>{t.label}</NavLink>
        ))}
      </div>
      <Suspense fallback={<Skeleton height={280} style={{ marginTop: 16 }} />}>
        <Routes>
          <Route path="/" element={<Navigate to="take-home" replace />} />
          {TABS.map(({ id, Comp }) => <Route key={id} path={id} element={<Comp />} />)}
          <Route path="*" element={<Navigate to="take-home" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}
```

In `MoneyHub.jsx`: add `plan: () => import('./sections/Plan')` to `IMPORTERS` **and delete the temporary
`soon` string from the `plan` entry in `SECTIONS`** that Task 7 left there.

- [ ] **Step 2: Write `TakeHome.jsx`**

Reads `GET /api/plan/profile`. When `complete` is false, render a card that says what is missing and links to
`#/settings` — **never** compute against a guessed salary. Otherwise `POST /api/plan/take-home` with an editable
salary + state, and render `MetricCard`s for annual take-home, monthly take-home, effective rate, and a
federal/state/FICA breakdown. Render the tax year beside the effective rate:

```jsx
<span style={{ fontSize: 11, color: 'var(--m-muted)' }}>{data.tax_year} brackets</span>
<Grade grade={data.grade} />
```

- [ ] **Step 3: Write `ModelOffer.jsx` — the job-sprint payload**

This is the spec's headline deliverable. Inputs: offer salary, state, weeks of unpaid gap.
`POST /api/plan/offer` on submit (not on every keystroke). Render exactly three deltas in a row of `MetricCard`s:

```jsx
<MetricCard label="Δ take-home"        value={<Money cents={Math.round(d.delta_monthly_take_home * 100)} />} sublabel="per month" delta={d.delta_monthly_take_home} grade={d.grade} />
<MetricCard label="Δ runway"           value={<AnimatedNumber value={d.delta_runway_months} format={(n) => `${n > 0 ? '+' : ''}${n.toFixed(1)} mo`} />} sublabel="months of cash" delta={d.delta_runway_months} grade={d.grade} />
<MetricCard label="Δ 18-mo net worth"  value={<Money cents={Math.round(d.delta_net_worth_18mo * 100)} />} sublabel="vs. staying put" delta={d.delta_net_worth_18mo} grade={d.grade} />
```

Below them show `net_12mo_gain` with the gap cost called out when `gap_weeks > 0`. When `needs_profile` is true,
show the intake prompt instead of numbers.

- [ ] **Step 4: Write `Raise.jsx`, `Retirement.jsx`, `WhatIf.jsx`**

- `Raise.jsx` — `POST /api/plan/raise`; renders the delta pair plus the allocation plan as a list
  (goal, monthly, months-to-goal) and the effective-rate comparison.
- `Retirement.jsx` — `POST /api/plan/roth` (contribution, start age, retirement age, rate) and
  `GET /api/plan/fire` side by side. Show the IRS limit and its tax year when the contribution is capped.
- `WhatIf.jsx` — sliders for new salary, savings rate and monthly expenses; **debounced 250 ms**, each change
  `POST /api/plan/what-if`. Render the 18-month timeline as a `recharts` `AreaChart` using `var(--chart-1)`,
  with milestone markers, plus the **table fallback** every chart needs (spec §7) behind a "Show table" toggle.
  **Delete no client math — there is none to delete here; all numbers come from the server.**

All four panels: `ErrorState` with a retry on a failed call, `Skeleton` while loading, tabular-mono numbers.

- [ ] **Step 5: Verify in the running app**

```bash
npm run build
npm start
```
- `#/plan` redirects to `#/plan/take-home`; each tab deep-links and survives a reload
- with no profile set, every tab shows the intake prompt rather than a number
- after setting a profile (Task 10, or via `PUT /api/plan/profile`), "Model an offer" at $85,000 shows three
  populated deltas
- the what-if chart has a working table fallback

- [ ] **Step 6: Commit**

```bash
git add src/components/money/sections/Plan.jsx src/components/money/sections/parts/plan src/components/money/MoneyHub.jsx
git commit -F - <<'EOF'
feat(plan): Plan section with take-home, offer, raise, retirement and what-if

Five deep-linkable nested-route panels, all rendering server-computed numbers
— no financial math in a component. "Model an offer" shows the three deltas
the job sprint needs: monthly take-home, runway months, and 18-month net
worth. Every figure carries its evidence grade and, where brackets are
involved, its tax year.
EOF
```

---

### Task 10: profile intake — onboarding gate and Settings panel

**Files:**
- Create: `src/components/money/sections/parts/onboarding/OnboardingModal.jsx`,
  `src/components/money/sections/parts/settings/ProfilePanel.jsx`
- Modify: `src/components/money/MoneyHub.jsx`, `src/components/money/sections/Settings.jsx`

**Interfaces:**
- Consumes: `GET`/`PUT /api/plan/profile` (Task 4); `PROFILE_FIELDS` ordering from Task 3.
- Produces: `settings.profile` populated; `<ProfilePanel />` reusable in Settings.

**Porting note:** NEXUS's `OnboardingModal.jsx` is 405 lines and includes an "Advisor Style" picker. Per spec §5
the picker is **dropped** — MMM's persona is a phrasing layer. Keep the 3-step structure and copy tone; rebuild
the markup on v3 tokens.

- [ ] **Step 1: Write `ProfilePanel.jsx`**

A controlled form over the nine fields, grouped: **About you** (name, age, state, filing status),
**Income** (employment status, gross salary, income end date), **Horizon** (retirement age, risk tolerance).
Save calls `PUT /api/plan/profile` and surfaces the server's `error` string verbatim on a 400 — the server is the
only validator, so client and server can never disagree. Show a success toast via the existing `lib/toast`.

Copy rules for the intake (second person, no jargon, say why each field is asked):
- gross salary → "Your salary before taxes. We use it for take-home, offers and raises — it never leaves this laptop."
- income end date → "If your income has an end date — a contract or a planned exit — tell us and runway will account for it."
- state → "State income tax rate. Leave it at AZ if you're not sure."

- [ ] **Step 2: Write `OnboardingModal.jsx`**

Three steps, each a `ProfilePanel` field group, with Back / Next / Finish and a `1 of 3` progress row.
Shows only when `GET /api/plan/profile` returns `complete: false` **and** the user has entered the app.
It is **skippable** — a "Skip for now" link closes it and writes `sessionStorage['mmm-profile-skipped'] = '1'`
so it does not re-prompt this session. It must never block access to the Money sections.

Accessibility: `role="dialog" aria-modal="true"`, focus moves to the first input on open, Escape triggers Skip,
focus is restored to `document.body` on close.

- [ ] **Step 3: Mount both**

In `MoneyHub.jsx`, beside `<DigestModal>`; gate on `(entered || !isEmpty) && !isLoading` and the skip flag.
In `Settings.jsx`, add a "Profile" panel in the existing section list, above "Appearance".

- [ ] **Step 4: Verify in the running app**

```bash
npm run build
npm start
```
- a fresh profile shows the modal once; Skip dismisses it for the session
- completing all three steps writes `settings.profile` — confirm with
  `node -e "const{db}=require('./server/db/connection');console.log(require('./server/db/repo').getSettings(db()).profile)"`
- Settings → Profile shows the saved values and round-trips an edit
- submitting age 300 shows the server's error text, and nothing is saved

- [ ] **Step 5: Commit**

```bash
git add src/components/money/sections/parts/onboarding src/components/money/sections/parts/settings src/components/money/MoneyHub.jsx src/components/money/sections/Settings.jsx
git commit -F - <<'EOF'
feat(profile): 3-step intake gate and Settings profile panel

Writes settings.profile, the input every planning model needs. Skippable and
never blocking. Dropped the NEXUS "Advisor Style" picker per the plan — MMM's
persona is a phrasing layer, not a stored preference. The server is the only
validator; the client renders its error text verbatim.
EOF
```

---

### Task 11: Debt calculators on server math

**Files:**
- Modify: `src/components/money/sections/parts/debt/CalcPanel.jsx`, `src/components/money/sections/Debt.jsx`

**Interfaces:**
- Consumes: `POST /api/plan/{mortgage,auto-loan,refi,dti}` (Task 4); `ErrorState`, `Skeleton` (Task 6).
- Produces: nothing downstream.

- [ ] **Step 1: Replace the local `pmt()` with server calls**

Delete `pmt()` and the local arithmetic from `CalcPanel.jsx` entirely. On a debounced (300 ms) input change,
POST to the matching endpoint and render the returned fields. Keep the two-column field/result layout and the
`f$` formatter. Four tabs: **Mortgage**, **Auto Loan**, **Refi**, **DTI**.

The panels gain the fields the server math actually takes:
- Mortgage: home price, **down payment %**, rate, term years → monthly P&I, **PMI estimate**, loan amount,
  total interest, total cost, and a collapsible yearly amortization table.
- Auto: vehicle price, down payment, **trade-in**, rate, term months.
- Refi: balance, current rate, new rate, **years remaining**, closing costs → both payments, monthly savings,
  breakeven months/years, **verdict**.
- DTI: monthly gross income, monthly debt payments — both prefilled from the server's real-data defaults
  (send an empty body first, then let the user override) → ratio, readiness band, headroom, notes.

Render `ErrorState` on a failed call. Show `Skeleton` rows while a request is in flight.

- [ ] **Step 2: Make the calculator selection deep-linkable (ruling R7)**

In `Debt.jsx`, replace the `activeCalculator` `useState` with `useSearchParams`:

```jsx
const [params, setParams] = useSearchParams();
const activeCalculator = params.get('calc');
const setCalculator = (c) => setParams(c ? { calc: c } : {}, { replace: true });
```

- [ ] **Step 3: Fix the $0-debt state**

Where the avalanche/snowball race chart renders, when the real debt list is empty show
`"Nothing to pay down — this is an asset."` instead of the chart. Confirm with
`git grep -n "example\|sample" -- src/components/money/sections/Debt.jsx` that no example debts remain; the
race chart must read only `/api/money/debt/payoff` against real accounts.

- [ ] **Step 4: Verify against the three spec fixtures**

```bash
npm run build
npm start
```
At `#/debt?calc=mortgage`, type the fixtures and confirm the app shows the tested numbers:
| Calculator | Input | Expected |
|---|---|---|
| Mortgage | 400000 / 0% down / 7% / 30y | monthly P&I **$2,661.21**, total interest **$558,036** |
| Refi | 300000 / 7% → 5.5% / 25y / $6,000 costs | monthly savings **$278.08**, breakeven **22 months**, STRONG YES |
| DTI | $6,000 income / $1,200 debts | **20.0%**, "good", headroom **$1,380** |

Also confirm the URL updates as tabs change and that reloading `#/debt?calc=refi` lands on Refi.

- [ ] **Step 5: Commit**

```bash
git add src/components/money/sections/Debt.jsx src/components/money/sections/parts/debt/CalcPanel.jsx
git commit -F - <<'EOF'
feat(debt): calculators move onto server math

CalcPanel's local pmt() is gone; Mortgage, Auto, Refi and DTI all call
/api/plan/*, so the same tested arithmetic backs the Debt section and the
Plan section. Mortgage gains PMI and amortization, refi gains a verdict, DTI
prefills from real accounts. Calculator choice is now a ?calc= search param
so a calculator can be linked (ruling R7). Zero debt reads "Nothing to pay
down — this is an asset."
EOF
```

---

### Task 12: subscriptions view

**Files:**
- Create: `src/lib/cadence.js`, `src/components/money/sections/parts/cashflow/Subscriptions.jsx`
- Modify: `src/components/money/sections/CashFlow.jsx`, `server/money/advice.js`
- Test: `tests/cadence-client.test.mjs`

**Interfaces:**
- Consumes: the cadences from Task 5; the existing `recurring` list already loaded by `CashFlow.jsx`.
- Produces: nothing downstream. **No new table** (spec §5).

- [ ] **Step 1: Write `Subscriptions.jsx`**

First create `src/lib/cadence.js` — the **one** client-side copy of the normalizer. The server has its own
(`runway.js`, `calc.js`, `tools/profile.js`); a browser module cannot import CommonJS server code, so exactly
one client copy is the floor. Do not inline a fourth copy in a component.

```javascript
// Client mirror of the server's per-month normalization (server/money/runway.js
// perMonth). Keep the two in step — tests/cadence-client.test.mjs pins the
// values against the same table.
export function perMonth(amount, cadence) {
  const a = Math.abs(Number(amount) || 0);
  if (cadence === 'weekly')    return a * 52 / 12;
  if (cadence === 'biweekly')  return a * 26 / 12;
  if (cadence === 'quarterly') return a / 3;
  if (cadence === 'annual')    return a / 12;
  return a;
}
export const perYear = (amount, cadence) => perMonth(amount, cadence) * 12;
```

Add `tests/cadence-client.test.mjs` asserting all five cadences against `perMonth` and `perYear`
(`perMonth(600, 'quarterly') === 200`, `perYear(600, 'quarterly') === 2400`, weekly `100` → `433.33`,
biweekly `100` → `216.67`, annual `1200` → `100`, monthly `50` → `50`).

`Subscriptions.jsx` is then a filtered view over `recurring` where `kind === 'bill'`, importing `perMonth` /
`perYear` from `../../../../lib/cadence`, with a cycle filter (All / Monthly / Quarterly / Annual) and two
totals in `MetricCard`s: **monthly equivalent** and **annual total**.

Rows sort by monthly equivalent descending and show payee, raw amount, cadence badge, monthly equivalent, and
next date. Empty list → the existing `EmptyState` with "No recurring bills yet."

- [ ] **Step 2: Mount it in Cash Flow**

Add it as a panel in `CashFlow.jsx` beside the existing recurring panel, anchored so
`#/cashflow#subscriptions` scrolls to it.

- [ ] **Step 3: Point the advice finding at it**

In `server/money/advice.js`, the `recurring-heavy` finding's action becomes:

```javascript
action: { label: 'Review subscriptions', route: '/cashflow', params: { hash: 'subscriptions' } },
```

Confirm `tests/advice.test.mjs` still passes; update the finding's asserted `action` if it is pinned there.

- [ ] **Step 4: Verify**

```bash
npx vitest run tests/advice.test.mjs tests/cadence-client.test.mjs
npm run build
npm start
```
At `#/cashflow`: add a quarterly bill of $600 and confirm it shows as **$200/mo equivalent** and **$2,400/yr**,
and that the cycle filter isolates it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cadence.js tests/cadence-client.test.mjs src/components/money/sections/parts/cashflow/Subscriptions.jsx src/components/money/sections/CashFlow.jsx server/money/advice.js
git commit -F - <<'EOF'
feat(cashflow): subscriptions view with cycle normalization

Filters recurring bills by cycle and shows monthly-equivalent and annual
totals using the same normalization the server uses. No new table. The
recurring-heavy advice finding now links straight to it.
EOF
```

---

### Task 13: phase close — verify, package, record

**Files:**
- Create: `docs/superpowers/plans/2026-09-17-phase1-ledger.md`
- Modify: `C:\Users\aaron\.claude\projects\C--Users-aaron\memory\project_mmm_v3_plan.md`,
  `C:\Users\aaron\.claude\projects\C--Users-aaron\memory\MEMORY.md`

**Interfaces:** none.

- [ ] **Step 1: Full test run — the count must be higher than 108**

```bash
npm test 2>&1 | tail -20
```
Expected: all files pass; **≥133 tests** (108 baseline + ≥25 new, per the spec's Phase 1 verify line).
Paste the real count into the report. If it is below 133, the phase is not done.

- [ ] **Step 2: Build**

```bash
npm run build
```
Expected: exits 0.

- [ ] **Step 3: Contrast gate**

```bash
npm run check:contrast
```
Expected: passes both themes.

- [ ] **Step 4: Package and smoke — alone, with `MMM.exe` closed**

Confirm nothing is holding the output directory first:

```bash
tasklist | grep -i MMM.exe || echo "no MMM.exe running"
```

Then, and **only** after `npm run build` has fully exited:

```bash
npm run build:portable
```
Expected: 6/6 steps, smoke passes. If it dies with `EPERM ... syscall: 'rm'`, a build is still running or
`MMM.exe` is open — wait, close it, and re-run. Never run the two builds concurrently.

- [ ] **Step 5: Exercise the features in the packaged app**

Launch `build/MMM-portable/MMM.exe` (or ask Aaron to, via `MMMoney.lnk`) and confirm, against the real
`%APPDATA%\mmm` data:
1. the sidebar shows four groups and they collapse and persist
2. `Ctrl+K` opens, `cas` finds Cash Flow, Enter navigates
3. `#/plan/offer` at $85,000 shows three populated deltas
4. `#/debt?calc=mortgage` reproduces $2,661.21 on the fixture
5. the profile modal appears once and writes `settings.profile`
6. a quarterly bill shows the correct monthly equivalent in Subscriptions
7. existing dollar amounts on Overview are unchanged from before the phase

- [ ] **Step 6: Merge to master**

```bash
git checkout master
git merge --no-ff v3/phase-1 -F - <<'EOF'
merge: Phase 1 planning primitives + nav

Grouped nav with nested routes and a Ctrl+K palette, NEXUS loan and planning
math ported onto the server with tests, the Plan section including "Model an
offer", profile intake, Debt calculators on server math, and a subscriptions
view with quarterly/annual cadences.
EOF
git log --oneline -1
```

- [ ] **Step 7: Write the ledger and update memory**

Create `docs/superpowers/plans/2026-09-17-phase1-ledger.md` recording: what landed per task, the merge commit
hash, the test count before and after, rulings R1–R8 with their reasoning, gotchas discovered, and what Phase 2
does first.

Append a "Phase 1 shipped" block to `project_mmm_v3_plan.md` in the same style as the Phase 0 and Phase D blocks,
and refresh the one-line index in `MEMORY.md`. A fresh session must be able to resume from those two files alone.

- [ ] **Step 8: Rebuild the shortcut target if needed**

The portable build already writes to `build/MMM-portable/MMM.exe`, which `MMMoney.lnk` points at — no shortcut
change is needed this phase. If the exe path did change, write a `.sh` script and ask Aaron to run it with
`! bash /c/...`; never delete or rewrite a shortcut from the agent shell.

---

## Self-Review

**1. Spec coverage** — every Phase 1 bullet in spec §5 maps to a task:

| Spec bullet | Task |
|---|---|
| `SECTIONS` gains `group`; grouped collapsible sidebar persisted to `settings.nav` | 7 |
| Nested routes for sub-tabs | 7 (shell), 9 (`/plan/:tab`) |
| Port `CommandPalette.jsx` + `KeyboardShortcuts.jsx` | 8 |
| Placeholder sections show a one-line status card | 7 |
| Primitives: Tooltip, InfoIcon, AnimatedNumber, MetricCard, ErrorState, Skeleton | 6 |
| `server/tools/loans.js` (mortgage/auto/refi/DTI) | 1 |
| `server/tools/planning.js` (whole) | 2 |
| `server/tools/profile.js` + `profileFromMmm()` | 3 |
| `tests/loans.test.mjs` + `tests/planning.test.mjs`, every export | 1, 2 |
| Fixtures: $400k/7%/30y, PMI threshold, refi breakeven, DTI bands, take-home brackets, FIRE years | 1, 2 |
| Plan section: take-home, "Model an offer", raise, Roth, FIRE, what-if, milestones | 4 (`/offer`, `/what-if`), 9 |
| `WhatIfSliders` calls the server; client math deleted | 9 |
| `settings.profile` nine fields | 3 (validator), 4 (routes), 10 (UI) |
| `OnboardingModal` as a 3-step gate, Advisor Style dropped | 10 |
| Settings → Profile | 10 |
| Debt `CalcPanel` gains Mortgage/Refi/DTI on server math | 11 |
| Race chart reads real debts; $0 message | 11 |
| `recurring.cadence` gains quarterly/annual | 5 |
| Cash Flow Subscriptions filter with normalization and totals | 12 |
| `recurring-heavy` reads it | 12 |
| Verify: ≥25 new tests, 3 debt fixtures, three deltas, Ctrl+K, onboarding writes profile | 13 |

Gaps closed while reviewing: the spec lists `generateMilestones` under the Plan section but it lives in NEXUS's
route file, not its tools module — Task 2 ports it into `planning.js` and Task 4's `/what-if` returns it.
The spec's `SubscriptionsTracker.jsx` is not named in Phase 1's bullet list, so Task 12 builds a fresh panel
rather than porting 195 lines of NEXUS markup.

**2. Placeholder scan** — no "TBD", no "add error handling", no "similar to Task N". Every test body is real code
with values computed from the source, not guessed. Task 3 and Task 9–12 describe behaviour in prose plus anchor
code rather than full file listings; the interfaces they consume and produce are named exactly, which is what an
implementer with no context needs.

**3. Type consistency** — verified across tasks: `snapshot` has the same shape in Tasks 2, 3 and 4;
`profileFromMmm(data, settings)` takes two arguments everywhere; `generateMilestones(timeline, snapshot)` takes
two (NEXUS passed three); `calcMonthlyPayment` takes a rate **fraction** while every public `annual_rate` is a
**percent**, stated in Task 1's interface block and in the module header; `PROFILE_FIELDS` is nine entries in
Task 3's test, Task 3's implementation and Task 10's three-step split (4 + 3 + 2).
