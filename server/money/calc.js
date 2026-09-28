'use strict';

// Pure money math — no I/O, no DB. Everything here takes plain data in and
// returns plain data out, so it's unit-testable and reusable.
//
// Dates are compared as 'YYYY-MM-DD' STRINGS, never via new Date(): parsing a
// bare ISO date yields UTC midnight while month windows built with new Date()
// are local, which silently dropped transactions dated the 1st of the month in
// UTC-negative timezones (found by the Phase-1 characterization tests).

const { isLiability, isLiquid } = require('./account-types');

// Multi-currency. fxRates are "value of 1 unit in USD" (USD per unit). Convert an
// amount in `currency` to `baseCurrency`: amount * (rate[currency] / rate[base]).
const DEFAULT_FX_RATES = { USD: 1, EUR: 1.08, GBP: 1.27, JPY: 0.0064, CAD: 0.73, CHF: 1.12, AUD: 0.66, NZD: 0.60 };
const AVAILABLE_CURRENCIES = Object.keys(DEFAULT_FX_RATES);

// Local-time calendar date as 'YYYY-MM-DD' (optionally offset by days).
function localDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function convertAmount(amount, currency, baseCurrency, fxRates) {
  if (!fxRates || !currency || currency === baseCurrency) return amount;
  const rc = fxRates[currency] || 1;
  const rb = fxRates[baseCurrency] || 1;
  return amount * (rc / rb);
}

function computeNetWorth(accounts, baseCurrency = 'USD', fxRates = null) {
  let assets = 0;
  let liabilities = 0;

  accounts.forEach(acc => {
    const balance = convertAmount(parseFloat(acc.balance) || 0, acc.currency, baseCurrency, fxRates);
    const type = acc.type;

    if (isLiability(type)) {
      liabilities += Math.abs(balance); // Treat as positive liabilities
    } else {
      assets += Math.max(0, balance); // Only count positive balances
    }
  });

  return {
    assets: Math.round(assets * 100) / 100,
    liabilities: Math.round(liabilities * 100) / 100,
    net: Math.round((assets - liabilities) * 100) / 100,
  };
}

// ── budgets ──────────────────────────────────────────────────────────────────
// Every period the validator accepts gets a status (weekly/biweekly/annual
// budgets used to vanish), windows are LOCAL calendar dates, and rollover is
// real: a rollover budget carries last period's remainder into this one —
// unspent money adds to what's available, overspending subtracts from it.

const pad2 = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dateOf = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (ymd, n) => { const d = dateOf(ymd); d.setDate(d.getDate() + n); return ymdOf(d); };
// Biweekly windows are counted from a fixed Monday so they're stable.
const BIWEEKLY_EPOCH = '2024-01-01';

