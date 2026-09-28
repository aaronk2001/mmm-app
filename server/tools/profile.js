// Fuses real MMM data with the user's declared profile into the one snapshot
// every planning model consumes. Pure: it opens nothing and mutates nothing.
const calc = require('../money/calc');
const { computeRunway } = require('../money/runway');
const { signedBalance } = require('../money/account-types');

// Buckets over server/money/account-types.js's list. 'investment' stays under
// retirement for backwards compatibility (it was the only investing type before
// that list existed); brokerage and crypto are taxable investments.
const CHECKING    = new Set(['checking']);
const SAVINGS     = new Set(['savings', 'cash']);
const RETIREMENT  = new Set(['retirement', 'investment']);
const INVESTMENTS = new Set(['brokerage', 'crypto']);

const PROFILE_FIELDS = [
  'name', 'age', 'state', 'filing_status', 'gross_salary',
  'employment_status', 'income_end_date', 'retirement_age', 'risk_tolerance',
];

const FILING_STATUSES = ['single', 'married_joint', 'married_separate', 'head_of_household'];
const EMPLOYMENT      = ['employed', 'self_employed', 'contract', 'student', 'unemployed'];
const RISK            = ['conservative', 'moderate', 'aggressive'];

// Mirrors server/money/runway.js perMonth — keep the two in step.
function perMonth(amount, cadence) {
  const a = Math.abs(parseFloat(amount) || 0);
  if (cadence === 'weekly')    return a * 52 / 12;
  if (cadence === 'biweekly')  return a * 26 / 12;
  if (cadence === 'quarterly') return a / 3;
  if (cadence === 'annual')    return a / 12;
  return a;
}

const round2 = (n) => Math.round(n * 100) / 100;

// Base currency + FX rates, the same way store.getCurrencyConfig resolves them.
function currencyConfig(settings) {
  return {
    baseCurrency: settings?.baseCurrency || 'USD',
    fxRates: { ...calc.DEFAULT_FX_RATES, ...(settings?.fxRates || {}) },
  };
}

// Accounts, transactions and recurring amounts restated in the base currency.
// A transaction or linked recurring item takes its account's currency; an
// unlinked recurring item is taken to be in the base currency already.
function inBaseCurrency(data, settings) {
  const { baseCurrency, fxRates } = currencyConfig(settings);
  const accounts = data?.accounts || [];
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency || 'USD']));
  const conv = (amount, currency) =>
    calc.convertAmount(Number(amount) || 0, currency || baseCurrency, baseCurrency, fxRates);
  return {
    baseCurrency,
    accounts: accounts.map((a) => ({ ...a, balance: conv(a.balance, a.currency || 'USD'), currency: baseCurrency })),
    transactions: (data?.transactions || []).map((t) => ({ ...t, amount: conv(t.amount, currencyOf.get(t.account_id)) })),
    recurring: (data?.recurring || []).map((r) => ({ ...r, amount: conv(r.amount, currencyOf.get(r.account_id)) })),
  };
}

/**
 * @param {object} data  the shape returned by server/money/store.js readData()
 *   (`repo.readAll()`): `{ accounts, transactions, recurring, categories, goals }`.
 *   Balances and amounts are dollars in each account's currency; they are
 *   converted to the base currency (settings.baseCurrency / fxRates) here.
 *   `recurring` is the DECLARED list.
 * @param {{ profile?: object, baseCurrency?: string, fxRates?: object }} settings
 *   settings.profile holds the user's declared facts (name, age, state, gross_salary, ...).
 * @param {{ today?: Date }} [opts]
 * @returns {object} snapshot — the shape server/tools/planning.js consumes.
 */
