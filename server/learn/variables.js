'use strict';

// Deterministic "quote the user's own numbers back at them" providers for
// the Learn engine (Sprint D, Track 1). Every provider returns
// { value, formatted, grade, sample }:
//   - value     the raw number/string/array a lesson (or the UI) can use
//   - formatted a ready-to-render string for {{variable.formatted}}
//   - grade     'A' | 'B' | 'C' evidence grade — same semantics as
//               server/money/runway.js: more/direct data earns a better grade
//   - sample    true when there wasn't enough real data to compute this
//               honestly, so `value`/`formatted` are the declared SAMPLE_DATA
//               fallback. The UI/template layer must show a "running on
//               sample figures" banner whenever any personalized variable in
//               a lesson has sample: true.
//
// A wrong figure about the user's own money is worse than no lesson, so a
// provider that cannot be computed honestly from real data returns its
// documented fallback rather than a zero/null that could be misread as real.
//
// Money math is delegated to already-tested pure functions
// (server/money/runway.js, server/money/calc.js) wherever the calculation
// is nontrivial, rather than re-derived here — the one exception is the
// trailing-60-day income/expense figure, which intentionally mirrors
// server/money/store.js's getMetrics() formula (kept in sync via comment,
// since store.js is DB-coupled and can't be called from this pure module).

const calc = require('../money/calc');
const { computeRunway } = require('../money/runway');
const { isLiability } = require('../money/account-types');

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysLocal(d, days) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}
function formatYmd(ymdStr) {
  if (!ymdStr) return null;
  const [y, mo, day] = String(ymdStr).slice(0, 10).split('-').map(Number);
  return `${MONTH_NAMES[mo - 1]} ${day}, ${y}`;
}
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const pct1 = (n) => `${Math.round(n * 1000) / 10}%`;

// Declared fallbacks for a user with no data yet (spec §Track 1: "Each needs
// a declared fallback for a user with no data, plus a banner ... running on
// sample figures").
const SAMPLE_DATA = {
  runway_days: 90,
  liquid: 8000,
  savings_rate: 0.15,
  monthly_surplus: 400,
  ef_months_covered: 2,
  ef_target: 12000,
  recurring_monthly: 1200,
  largest_outflow: { payee: 'Rent', amount: 1500 },
  debt_ledger: [{ name: 'Sample Credit Card', balance: 3200, type: 'credit' }],
  budget_variance_top3: [{ category_id: 'fod', name: 'Food', limit: 500, spent: 640, variance: 140, formatted: '$140 over' }],
};

function historyDaysWithin(transactions, cutoffStr, todayStr) {
  const inWindow = transactions.filter((t) => {
    const ds = String(t.date).slice(0, 10);
    return ds >= cutoffStr && ds <= todayStr;
  });
  if (!inWindow.length) return 0;
  const oldest = inWindow.reduce((m, t) => {
    const ds = String(t.date).slice(0, 10);
    return ds < m ? ds : m;
  }, todayStr);
  const [oy, omo, od] = oldest.split('-').map(Number);
  const [ty, tmo, td] = todayStr.split('-').map(Number);
  const oldestDate = new Date(oy, omo - 1, od);
  const todayDate = new Date(ty, tmo - 1, td);
  return Math.round((todayDate - oldestDate) / 86400000) + 1;
}
function gradeFromHistoryDays(days, full = 60) {
  return days >= full ? 'A' : days >= 14 ? 'B' : 'C';
}
function perMonth(amount, cadence) {
  const a = Math.abs(parseFloat(amount) || 0);
  if (cadence === 'weekly') return a * 52 / 12;
  if (cadence === 'biweekly') return a * 26 / 12;
  if (cadence === 'quarterly') return a / 3;
  if (cadence === 'annual') return a / 12;
  return a; // monthly
}

