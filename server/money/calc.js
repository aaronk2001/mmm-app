'use strict';

// Pure money math — no I/O, no DB. Everything here takes plain data in and
// returns plain data out, so it's unit-testable and reusable.
//
// Dates are compared as 'YYYY-MM-DD' STRINGS, never via new Date(): parsing a
// bare ISO date yields UTC midnight while month windows built with new Date()
// are local, which silently dropped transactions dated the 1st of the month in
// UTC-negative timezones (found by the Phase-1 characterization tests).

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

    if (type === 'loan' || type === 'credit') {
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

// Current-month spend per monthly budget. Month membership is a string-prefix
// check on the local calendar month.
function computeBudgetStatus(budgets, transactions) {
  const ym = localDate().slice(0, 7);

  return budgets
    .filter(b => b.period === 'monthly')
    .map(budget => {
      const spent = transactions
        .filter(t => t.category_id === budget.category_id &&
                     t.amount < 0 &&
                     String(t.date).slice(0, 7) === ym)
        .reduce((sum, t) => sum + Math.abs(parseFloat(t.amount) || 0), 0);

      const limit = parseFloat(budget.limit) || 0;
      const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;

      return {
        budget_id: budget.id,
        category_id: budget.category_id,
        limit: Math.round(limit * 100) / 100,
        spent: Math.round(spent * 100) / 100,
        pct,
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
    const lastDate = new Date(lastTxn.date);

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
      next_date: nextDate.toISOString().split('T')[0],
    });
  });

  // Declared recurring takes precedence over detected duplicates.
  const declaredPayees = new Set((declaredRecurring || []).map(r => r.payee.toLowerCase()));
  return [...declaredRecurring || [], ...recurring.filter(r => !declaredPayees.has(r.payee.toLowerCase()))];
}

// Forward-projects liquid balances. avgDailyDiscretionary is supplied by the
// caller (store computes it from recent transactions) so this stays pure.
function projectCashflow(accounts, recurring, days = 90, avgDailyDiscretionary = 0) {
  const startBalance = accounts
    .filter(a => a.type === 'checking' || a.type === 'savings' || a.type === 'cash')
    .reduce((sum, a) => sum + (parseFloat(a.balance) || 0), 0);

  const projection = [];
  const lowBalanceWarnings = [];
  let currentBalance = startBalance;
  const today = new Date();

  for (let d = 0; d <= days; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().split('T')[0];

    recurring.forEach(r => {
      const nextDate = new Date(r.next_date);
      let checkDate = nextDate;

      while (checkDate <= date) {
        if (checkDate.toISOString().split('T')[0] === dateStr) {
          const delta = r.kind === 'income' ? parseFloat(r.amount) : -parseFloat(r.amount);
          currentBalance += delta;
        }

        if (r.cadence === 'monthly') checkDate.setMonth(checkDate.getMonth() + 1);
        else if (r.cadence === 'biweekly') checkDate.setDate(checkDate.getDate() + 14);
        else if (r.cadence === 'weekly') checkDate.setDate(checkDate.getDate() + 7);
        else break;
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

function computeGoalInsights(accounts, transactions) {
  const cutoff = localDate(-60);

  const monthlyExpenses = transactions
    .filter(t => String(t.date).slice(0, 10) >= cutoff && t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(parseFloat(t.amount) || 0), 0) / 2;

  const liquidAssets = accounts
    .filter(a => a.type === 'checking' || a.type === 'savings' || a.type === 'cash')
    .reduce((sum, a) => sum + (parseFloat(a.balance) || 0), 0);

  const emergencyFundMonths = 6;
  const emergencyFundTarget = monthlyExpenses * emergencyFundMonths;
  const emergencyFundCovered = Math.floor(liquidAssets / (monthlyExpenses || 1));

  const emergencyFundAdequacy = liquidAssets >= emergencyFundTarget ? 'good' : liquidAssets >= (monthlyExpenses * 3) ? 'ok' : 'low';

  const nw = computeNetWorth(accounts);

  const annualExpenses = monthlyExpenses * 12;
  const fireNumber = annualExpenses * 25;
  const fireProgress = (nw.net / fireNumber) * 100;

  const monthlyIncome = transactions
    .filter(t => String(t.date).slice(0, 10) >= cutoff && t.amount > 0)
    .reduce((sum, t) => sum + parseFloat(t.amount) || 0, 0) / 2;

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

module.exports = {
  DEFAULT_FX_RATES,
  AVAILABLE_CURRENCIES,
  localDate,
  convertAmount,
  computeNetWorth,
  computeBudgetStatus,
  autoCategorize,
  detectRecurring,
  projectCashflow,
  computeGoalInsights,
  computeInvestmentMetrics,
};