function profileFromMmm(data, settings, { today = new Date() } = {}) {
  const p = settings?.profile || {};
  const base = inBaseCurrency(data, settings);

  let checking = 0;
  let savings = 0;
  let retirement = 0;
  let investments = 0;
  let currentNetWorth = 0;
  for (const a of base.accounts) {
    // Liabilities count as -|balance| whatever sign they were entered with.
    const balance = signedBalance(a);
    currentNetWorth += balance;
    if (CHECKING.has(a.type)) checking += balance;
    else if (SAVINGS.has(a.type)) savings += balance;
    else if (RETIREMENT.has(a.type)) retirement += balance;
    else if (INVESTMENTS.has(a.type)) investments += balance;
  }

  // Monthly expenses = max(actual burn, declared bills), the same rule as the
  // Goals tab. Actual burn uses runway's spend definition (liquid-account
  // outflows over the trailing 90 days, transfers excluded, a card purchase
  // counted once via its payment). Declared bills alone left the Plan tab at
  // $0/month — FIRE number $0 — for anyone who hadn't typed their bills in.
  const declaredMonthly = base.recurring
    .filter((r) => r.kind === 'bill')
    .reduce((sum, r) => sum + perMonth(r.amount, r.cadence), 0);
  const runway = computeRunway({
    accounts: base.accounts,
    transactions: base.transactions,
    recurring: base.recurring,
    categories: data?.categories || [],
    today,
  });
  const actualMonthly = runway.actualMonthly || 0;
  const totalMonthly = Math.max(actualMonthly, declaredMonthly);
  const expensesSource = totalMonthly === 0 ? 'none'
    : actualMonthly >= declaredMonthly ? 'actual' : 'declared';

  const grossSalary = Number(p.gross_salary) > 0 ? Number(p.gross_salary) : null;

  // Grade reflects how much of the snapshot is real vs. defaulted: A needs
  // both a real account and a declared salary, B needs one, C has neither.
  const hasAccount = base.accounts.length > 0;
  const hasSalary = grossSalary !== null;
  const grade = hasAccount && hasSalary ? 'A' : hasAccount || hasSalary ? 'B' : 'C';

  const state = typeof p.state === 'string' && /^[A-Za-z]{2}$/.test(p.state) ? p.state.toUpperCase() : null;

  return {
    currency: base.baseCurrency,
    assets: { checking: round2(checking), savings: round2(savings), retirement: round2(retirement), investments: round2(investments) },
    expenses: {
      total_monthly: round2(totalMonthly),
      actual_monthly: round2(actualMonthly),
      declared_monthly: round2(declaredMonthly),
      source: expensesSource,
      history_days: runway.historyDays,
    },
    income: { current_gross: grossSalary },
    context: {
      // No default state: planning reports "no state tax" for an unset state
      // (flagged) instead of silently taxing everyone as an Arizona resident.
      state,
      filing_status: FILING_STATUSES.includes(p.filing_status) ? p.filing_status : 'single',
      gap_period_weeks: 0,
      current_net_worth: round2(currentNetWorth),
    },
    goals: {
      emergency_fund_target: p.emergency_fund_target,
      roth_ira_monthly: p.roth_ira_monthly,
      target_net_worth_18mo: p.target_net_worth_18mo,
    },
    grade,
  };
}

/**
 * @param {object} partial  candidate profile fields, e.g. a PUT /profile body.
 * @returns {{ ok: boolean, errors: string[], value: object }} value contains
 *   only whitelisted PROFILE_FIELDS keys present in `partial`.
 */
function validateProfile(partial) {
  const src = partial || {};
  const errors = [];
  const value = {};

  for (const key of PROFILE_FIELDS) {
    if (!(key in src)) continue;
    const raw = src[key];

    switch (key) {
      case 'age': {
        const n = Number(raw);
        if (!(n >= 13 && n <= 120)) errors.push('age must be between 13 and 120');
        value[key] = n;
        break;
      }
      case 'retirement_age': {
        const n = Number(raw);
        if (!(n >= 30 && n <= 100)) errors.push('retirement_age must be between 30 and 100');
        value[key] = n;
        break;
      }
      case 'gross_salary': {
        const n = Number(raw);
        if (!(n >= 0)) errors.push('gross_salary must be >= 0');
        value[key] = n;
        break;
      }
      case 'state': {
        if (typeof raw !== 'string' || !/^[A-Za-z]{2}$/.test(raw)) errors.push('state must be a 2-letter code');
        value[key] = raw;
        break;
      }
      case 'filing_status': {
        if (!FILING_STATUSES.includes(raw)) errors.push(`filing_status must be one of ${FILING_STATUSES.join(', ')}`);
        value[key] = raw;
        break;
      }
      case 'employment_status': {
        if (!EMPLOYMENT.includes(raw)) errors.push(`employment_status must be one of ${EMPLOYMENT.join(', ')}`);
        value[key] = raw;
        break;
      }
      case 'risk_tolerance': {
        if (!RISK.includes(raw)) errors.push(`risk_tolerance must be one of ${RISK.join(', ')}`);
        value[key] = raw;
        break;
      }
      case 'income_end_date': {
        if (raw !== null && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) errors.push('income_end_date must be null or YYYY-MM-DD');
        value[key] = raw;
        break;
      }
      default:
        value[key] = raw;
    }
  }

  return { ok: errors.length === 0, errors, value };
}

module.exports = { profileFromMmm, inBaseCurrency, currencyConfig, validateProfile, PROFILE_FIELDS, FILING_STATUSES, EMPLOYMENT, RISK };
