# Decision-Support Architecture: Data to Guidance

## Abstract

MMM turns ledger data into actionable financial guidance through a strict separation of concerns: a deterministic rule engine (`advice.js`, `runway.js`) computes all numerical findings from user data; an optional local LLM coach phrases those findings in natural language without ever inventing a number; and a spaced-repetition lesson engine personalizes educational content with the user's own figures. Every displayed number is traceable to code; every LLM output is grounded in facts, never computation.

---

## Design Principle

**Numbers come from deterministic rules; words may come from a model.**

The advice engine is pure: no I/O, no network calls, no LLM. It takes metrics already computed from the ledger and returns ranked findings with severity, impact scores, and deep-link actions. The coach and learn engine are layers on top, consuming those findings to phrase or teach — never to calculate.

---

## Components

### 1. Deterministic Advice Engine (`server/money/advice.js`)

**Purpose:** Turn user metrics and account data into ranked, actionable findings.

**Entry points:**
- `computeAdvice(input)` — main rule engine (advice.js:44)
- `computeDigest(input)` — weekly summary digest (advice.js:312)

**Input shape** (advice.js:30–42): Metrics (savings_rate, runway_months, monthly_income, monthly_expenses); goal insights (emergency fund adequacy, months covered); budget status by category; cashflow projection (lowestBalance); debts with APR; goals with target dates and contribution pace; recurring bills; investments with allocation; spend figures for month-over-month comparison.

**Finding shape** (advice.js:9–13):
```
{
  id: 'emergency-fund-low' | 'runway-low' | …,
  severity: 'critical' | 'warn' | 'info' | 'good',
  category: 'emergency' | 'cashflow' | 'savings' | …,
  title: string,
  detail: string (user-facing explanation),
  impact: 0–100 (severity floor + scaled factor, advice.js:17, 27–28),
  action: { label, route, params } | null  (deep-link to fixing screen)
}
```

**Rules** (each with severity + impact scoring):
1. **Emergency fund** (advice.js:69–103): Flags low adequacy as critical; grades as low/ok/good.
2. **Cash runway** (advice.js:105–118): Warns if liquid savings cover < 3 months of spend; critical if < 1 month.
3. **Savings rate** (advice.js:120–144): Critical if monthly surplus is negative; warn if positive but < 10% of income.
4. **Budget overspend** (advice.js:146–164): Flags category overspend (warn) or near-limit (info); includes category name and deep-link.
5. **Cashflow projection** (advice.js:166–190): Critical if projected balance goes negative; warn if dips below $500.
6. **Debt avalanche** (advice.js:192–209): Targets highest-APR debt; warn severity scaled by monthly interest cost.
7. **Goals off-pace** (advice.js:211–240): Info severity when required monthly contribution exceeds current contribution by >5%.
8. **Recurring bill load** (advice.js:242–265): Info when recurring bills exceed 40% of income; lists largest payee.
9. **Investment concentration** (advice.js:267–282): Info when top holding > 60% of portfolio.
10. **Spending spike** (advice.js:284–296): Info when month-over-month spend up >25%; scales with magnitude.

**Digest** (advice.js:312–372): Weekly headline + stats (saved/spent, net worth delta, emergency fund status, top mover). Surfaces top 2 non-good findings.

**Severity scoring** (advice.js:17, 27–28):
- Floor: critical=80, warn=55, info=25, good=5
- Within-band scaling: floor + clamp(factor, 0, 1) × 18, so range per severity is [floor, floor+18]
- Results sorted by impact descending (advice.js:298)

**Tests:** advice.test.mjs (10+ scenarios: emergency fund, spending above income, budget overspend, cashflow dip, debt targeting, goals behind, recurring bills, concentration, spending spike)

---

### 2. Runway (`server/money/runway.js`)

**Purpose:** Compute how long liquid cash lasts at current burn rate, with evidence grade.

**Entry point:** `computeRunway({ accounts, transactions, recurring, categories, today })` (runway.js:36)

