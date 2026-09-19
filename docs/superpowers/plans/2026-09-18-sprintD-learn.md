# Sprint D — Learn M0–M2

**Spec:** `~/.claude/plans/lets-make-a-plan-floating-pine.md` §5a (sprint table), the Phase 10 section, §4.2,
§4.3, §3, §7, §9. Branch `v3/sprint-d` off master `a792e10` (Sprint C merged, **415 tests / 28 files**).

**Goal:** a real teaching loop over the user's own numbers — content pipeline, spaced-repetition review queue,
lesson runner, and apply-actions that write real changes through the existing validators.

**Scope is M0–M2 only.** The full curriculum is cut. **The tutor is cut** — it was the AI surface, and all
AI/LLM work is cut from this build. Do not build a hint ladder, an explain-with-my-numbers responder, or a
rubric grader.

## The one new dependency

`ts-fsrs` (MIT) is **named in the spec's locked decisions**, so adding it is plan-mandated, not scope creep.
It is required by `server/learn/fsrs.js`, which makes it a **server** dependency:

**It must be added to `SERVER_DEPS` in `scripts/build-portable.mjs` in the same commit that adds it to
`package.json`.** Miss that and the packaged exe crashes at runtime with a green build and a green suite. The
step-4 require scan now genuinely asserts modules resolve *inside* the payload, so a miss fails the build
loudly — but do not rely on the guard to remember for you. No other new dependency is permitted.

## Global constraints

- npm + Node CommonJS server / ESM client. React 18 **JSX not TSX**. No TypeScript, no Bun.
- Money is integer cents at rest. **Dates compare as local `YYYY-MM-DD` strings — never `toISOString()` for a
  day key, never `new Date('YYYY-MM-DD')`.** That bug has been found three times in this project.
- Every new table is declared in `schema.sql` and round-trips through `repo.readAll`/`writeAll`.
  Never a destructive migration.
- **Every figure a lesson shows carries an evidence grade** and comes from a deterministic provider — never a
  number typed into prose. A lesson that states a wrong figure about the user's own money is worse than no
  lesson.
- No hardcoded hex — semantic `var(--m-*)` / `var(--chart-N)`. No `cursor: pointer` on cards. Numbers
  `tabular-nums`. Colour paired with a sign or icon. Charts keep table fallbacks.
- `git commit -F -` with a heredoc. Never `git add -A`. Never stage `.omc/`, `build/`, `src/dist/`,
  `.superpowers/`, `.playwright-cli/`, or anything under `server/store/money/`.
- **Never a bare `node -e` that requires `server/money/store.js` or `server/db/connection.js`** —
  `connection.js:14` falls back to the real dev database when `MMM_DATA_DIR` is unset.
- **Never `npm run build:portable`**, never `npm start`, never two builds at once.

---

## Track 1 — the engine

**Files:** `server/learn/{content,variables,template,fsrs,progress,apply,routes}.js`, `schema.sql`, `repo.js`,
`server/index.js`, `scripts/build-learn-index.mjs`, `tests/learn-variables.test.mjs`,
`tests/learn-fsrs.test.mjs`, `tests/learn-routes.test.mjs`.

**Tables** (§4.3): `learn_progress`, `learn_step_progress`, `learn_cards` (1:1 with ts-fsrs's `Card`),
`learn_reviews`, `learn_applied_actions`, `learn_settings`, `learn_streak`, `learn_events`
(**idempotent on `(reason, source_type, source_id)`**).

- **`content.js`** — loads `content/learn/**/*.md` plus `sources.yaml`; **idempotent sync by id + content
  hash**, so re-running never duplicates. `content/` must be added to the packager payload.
- **`variables.js` — TDD mandatory.** Deterministic providers, each returning `{ value, formatted, grade }`:
  `runway_days`, `runway_date`, `liquid`, `savings_rate`, `monthly_surplus`, `ef_months_covered`, `ef_target`,
  `budget_variance_top3`, `recurring_monthly`, `largest_outflow`, `debt_ledger`. Each needs a **declared
  fallback** for a user with no data, and a banner saying the lesson is running on sample figures. These are
  the numbers lessons quote back at the user — they must be right.
- **`template.js`** — whitelist Mustache over the variable set. **No code execution, ever.** A lesson is data.
- **`fsrs.js`** — wraps `ts-fsrs`. Retention 0.90 core / 0.85 trivia; session cap 20 cards or 7 minutes; a
  positive end screen. New cards via `createEmptyCard()`.
- **`apply.js`** — the apply-action registry: `create_goal`, `set_category_budget`, `add_recurring`,
  `enable_rollover`, `create_rule`, `export_backup`. **Every write goes through the existing validators and
  store functions** — never a direct SQL write from a lesson. Record in `learn_applied_actions` with undo via
  `activity_log`. Cut from the spec's list: `set_target_allocation`, `open_paper_trade`, `log_prediction`,
  `schedule_review` (they need surfaces this build does not have).

## Track 2 — content (M0–M2, ~15 lessons)

**Files:** `content/learn/**/*.md`, `content/learn/sources.yaml`.

Front matter per lesson: `id, module, title, est_minutes, source_id, license_note, personalizes[],
requires_data, apply_action, gate`. Body blocks: `::worked`, `::faded`, `::check`, `::apply`, `::reflect`.
**Voice is second person, using `{{variables}}`** — the user's own numbers, never invented ones.

- **M0 Orientation** — what this app is, what a ledger is, how to read the Overview.
- **M1 Runway & Survival** — runway, burn, liquid vs illiquid, the emergency fund.
- **M2 Cash Flow You Can Steer** — fixed vs variable, subscriptions, the controllable outflow.

**Licensing is binding, not advisory.** Sources: CFPB and FDIC (US public domain — cite, no logos),
OpenStax **1st edition only** (CC BY — **2e is forbidden**), Wikipedia (CC BY-SA, must be marked). Bogleheads
is **unverified** — write original prose and link, never copy. Every lesson names its `source_id`, and
`sources.yaml` records `id, title, url, license, attribution, allows_verbatim`. An attribution footer renders
automatically.

## Track 3 — UI (Wave 2)

**Files:** `src/components/money/sections/Learn.jsx` (currently a 42-line glossary stub — extend, do not
discard the glossary), `parts/learn/*`, `widgets/` (Today's lesson), `MoneyHub.jsx` if routing needs it.

Nested routes: `/learn`, `/learn/lesson/:id`, `/learn/review`, `/learn/glossary`.
Lesson runner: one step per screen, **Esc saves position**, closed-book checks, wrong/Hard routes the card
into `learn_cards`. Soft mastery gates (≥80% plus at least one apply-action) with a "test me out" escape.
Apply-actions render a **pre-filled, editable confirm** before any write — never a silent one.

## Verification

`npm test` up from **415 / 28**, `npm run build` exit 0, `npm run check:contrast` green.
Sprint gate (controller): full suite, packaged smoke **with `content/` in the payload and `ts-fsrs` resolving
inside it**, an end-to-end lesson run, one review, merge.