// [start, end] (inclusive YYYY-MM-DD) of the `period` window containing `ymd`.
function budgetWindow(period, ymd) {
  const d = dateOf(ymd);
  if (period === 'annual') return [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`];
  if (period === 'weekly') {
    const start = addDays(ymd, -((d.getDay() + 6) % 7)); // Monday
    return [start, addDays(start, 6)];
  }
  if (period === 'biweekly') {
    const days = Math.round((dateOf(ymd) - dateOf(BIWEEKLY_EPOCH)) / 86400000);
    const start = addDays(BIWEEKLY_EPOCH, Math.floor(days / 14) * 14);
    return [start, addDays(start, 13)];
  }
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const ym = ymd.slice(0, 7);
  return [`${ym}-01`, `${ym}-${pad2(last)}`];
}

function computeBudgetStatus(budgets, transactions, today = localDate()) {
  const outflowByCategory = {};
  for (const t of transactions) {
    const amt = parseFloat(t.amount) || 0;
    if (amt >= 0 || !t.category_id) continue;
    (outflowByCategory[t.category_id] = outflowByCategory[t.category_id] || []).push([String(t.date).slice(0, 10), -amt]);
  }
  const spentIn = (categoryId, [start, end]) => (outflowByCategory[categoryId] || [])
    .reduce((sum, [date, amt]) => (date >= start && date <= end ? sum + amt : sum), 0);
  const round2 = (n) => Math.round(n * 100) / 100;

  return budgets.map((budget) => {
    const window = budgetWindow(budget.period, today);
    const limit = parseFloat(budget.limit) || 0;
    const spent = spentIn(budget.category_id, window);
    const carried = budget.rollover
      ? limit - spentIn(budget.category_id, budgetWindow(budget.period, addDays(window[0], -1)))
      : 0;
    const available = limit + carried;
    const base = available > 0 ? available : limit;
    return {
      budget_id: budget.id,
      category_id: budget.category_id,
      period: budget.period,
      rollover: !!budget.rollover,
      limit: round2(limit),
      carried: round2(carried),
      available: round2(available),
      spent: round2(spent),
      remaining: round2(available - spent),
      pct: base > 0 ? Math.round((spent / base) * 100) : 0,
      over: spent > available + 0.005,
      period_start: window[0],
      period_end: window[1],
    };
  });
}

function autoCategorize(payee, amount) {
  if (!payee) return 'oth';

  const p = payee.toLowerCase();

  if (/payroll|salary|deposit|transfer in|direct deposit/i.test(p)) return 'inc';
  if (/rent|mortgage|landlord|property/i.test(p)) return 'hou';
  if (/whole foods|grocery|safeway|kroger|trader joe|restaurant|chipotle|pizza|mcdonalds|subway|doordash|ubereats|grubhub|dine/i.test(p)) return 'fod';
  if (/uber|lyft|taxi|gas|shell|chevron|exxon|parking|metro|transit|train|bus|car wash|mechanic|honda|ford|tesla|auto|vehicle/i.test(p)) return 'tra';
  if (/amazon|target|walmart|costco|target|mall|store|retail|ebay|etsy|clothing|apparel/i.test(p)) return 'sho';
  if (/electric|water|gas|internet|phone|verizon|at&t|comcast|utility|power/i.test(p)) return 'uti';
  if (/movie|cinema|theater|concert|game|steam|playstation|xbox|ticket|event|museum|zoo|park/i.test(p)) return 'ent';
  if (/netflix|spotify|hulu|disney|apple|subscription|adobe|premium|membership/i.test(p)) return 'sub';
  if (/doctor|hospital|pharmacy|cvs|walgreens|clinic|medical|health|dental|gym|fitness|yoga/i.test(p)) return 'hea';
  if (/savings|transfer out|investment|brokerage/i.test(p)) return 'sav';

  return 'oth';
}

function detectRecurring(transactions, declaredRecurring = []) {
  if (transactions.length === 0) return declaredRecurring || [];

  const groups = {};
  transactions.forEach(t => {
    const key = t.payee.toLowerCase();
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });

  const recurring = [];

  Object.entries(groups).forEach(([payee, txns]) => {
    if (txns.length < 2) return;

    txns.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Amounts must be similar (within 10%)
    const amounts = txns.map(t => Math.abs(parseFloat(t.amount) || 0));
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const tolerance = avgAmount * 0.1;
    const amountVariance = amounts.every(a => Math.abs(a - avgAmount) <= tolerance);

    if (!amountVariance) return;

    // Detect cadence (monthly, biweekly, weekly)
    const dates = txns.map(t => new Date(t.date).getTime());
    const intervals = [];
    for (let i = 1; i < dates.length; i++) {
      intervals.push(Math.round((dates[i] - dates[i - 1]) / 86400000));
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    let cadence = 'other';
    if (avgInterval >= 28 && avgInterval <= 35) cadence = 'monthly';
    else if (avgInterval >= 13 && avgInterval <= 15) cadence = 'biweekly';
    else if (avgInterval >= 6 && avgInterval <= 8) cadence = 'weekly';

    if (cadence === 'other') return;

    const kind = parseFloat(txns[0].amount) > 0 ? 'income' : 'bill';
    const lastTxn = txns[txns.length - 1];
    const lastDate = localDateFromStr(lastTxn.date);

    let nextDate = new Date(lastDate);
    if (cadence === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1);
    else if (cadence === 'biweekly') nextDate.setDate(nextDate.getDate() + 14);
    else if (cadence === 'weekly') nextDate.setDate(nextDate.getDate() + 7);

    recurring.push({
      payee,
      amount: Math.round(avgAmount * 100) / 100,
      cadence,
      kind,
      last_date: lastTxn.date,
      next_date: ymdLocal(nextDate),
    });
  });

  // Declared recurring takes precedence over detected duplicates.
  const declaredPayees = new Set((declaredRecurring || []).map(r => r.payee.toLowerCase()));
  return [...declaredRecurring || [], ...recurring.filter(r => !declaredPayees.has(r.payee.toLowerCase()))];
}

// Mirrors server/money/store.js addMonthsClamped — keep the two in step.
// Adds n months to Date `d`, clamping the day-of-month to the target month's
// last day instead of letting it roll into the following month.
function addMonthsClamped(d, n) {
  const day = d.getDate();
  const probe = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(probe.getFullYear(), probe.getMonth() + 1, 0).getDate();
  probe.setDate(Math.min(day, lastDay));
  return probe;
}

// Returns a new Date advanced by one cadence period, or null for an
// unrecognized cadence (caller stops advancing rather than guessing monthly).
// Local-calendar helpers — mirrors server/money/runway.js. Everything in this
// file that keys off a day must agree on local time; see projectCashflow.
function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function localDateFromStr(s) {
  const [y, mo, dd] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, mo - 1, dd);
}

function advanceCadence(d, cadence) {
  if (cadence === 'weekly') { const nd = new Date(d); nd.setDate(nd.getDate() + 7); return nd; }
  if (cadence === 'biweekly') { const nd = new Date(d); nd.setDate(nd.getDate() + 14); return nd; }
  if (cadence === 'monthly') return addMonthsClamped(d, 1);
  if (cadence === 'quarterly') return addMonthsClamped(d, 3);
  if (cadence === 'annual') return addMonthsClamped(d, 12);
  return null;
}

// Forward-projects liquid balances. avgDailyDiscretionary is supplied by the
// caller (store computes it from recent transactions) so this stays pure.
function projectCashflow(accounts, recurring, days = 90, avgDailyDiscretionary = 0) {
  const startBalance = accounts
    .filter(a => isLiquid(a.type))
    .reduce((sum, a) => sum + (parseFloat(a.balance) || 0), 0);

  const projection = [];
  const lowBalanceWarnings = [];
  let currentBalance = startBalance;
  // Local midnight, not `new Date()`. Dates in this app compare as local
  // YYYY-MM-DD strings; the previous version built day keys with
  // toISOString() (UTC) while `new Date('YYYY-MM-DD')` parses as UTC
  // midnight, and advanceCadence advances with LOCAL getters. West of
  // Greenwich those three disagree, so an occurrence could land on a day key
  // that never matched and silently vanish from the forecast.
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (let d = 0; d <= days; d++) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
    const dateStr = ymdLocal(date);

    recurring.forEach(r => {
      let checkDate = localDateFromStr(r.next_date);

      while (checkDate <= date) {
        if (ymdLocal(checkDate) === dateStr) {
          const delta = r.kind === 'income' ? parseFloat(r.amount) : -parseFloat(r.amount);
          currentBalance += delta;
        }

        const advanced = advanceCadence(checkDate, r.cadence);
        if (!advanced) break;
        checkDate = advanced;
      }
    });

    currentBalance -= avgDailyDiscretionary;

    projection.push({
      date: dateStr,
      balance: Math.round(currentBalance * 100) / 100,
    });

    if (currentBalance < 500) {
      lowBalanceWarnings.push({
        date: dateStr,
        balance: Math.round(currentBalance * 100) / 100,
      });
    }
  }

  const lowestProjection = projection.reduce((min, p) => p.balance < min.balance ? p : min);

  return {
    startBalance: Math.round(startBalance * 100) / 100,
    days,
    projection,
    recurring: recurring.map(r => ({
      payee: r.payee,
      amount: r.amount,
      cadence: r.cadence,
      kind: r.kind,
    })),
    lowBalanceWarnings,
    summary: {
      endBalance: projection[projection.length - 1]?.balance || startBalance,
      lowestBalance: lowestProjection.balance,
      lowestDate: lowestProjection.date,
      netChange: Math.round((projection[projection.length - 1]?.balance - startBalance) * 100) / 100,
    },
  };
}

function computeGoalInsights(accounts, transactions, recurring = []) {
  const cutoff = localDate(-60);

  // Actual monthly flow from the last 60 days of transactions.
  const txnMonthlyExpenses = transactions
    .filter(t => String(t.date).slice(0, 10) >= cutoff && t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(parseFloat(t.amount) || 0), 0) / 2;
  const txnMonthlyIncome = transactions
    .filter(t => String(t.date).slice(0, 10) >= cutoff && t.amount > 0)
    .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0) / 2;

  // Recurring items normalized to a monthly figure. Most users model bills as
  // recurring rather than posting every transaction, so fold them in — take the
  // max so linked (already-posted) recurring isn't double counted.
  const perMonth = (amt, cadence) => {
    const a = Math.abs(parseFloat(amt) || 0);
    if (cadence === 'weekly') return a * 52 / 12;
    if (cadence === 'biweekly') return a * 26 / 12;
    if (cadence === 'quarterly') return a / 3;
    if (cadence === 'annual') return a / 12;
    return a; // monthly
  };
  let recurringBills = 0;
  let recurringIncome = 0;
  for (const r of (recurring || [])) {
    if (r.kind === 'income') recurringIncome += perMonth(r.amount, r.cadence);
    else recurringBills += perMonth(r.amount, r.cadence);
  }

  const monthlyExpenses = Math.max(txnMonthlyExpenses, recurringBills);
  const monthlyIncome = Math.max(txnMonthlyIncome, recurringIncome);

  const liquidAssets = accounts
    .filter(a => isLiquid(a.type))
    .reduce((sum, a) => sum + (parseFloat(a.balance) || 0), 0);

  const emergencyFundMonths = 6;
  const emergencyFundTarget = monthlyExpenses * emergencyFundMonths;
  const emergencyFundCovered = monthlyExpenses > 0 ? Math.floor(liquidAssets / monthlyExpenses) : 0;

  const emergencyFundAdequacy = liquidAssets >= emergencyFundTarget ? 'good' : liquidAssets >= (monthlyExpenses * 3) ? 'ok' : 'low';

  const nw = computeNetWorth(accounts);

  const annualExpenses = monthlyExpenses * 12;
  const fireNumber = annualExpenses * 25;
  const fireProgress = (nw.net / fireNumber) * 100;

  const monthlySavings = monthlyIncome - monthlyExpenses;
  const yearsToFire = monthlySavings > 0 ? (fireNumber - nw.net) / (monthlySavings * 12 * 0.1 + monthlySavings * 12) : null;

  return {
    emergencyFund: {
      monthlyExpenses: Math.round(monthlyExpenses * 100) / 100,
      targetMonths: emergencyFundMonths,
      targetAmount: Math.round(emergencyFundTarget * 100) / 100,
      currentSaved: Math.round(liquidAssets * 100) / 100,
      monthsCovered: emergencyFundCovered,
      adequacy: emergencyFundAdequacy,
    },
    fire: {
      annualExpenses: Math.round(annualExpenses * 100) / 100,
      fireNumber: Math.round(fireNumber),
      currentNetWorth: Math.round(nw.net * 100) / 100,
      progressPct: Math.round(fireProgress * 10) / 10,
      yearsToFire: yearsToFire ? Math.round(yearsToFire * 10) / 10 : null,
    },
  };
}

function computeInvestmentMetrics(holdings) {
  const list = holdings || [];
  let marketValue = 0;
  let costTotal = 0;
  const bySymbol = {};
  for (const h of list) {
    const mv = (parseFloat(h.shares) || 0) * (parseFloat(h.current_price) || 0);
    const cb = (parseFloat(h.shares) || 0) * (parseFloat(h.cost_basis) || 0);
    marketValue += mv;
    costTotal += cb;
    bySymbol[h.symbol] = (bySymbol[h.symbol] || 0) + mv;
  }
  const gain = marketValue - costTotal;
  const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
  return {
    marketValue: round(marketValue),
    costBasis: round(costTotal),
    gain: round(gain),
    gainPct: costTotal > 0 ? round((gain / costTotal) * 100) : 0,
    holdingsCount: list.length,
    allocation: Object.entries(bySymbol).map(([symbol, value]) => ({
      symbol,
      value: round(value),
      pct: marketValue > 0 ? round((value / marketValue) * 100) : 0,
    })).sort((a, b) => b.value - a.value),
  };
}

// ── debt payoff ──────────────────────────────────────────────────────────────
// Used when an account has no APR / minimum payment on file. Every debt says
// whether it's using one, so the UI can label the figure as an assumption.
const DEFAULT_APR = { credit: 0.20, loan: 0.07 };
const defaultMinPayment = (balance) => Math.max(2, Math.round(balance * 0.02 * 100) / 100);

function debtsFromAccounts(accounts) {
  return accounts
    .filter((a) => isLiability(a.type))
    .map((a) => {
      const balance = Math.abs(parseFloat(a.balance) || 0);
      const hasApr = a.apr !== null && a.apr !== undefined && a.apr !== '';
      const hasMin = a.min_payment !== null && a.min_payment !== undefined && a.min_payment !== '';
      return {
        account_id: a.id,
        name: a.name,
        type: a.type,
        balance,
        apr: hasApr ? Number(a.apr) : DEFAULT_APR[a.type],
        apr_is_default: !hasApr,
        min_payment: hasMin ? Number(a.min_payment) : defaultMinPayment(balance),
        min_payment_is_default: !hasMin,
      };
    });
}

// Month-by-month avalanche/snowball simulation. The monthly budget is fixed at
// the sum of every debt's minimum plus `monthlyExtra`, so once a debt is paid
// off its minimum keeps working on the next target — the rollover that makes
// both strategies work. (The route used to count a freed minimum only in the
// month the debt hit zero, which on the sample data reported 97 months to
// debt-free instead of 64.) Minimum payments below the interest never pay off;
// that returns paysOff:false and monthsToFree:null instead of a fake date.
function simulateDebtPayoff(debts, { strategy = 'avalanche', monthlyExtra = 0, maxMonths = 600 } = {}) {
  const active = debts.filter((d) => d.balance > 0.005);
  const ordered = [...active].sort(strategy === 'snowball'
    ? (a, b) => a.balance - b.balance || b.apr - a.apr
    : (a, b) => b.apr - a.apr || a.balance - b.balance);
  const extra = Math.max(0, Number(monthlyExtra) || 0);
  const state = ordered.map((d) => ({ ...d, remaining: d.balance, paidOffMonth: null }));
  const budget = state.reduce((sum, d) => sum + d.min_payment, 0) + extra;

  let month = 0;
  let totalInterest = 0;
  const schedule = [];
  while (state.some((d) => d.remaining > 0.005) && month < maxMonths) {
    month++;
    for (const d of state) {
      if (d.remaining <= 0.005) continue;
      const interest = d.remaining * (d.apr / 12);
      d.remaining += interest;
      totalInterest += interest;
    }
    let left = budget;
    for (const d of state) {                    // minimums first
      if (d.remaining <= 0.005) continue;
      const pmt = Math.min(d.min_payment, d.remaining);
      d.remaining -= pmt;
      left -= pmt;
    }
    for (const d of state) {                    // everything else to the target
      if (left <= 0.005) break;
      if (d.remaining <= 0.005) continue;
      const pmt = Math.min(left, d.remaining);
      d.remaining -= pmt;
      left -= pmt;
    }
    for (const d of state) if (d.remaining <= 0.005 && d.paidOffMonth === null) { d.remaining = 0; d.paidOffMonth = month; }
    if (month % 3 === 0 || state.every((d) => d.remaining <= 0.005)) {
      schedule.push({ month, balances: state.map((d) => ({ name: d.name, remaining: Math.round(d.remaining * 100) / 100 })) });
    }
  }

  const paysOff = state.every((d) => d.remaining <= 0.005);
  return {
    strategy,
    order: state.map((d) => d.name),
    monthsToFree: paysOff ? month : null,
    paysOff,
    totalInterest: Math.round(totalInterest),
    payoff: state.map((d) => ({ account_id: d.account_id, name: d.name, month: d.paidOffMonth })),
    assumptions: {
      default_apr: state.filter((d) => d.apr_is_default).map((d) => d.name),
      default_min_payment: state.filter((d) => d.min_payment_is_default).map((d) => d.name),
    },
    schedule,
  };
}

module.exports = {
  DEFAULT_FX_RATES,
  AVAILABLE_CURRENCIES,
  localDate,
  ymdLocal,
  localDateFromStr,
  convertAmount,
  computeNetWorth,
  computeBudgetStatus,
  budgetWindow,
  debtsFromAccounts,
  simulateDebtPayoff,
  autoCategorize,
  detectRecurring,
  projectCashflow,
  computeGoalInsights,
  computeInvestmentMetrics,
};