**Core definition** (runway.js:1–10):
- **Spend** = trailing 90-day outflows from liquid accounts (checking, savings, cash) only
- **Excludes:** Transfer-group categories (moving checking → savings is not burn); income rows; credit-card purchases (counted only when the clearing payment hits liquid)
- **Burn source** = actual transaction total / observed days × 30 months, OR recurring bills if actual is thin

**Grade assignment** (runway.js:67–73):
- **Grade A:** Actual burn computed from ≥ 90 days of history (full window)
- **Grade B:** Actual burn from 14–89 days, OR recurring bills fallback
- **Grade C:** Actual burn from < 14 days, OR unknown when both actual and recurring are missing

**Output shape** (runway.js:88):
```
{
  liquid: total of liquid accounts,
  monthlyBurn: rounded to 2 decimals,
  burnSource: 'actual' | 'recurring' | 'none',
  months: liquid / monthlyBurn (rounded 2 decimals),
  daysLeft: floor(liquid / (monthlyBurn / 30)),
  dateMoneyRunsOut: YYYY-MM-DD,
  band: 'safe' (≥6mo) | 'tight' (3–6mo) | 'critical' (<3mo) | 'unknown',
  largestOutflow: { payee, amount } | null,
  grade: 'A' | 'B' | 'C',
  historyDays: observed span from oldest to today (inclusive)
}
```

**Why naive formula overstates runway (runway.js:2–6):** A per-transaction approach `liquid / monthlyAverage` ignores the fact that not all outflows count. Transfer-category rows (like checking → savings, which the API user sees) must be excluded or else a $2500 internal move inflates burn by 8×. The rule-engine default is transfer-category exclusion (runway.js:29–34).

**Tests:** runway.test.mjs (actual spend exceeds recurring so fallback unused; thin history falls back to recurring with grade B; full 90-day window earns grade A; transfer categories excluded; spend extrapolation to daysLeft matches projection math)

---

### 3. Evidence Grades and Grade Component (`src/components/money/shared/Grade.jsx`)

**Display** (Grade.jsx:1–10):
- Grade A (green): "Computed from your real transactions"
- Grade B (accent color): "Estimated from recurring bills or thin history"
- Grade C (muted): "Rough guess — add data to improve"

**Usage:** Runway grade is computed deterministically (runw.js:67–73) and displayed as a Grade badge whenever runway is surfaced (e.g., on the Cash Runway card, /reports). Grade field is present in all runway endpoints and route responses.

**Invariant:** A finding or metric without sufficient data (e.g., no transactions, no recurring bills) returns grade C and a documented fallback value; it never computes a zero or null that could be misread as real (variables.js:16–18).

---

### 4. Grounded LLM Coach (`server/money/ollama.js`, `coach-persona.js`, `/api/money/coach`)

**Transport** (ollama.js:8–9): Daemon at `OLLAMA_HOST` (env var; default `http://127.0.0.1:11434`); default model `qwen2.5:1.5b-instruct`.

**Lifecycle** (routes.js:813–856):
1. Client calls `GET /coach/status?model=<optional>` to probe Ollama availability (ollama.js:33–42).
2. Client sends `POST /coach` with a `messages` array (conversation history, 8 most recent kept).
3. Server builds a **facts block** from current metrics, accounts, debts, findings (routes.js:832–850).
4. Server invokes `coachSystemPrompt({ facts, findings })` to build the system prompt (coach-persona.js:14).
5. Ollama chat completion fills in words; response returned as-is or graceful failure if Ollama is absent (routes.js:821–856).

**System prompt contract** (coach-persona.js:28–41):
- Facts block lists exact user figures: net worth, income, expenses, savings rate, runway, emergency fund, account list, debt list.
- Findings block lists all ranked advice findings from `computeAdvice()` (coach-persona.js:24–26).
- Rules: "Only state dollar amounts, percentages, and dates that appear above. NEVER invent or estimate a number." (coach-persona.js:37).
- LLM role: "blunt, encouraging, practical" coach, speaking to one person about their money; give 1–2 concrete next actions, not a lecture.
- Disclaimer: "not a licensed financial advisor; for big irreversible moves, confirm with a professional."

