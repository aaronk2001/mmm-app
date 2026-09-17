// Runway: how long liquid cash lasts at the current burn. Pure; dollars in,
// dollars out; local-calendar dates. Scope rule: spend only counts outflows
// from liquid accounts (checking/savings/cash) inside the trailing 90-day
// window; transfer-group categories are excluded (moving cash checking->
// savings is not burn); a credit-card purchase is counted once, via the
// checking/savings payment that later clears the card, not at swipe time.
// Evidence grade: A = actual burn backed by the full 90-day window; B =
// actual burn from thin (but >=14-day) history, or burn imputed from
// recurring bills; C = actual burn from under 14 days of history, or
// nothing to go on (reported as 'unknown' band either way).
const LIQUID_TYPES = new Set(['checking', 'savings', 'cash']);
const WINDOW_DAYS = 90;

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function localDateFromStr(s) {
  const [y, mo, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, mo - 1, d);
}
function perMonth(amount, cadence) {
  const a = Math.abs(parseFloat(amount) || 0);
  if (cadence === 'weekly') return a * 52 / 12;
  if (cadence === 'biweekly') return a * 26 / 12;
  return a;
}
function isTransferCategory(t, categories) {
  const catId = t.category_id;
  if (catId === 'transfer' || catId === 'transfers') return true;
  const cat = categories.find(c => c.id === catId);
  return !!(cat && String(cat.group || '').toLowerCase() === 'transfers');
}

function computeRunway({ accounts = [], transactions = [], recurring = [], categories = [], today = new Date() } = {}) {
  const liquid = accounts
    .filter(a => LIQUID_TYPES.has(a.type))
    .reduce((s, a) => s + Math.max(0, parseFloat(a.balance) || 0), 0);

  const liquidAccountIds = new Set(accounts.filter(a => LIQUID_TYPES.has(a.type)).map(a => a.id));

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const cutoffDate = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() - WINDOW_DAYS);
  const cutoff = ymd(cutoffDate);
  const todayStr = ymd(startOfToday);

  const spend = transactions.filter(t =>
    t.amount < 0 &&
    String(t.date).slice(0, 10) >= cutoff && String(t.date).slice(0, 10) <= todayStr &&
    (!t.account_id || liquidAccountIds.has(t.account_id)) &&
    !isTransferCategory(t, categories)
  );
  const actualTotal = spend.reduce((s, t) => s + Math.abs(parseFloat(t.amount) || 0), 0);

  let historyDays = 0;
  if (spend.length) {
    const oldest = spend.reduce((m, t) => (String(t.date) < m ? String(t.date) : m), todayStr);
    const oldestDate = localDateFromStr(oldest);
    historyDays = Math.round((startOfToday - oldestDate) / 86400000) + 1;
  }

  const actualMonthly = spend.length ? actualTotal / Math.max(historyDays, 1) * 30 : 0;

  const recurringMonthly = recurring.filter(r => r.kind !== 'income').reduce((s, r) => s + perMonth(r.amount, r.cadence), 0);

  let monthlyBurn = 0; let burnSource = 'none'; let grade = 'C';
  if (actualMonthly >= recurringMonthly && actualMonthly > 0) {
    monthlyBurn = actualMonthly; burnSource = 'actual';
    grade = historyDays >= 90 ? 'A' : historyDays >= 14 ? 'B' : 'C';
  } else if (recurringMonthly > 0) {
    monthlyBurn = recurringMonthly; burnSource = 'recurring'; grade = 'B';
  }
  monthlyBurn = Math.round(monthlyBurn * 100) / 100;

  const byPayee = {};
  for (const t of spend) { const k = t.payee || 'Unknown'; byPayee[k] = (byPayee[k] || 0) + Math.abs(parseFloat(t.amount) || 0); }
  const top = Object.entries(byPayee).sort((a, b) => b[1] - a[1])[0];
  const largestOutflow = top ? { payee: top[0], amount: Math.round(top[1] * 100) / 100 } : null;

  if (monthlyBurn === 0 || (burnSource === 'actual' && grade === 'C')) {
    return { liquid, monthlyBurn, burnSource, months: null, daysLeft: null, dateMoneyRunsOut: null, band: 'unknown', largestOutflow, grade, historyDays };
  }
  const months = liquid / monthlyBurn;
  const daysLeft = Math.floor(liquid / (monthlyBurn / 30));
  const out = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() + daysLeft);
  const band = months >= 6 ? 'safe' : months >= 3 ? 'tight' : 'critical';
  return { liquid, monthlyBurn, burnSource, months: Math.round(months * 100) / 100, daysLeft, dateMoneyRunsOut: ymd(out), band, largestOutflow, grade, historyDays };
}

module.exports = { computeRunway };
