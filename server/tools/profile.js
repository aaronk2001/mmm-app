// Fuses real MMM data with the user's declared profile into the one snapshot
// every planning model consumes. Pure: it opens nothing and mutates nothing.
const LIQUID_CHECKING = new Set(['checking']);
const LIQUID_SAVINGS  = new Set(['savings', 'cash']);
const RETIREMENT      = new Set(['investment']);

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

/**
 * @param {object} data  the shape returned by server/money/store.js readData()
 *   (`repo.readAll()`): `{ accounts, transactions, recurring, categories, goals }`.
 *   Account balances are dollars; liabilities (credit, loan) already carry a
 *   negative balance. `recurring[].amount` is dollars (repo.readAll converts
 *   amount_cents on the way out — see server/money/runway.js).
 * @param {{ profile?: object }} settings  settings.profile holds the user's
 *   declared facts (name, age, state, gross_salary, ...).
 * @returns {object} snapshot — the shape server/tools/planning.js consumes.
 */
function profileFromMmm(data, settings) {
  const p = settings?.profile || {};
  const accounts = data?.accounts || [];
  const recurring = data?.recurring || [];

  let checking = 0;
  let savings = 0;
  let retirement = 0;
  let currentNetWorth = 0;
  for (const a of accounts) {
    const balance = Number(a.balance) || 0;
    currentNetWorth += balance;
    if (LIQUID_CHECKING.has(a.type)) checking += balance;
    else if (LIQUID_SAVINGS.has(a.type)) savings += balance;
    else if (RETIREMENT.has(a.type)) retirement += balance;
  }

  const totalMonthly = recurring
    .filter((r) => r.kind === 'bill')
    .reduce((sum, r) => sum + perMonth(r.amount, r.cadence), 0);

  const grossSalary = Number(p.gross_salary) > 0 ? Number(p.gross_salary) : null;

  // Grade reflects how much of the snapshot is real vs. defaulted: A needs
  // both a real account and a declared salary, B needs one, C has neither.
  const hasAccount = accounts.length > 0;
  const hasSalary = grossSalary !== null;
  const grade = hasAccount && hasSalary ? 'A' : hasAccount || hasSalary ? 'B' : 'C';

  return {
    assets: { checking, savings, retirement },
    expenses: { total_monthly: totalMonthly },
    income: { current_gross: grossSalary },
    context: {
      state: p.state || 'AZ',
      gap_period_weeks: 0,
      current_net_worth: currentNetWorth,
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

module.exports = { profileFromMmm, validateProfile, PROFILE_FIELDS, FILING_STATUSES, EMPLOYMENT, RISK };