**Timeouts and degradation** (ollama.js:11–62):
- `listModels()` times out at 1.5s; returns [] on failure (ollama.js:18–30).
- `status()` checks availability; returns `{ available: false, … }` if no models found (ollama.js:33–42).
- `chat()` times out at 40s by default (ollama.js:45–60).
- All errors are caught; coach route returns `{ available: false }` (routes.js:821–856) and the UI falls back to rules-only findings.

**Cloud-LLM path:** The feature key `cloudLlm` is declared in `server/online/features.js` but is **NOT** wired up in any route or handler; it appears only as a configuration option in `OnlinePanel.jsx`. No cloud LLM fallback is implemented (features.js:9).

---

### 5. Learn (`server/learn/content.js`, `variables.js`, `template.js`, `apply.js`, `fsrs.js`)

**Lesson structure** (content.js:10–15, 29–60): Lessons are Markdown files in `content/learn/{module}/{id}.md` with YAML front matter (id, module, title, est_minutes, source_id, license_note, personalizes[], requires_data, apply_action, gate, order) followed by five named body blocks: read → worked → faded → check → apply → reflect.

**Content loader** (content.js:103–151): Parses lessons into step arrays (index, type, body/check-fields). No new dependencies: hand-rolled parser for YAML and block structure (content.js:31–60). Deterministic sort: explicit `order:` field, then module, then id (content.js:130–136). Sources list loaded from `content/learn/sources.yaml` for attribution (content.js:158–182).

**Variable providers** (variables.js:90–99+): Compute `{ value, formatted, grade, sample }` for each personalizable variable. Grades assigned per data quality:
- Grade A: 60+ days of actual data
- Grade B: 14–59 days or no real data but recurring bills exist
- Grade C: < 14 days or nothing
- `sample: true` when no real data; falls back to declared SAMPLE_DATA (variables.js:49–60)

**All variables are pure** (variables.js:1–25): Uses same runway/calc functions as the money engine; no DB calls. Mirrors `getMetrics()` trailing-60-day formula via comment to stay in sync (variables.js:23–25).

**Templating** (template.js:1–100): Mustache subset — no lambdas, no inverted sections, no prototypal access. Only four fields allowed: value, formatted, grade, sample. Section syntax `{{#variable}}…{{/variable}}` repeats over array items. All interpolations are HTML-escaped (template.js:44–51). Validation script `scripts/build-learn-index.mjs` (build-learn-index.mjs:28–80) checks all `{{variable}}` tags resolve against the sample variable set before shipping.

**Apply actions** (apply.js:24–80+): Registry of six executable actions (create_goal, set_category_budget, add_recurring, enable_rollover, create_rule, export_backup). Each action validates input via existing store validators (apply.js:37–39), writes via store functions, logs before/after snapshots (apply.js:9) for undo. Dependency-injected context (apply.js:16–21) prevents direct DB coupling.

