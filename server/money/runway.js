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