function computeVariables({
  today = new Date(),
  accounts = [],
  transactions = [],
  categories = [],
  recurring = [],
  budgets = [],
} = {}) {
  const hasAccounts = accounts.length > 0;
  const hasTransactions = transactions.length > 0;
  const hasRecurring = recurring.length > 0;
  const hasBudgets = budgets.length > 0;

  const todayStr = ymdLocal(today);
  const cutoff60 = ymdLocal(addDaysLocal(today, -60));

  const runway = computeRunway({ accounts, transactions, recurring, categories, today });
  const goalInsights = calc.computeGoalInsights(accounts, transactions, recurring);

  // Mirrors server/money/store.js:getMetrics()'s monthly_income/expenses
  // formula exactly (trailing 60 days of transactions, /2 to approximate a
  // monthly figure). Keep these two formulas in sync if either changes.
  const recentTxns = transactions.filter((t) => String(t.date).slice(0, 10) >= cutoff60);
  const monthlyIncome = recentTxns.filter((t) => t.amount > 0).reduce((s, t) => s + (parseFloat(t.amount) || 0), 0) / 2;
  const monthlyExpenses = recentTxns.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(parseFloat(t.amount) || 0), 0) / 2;
  const monthlySurplus = monthlyIncome - monthlyExpenses;
  const historyDays60 = historyDaysWithin(transactions, cutoff60, todayStr);

  const out = {};

  // ── runway_days / runway_date ────────────────────────────────────────────
  const runwaySample = runway.band === 'unknown' || runway.daysLeft == null;
  out.runway_days = runwaySample
    ? { value: SAMPLE_DATA.runway_days, formatted: `${SAMPLE_DATA.runway_days} days`, grade: 'C', sample: true }
    : { value: runway.daysLeft, formatted: `${runway.daysLeft} days`, grade: runway.grade, sample: false };

  const sampleRunwayDate = ymdLocal(addDaysLocal(today, SAMPLE_DATA.runway_days));
  out.runway_date = runwaySample
    ? { value: sampleRunwayDate, formatted: formatYmd(sampleRunwayDate), grade: 'C', sample: true }
    : { value: runway.dateMoneyRunsOut, formatted: formatYmd(runway.dateMoneyRunsOut), grade: runway.grade, sample: false };

  // ── liquid ────────────────────────────────────────────────────────────────
  out.liquid = !hasAccounts
    ? { value: SAMPLE_DATA.liquid, formatted: usd0.format(SAMPLE_DATA.liquid), grade: 'C', sample: true }
    : { value: Math.round(runway.liquid * 100) / 100, formatted: usd0.format(runway.liquid), grade: 'A', sample: false };

  // ── savings_rate / monthly_surplus ──────────────────────────────────────
  const noIncomeSignal = !hasTransactions || monthlyIncome <= 0;
  out.savings_rate = noIncomeSignal
    ? { value: SAMPLE_DATA.savings_rate, formatted: pct1(SAMPLE_DATA.savings_rate), grade: 'C', sample: true }
    : {
        value: Math.round((monthlySurplus / monthlyIncome) * 1000) / 1000,
        formatted: pct1(monthlySurplus / monthlyIncome),
        grade: gradeFromHistoryDays(historyDays60),
        sample: false,
      };

  out.monthly_surplus = !hasTransactions
    ? { value: SAMPLE_DATA.monthly_surplus, formatted: usd0.format(SAMPLE_DATA.monthly_surplus), grade: 'C', sample: true }
    : {
        value: Math.round(monthlySurplus * 100) / 100,
        formatted: usd0.format(monthlySurplus),
        grade: gradeFromHistoryDays(historyDays60),
        sample: false,
      };

  // ── ef_months_covered / ef_target ───────────────────────────────────────
  const ef = goalInsights.emergencyFund;
  const noExpenseSignal = ef.monthlyExpenses <= 0;
  out.ef_months_covered = noExpenseSignal
    ? { value: SAMPLE_DATA.ef_months_covered, formatted: `${SAMPLE_DATA.ef_months_covered} months`, grade: 'C', sample: true }
    : { value: ef.monthsCovered, formatted: `${ef.monthsCovered} months`, grade: gradeFromHistoryDays(historyDays60), sample: false };
  out.ef_target = noExpenseSignal
    ? { value: SAMPLE_DATA.ef_target, formatted: usd0.format(SAMPLE_DATA.ef_target), grade: 'C', sample: true }
    : { value: ef.targetAmount, formatted: usd0.format(ef.targetAmount), grade: gradeFromHistoryDays(historyDays60), sample: false };

  // ── budget_variance_top3 ─────────────────────────────────────────────────
  // Rows carry {name, formatted} (in addition to raw fields) because lesson
  // content iterates this variable as a Mustache section — see
  // content/learn/m2-cash-flow-steer/*.md's `{{#budget_variance_top3}}...
  // {{name}} — {{formatted}}...{{/budget_variance_top3}}`.
  if (!hasBudgets) {
    out.budget_variance_top3 = { value: SAMPLE_DATA.budget_variance_top3, formatted: 'Food: $140 over (sample)', grade: 'C', sample: true };
  } else {
    const nameOf = new Map(categories.map((c) => [c.id, c.name || c.id]));
    // This variable reads as "this month" in the lessons, so it grades only
    // monthly budgets (computeBudgetStatus now reports every period).
    const rows = calc.computeBudgetStatus(budgets.filter((b) => b.period === 'monthly'), transactions)
      .map((b) => {
        const variance = Math.round((b.spent - b.limit) * 100) / 100;
        return {
          category_id: b.category_id,
          name: nameOf.get(b.category_id) || b.category_id,
          limit: b.limit,
          spent: b.spent,
          variance,
          formatted: variance === 0 ? 'on budget' : `${usd0.format(Math.abs(variance))} ${variance > 0 ? 'over' : 'under'}`,
        };
      })
      .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
      .slice(0, 3);
    // Only monthly budgets are graded here, so a user with only weekly/annual
    // budgets lands here too — that's an absence
    // of evidence (the filter, not the data), not a graded-A "no variance"
    // result, so it can't claim grade A.
    const formatted = rows.length
      ? rows.map((r) => `${r.name}: ${r.formatted}`).join('; ')
      : 'No budget activity yet this month';
    out.budget_variance_top3 = { value: rows, formatted, grade: rows.length ? 'A' : 'C', sample: false };
  }

  // ── recurring_monthly ────────────────────────────────────────────────────
  if (!hasRecurring) {
    out.recurring_monthly = { value: SAMPLE_DATA.recurring_monthly, formatted: usd0.format(SAMPLE_DATA.recurring_monthly), grade: 'C', sample: true };
  } else {
    const total = recurring.filter((r) => r.kind !== 'income').reduce((s, r) => s + perMonth(r.amount, r.cadence), 0);
    // recurring includes payees whose "recurring" status is itself inferred
    // from transaction history (server/learn/routes.js runs detection before
    // handing this in) — ground the grade in the same trailing-60-day history
    // depth used for savings_rate/monthly_surplus, rather than asserting A
    // regardless of how little history backs the detection.
    out.recurring_monthly = { value: Math.round(total * 100) / 100, formatted: usd0.format(total), grade: gradeFromHistoryDays(historyDays60), sample: false };
  }

  // ── largest_outflow ──────────────────────────────────────────────────────
  // This is a SUM of a payee's outflows across the trailing 90-day window
  // (server/money/runway.js), not a single current bill — the formatted
  // string must say so, or lesson prose that quotes it back as "your largest
  // outflow right now" states a 3x-inflated number as fact (e.g. rent posted
  // 3x in 90 days reads as one $5,400 outflow). Grade follows the same
  // history-depth evidence runway_days uses for the identical window
  // (server/money/runway.js's own A/B/C doc comment: full 90-day history
  // earns A, >=14 days earns B, thinner is C) rather than a flat 'A'.
  out.largest_outflow = !runway.largestOutflow
    ? {
        value: SAMPLE_DATA.largest_outflow,
        formatted: `${SAMPLE_DATA.largest_outflow.payee} — ${usd0.format(SAMPLE_DATA.largest_outflow.amount)} over the last 90 days`,
        grade: 'C',
        sample: true,
      }
    : {
        value: runway.largestOutflow,
        formatted: `${runway.largestOutflow.payee} — ${usd0.format(runway.largestOutflow.amount)} over the last 90 days`,
        grade: gradeFromHistoryDays(runway.historyDays, 90),
        sample: false,
      };

  // ── debt_ledger ──────────────────────────────────────────────────────────
  if (!hasAccounts) {
    out.debt_ledger = {
      value: SAMPLE_DATA.debt_ledger,
      formatted: `${SAMPLE_DATA.debt_ledger[0].name}: ${usd0.format(SAMPLE_DATA.debt_ledger[0].balance)} (sample)`,
      grade: 'C',
      sample: true,
    };
  } else {
    const debts = accounts
      .filter((a) => isLiability(a.type))
      .map((a) => ({ name: a.name, balance: Math.round(Math.abs(parseFloat(a.balance) || 0) * 100) / 100, type: a.type }));
    const formatted = debts.length ? debts.map((d) => `${d.name}: ${usd0.format(d.balance)}`).join('; ') : 'No debt on record';
    out.debt_ledger = { value: debts, formatted, grade: 'A', sample: false };
  }

  return out;
}

module.exports = { computeVariables, SAMPLE_DATA };