**FSRS scheduling** (fsrs.js:1–50): Thin wrapper around ts-fsrs. Retention targets: core lessons 90%, trivia 85%. Session cap: 20 cards or 7 minutes. Dates stored as full ISO instants (fsrs.js:9–14), not calendar day-keys (differing from runway's day-key rule). Card state tracked: due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps.

**Tests:** learn-content.test.mjs (parsing, front matter, block structure); learn-variables.test.mjs (grade assignment, sample fallback, liquid calculation); learn-template.test.mjs (scalar and section rendering, HTML escape, error reporting); learn-apply.test.mjs (action registry, validation, undo); learn-fsrs.test.mjs (session sizing, retention logic, scheduling intervals); learn-routes.test.mjs (endpoint behavior, personalization, sample banner); learn-progress.test.mjs (review log, card state transitions).

---

### 6. Planning Math (`server/tools/planning.js`, `loans.js`)

**Tax calculations** (planning.js:1–65): TAX_YEAR = 2024 (marked in header with ruling R3). Federal brackets, FICA 7.65%, standard deduction $14,600. State rates hardcoded (planning.js:21–24). `calcTakeHome(grossAnnual, state)` returns { gross_annual, federal_tax, state_tax, fica, annual_take_home, monthly_take_home, effective_rate, tax_year: 2024, grade: 'B' } (planning.js:45–65). Grade B indicates the table is stale; every take-home result carries it so staleness is visible at point of use (planning.js:62–63).

**Mortgage amortization** (loans.js:27–68): `calcMortgage({ purchase_price, down_payment_pct, annual_rate, term_years })` computes level monthly payment, PMI (0.7% of principal if down < 20%), yearly amortization breakdown. Output: monthly_payment, monthly_pi (principal+interest only), loan_amount, total_interest, amortization array (year, principal_paid, interest_paid, balance).

**Auto loan** (loans.js:79+): `calcAutoLoan({ vehicle_price, down_payment, trade_in, annual_rate, term_months })` — similar, fixed-term amortization.

**Monthly payment formula** (loans.js:10–15): Standard amortization: `principal × (r × (1+r)^n) / ((1+r)^n - 1)` where r = annual_rate/12, n = term_months.

**Tests:** planning.test.mjs (tax brackets at multiple incomes, state rates); loans.test.mjs (monthly payment formula, amortization balance-to-zero, PMI thresholds, year-by-year principal/interest split).

---

## Data Flow

```mermaid
graph LR
    A["Ledger<br/>(accounts, txns)"]
    B["Rule Engine<br/>(advice.js)"]
    C["Runway Calc<br/>(runway.js)"]
    D["Findings<br/>(id, severity, title,<br/>detail, action)"]
    E["Coach System Prompt<br/>(coach-persona.js)"]
    F["Local Ollama<br/>(optional)"]
    G["Coach Reply<br/>(natural language)"]
    H["Learn Variables<br/>(variables.js)"]
    I["Template Render<br/>(template.js)"]
    J["Lesson (personalized)"]
    K["Grade<br/>(A/B/C badge)"]

    A -->|getMetrics, detectRecurring| B
    A -->|transactions, categories| C
    C -->|monthly burn, grade| B
    B -->|ranked findings| D
    D -->|facts + findings| E
    E -->|system prompt| F
    F -->|reply| G
    D -->|shown with grade| K
    
    A -->|query for personalization| H
    H -->|{ value, formatted,<br/>grade, sample }| I
    I -->|variable substitution| J
    A -->|sources.yaml| J
    H -->|grade A/B/C| K
    style B fill:#e8f4f8
    style C fill:#e8f4f8
    style E fill:#f0e8f8
    style F fill:#f8f0e8
    style H fill:#e8f8f4
    style K fill:#f0f0f0
```

---

## Invariants

1. **Every Finding is computed, never guessed** (advice.js:44–299). Rules only emit when data supports them; when not, no Finding is added. Test: advice.test.mjs returns [] for empty input.

2. **Runway burn excludes transfers** (runway.js:29–34, 48–53). Spend counted only from liquid accounts with amount < 0 and not in transfer-group category. Test: runway.test.mjs excludes $2500 checking→savings transfer from burn.

3. **Runway grade is deterministic from history span** (runway.js:67–73). A = ≥90 days, B = 14–89 days or recurring fallback, C = <14 days or unknown. Test: runway.test.mjs verifies grade transitions.

4. **Coach never computes** (coach-persona.js:37). LLM receives exact figures in system prompt and is forbidden to invent or estimate. Non-listed numbers are reported as missing ("I don't have that data in the app yet").

5. **Coach gracefully degrades when Ollama is absent** (ollama.js:46–60, routes.js:830). No timeout blocks the app; failed connection returns `{ available: false }` and UI falls back to rules-only findings.

6. **Learn variables use declared sample fallbacks** (variables.js:16–18, 49–60). A provider with insufficient real data returns SAMPLE_DATA value + `sample: true` marker rather than zero/null, so no lesson teaches a wrong number as real.

7. **Lesson templates validate at build time** (build-learn-index.mjs:28–80). Every `{{variable}}` tag must resolve against sample variables before the app ships; malformed tags are caught, not silently ignored.

8. **Apply actions log before/after snapshots** (apply.js:9). Every write to goals, budgets, recurring, rules creates a learn_applied_actions + activity_log entry with JSON snapshots, enabling undo.

9. **Planning math always marks stale tax year** (planning.js:62–63). Every take-home output includes `tax_year: 2024, grade: 'B'` so callers know the bracket is outdated if not refreshed.

10. **No evidence-grade fabrication** (Grade.jsx:1–10, variables.js:6–14). Grade is always A/B/C with documented meaning; it is never omitted or defaulted to a higher grade when evidence is weak.

---

## Verification

| Component | Test File | Coverage |
|-----------|-----------|----------|
| Advice | advice.test.mjs | 10+ rules: emergency fund, savings-negative, budget overspend, cashflow dip, debt targeting, goals behind, recurring bills, concentration, spending spike, digest |
| Runway | runway.test.mjs | actual spend, recurring fallback, grade A/B/C, history span, transfer exclusion, daysLeft projection |
| Grade | (inline UI) | badge color + tooltip per grade; no missing grades |
| Coach | (integration) | status endpoint, message history, facts/findings assembly, Ollama timeout, graceful fail |
| Learn content | learn-content.test.mjs | front-matter parsing, block structure, duplicate IDs |
| Learn variables | learn-variables.test.mjs | grade assignment, sample fallback, liquid/runway calc, income/expense mirrors |
| Learn template | learn-template.test.mjs | scalar/section rendering, HTML escape, missing-tag reporting |
| Learn apply | learn-apply.test.mjs | action validation, store writes, before/after snapshots, undo |
| Learn FSRS | learn-fsrs.test.mjs | session sizing, retention, scheduling intervals, card state transitions |
| Learn routes | learn-routes.test.mjs | endpoint behavior, personalization, sample banner, progress tracking |
| Planning | planning.test.mjs | tax brackets, state rates, effective rate |
| Loans | loans.test.mjs | monthly payment, amortization, PMI, balance-to-zero |

---

## Known Limitations

1. **Tax year is static (2024).** Planning.js hardcodes federal brackets and FICA; no automatic refresh. Stale tables are marked in output (tax_year + grade B), but a user must manually request an update. Ruling R3 in planning.js:1–4 documents the requirement.

2. **Cloud-LLM feature is declared but not wired.** The `cloudLlm` key exists in `server/online/features.js:9` as a configuration option but has no corresponding handler or fallback path. Only local Ollama is supported.

3. **Grade C (thin data) still surfaced.** Variables with <14 days of history return grade C + sample fallback, allowing lessons to run with declared fallback figures; a "running on sample" banner is shown (variables.js:14), but some users may not notice.

4. **Learn templates do not support nested sections** (template.js:20–22). `{{#items}}{{#subitems}}...{{/subitems}}{{/items}}` will not work; only single-level iteration is implemented. None of the shipped lesson content uses nesting, so this is not a defect, only a stated boundary.

5. **Advice rules do not run forecasts.** Rules compute against current/recent data only; multi-month planning (e.g., "if you keep saving at this rate, when will your emergency fund be full?") is not part of the rule engine. Lessons and the coach may phrase multi-month scenarios, but the numbers are derived from user estimates (e.g., goal target date + contribution), not a simulation.

6. **No dependency management for lesson apply-actions.** A lesson may declare `apply_action: create_goal` but the goal creation itself (via store.createGoal) has no guarantee it will succeed at runtime (e.g., if validation fails). The apply handler catches and reports errors, but the lesson content cannot conditionally skip an apply step based on prior success.

