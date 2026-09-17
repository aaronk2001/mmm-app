// Pure aggregation for the Cash Flow "Income vs Spending" chart. Posted
// transactions supply past/current months; recurring items supply projected
// occurrences from today (unlinked) or strictly after today (linked — their
// due dates already auto-posted). Dates are local-calendar.

const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function advance(d, cadence) {
  const nd = new Date(d);
  if (cadence === 'weekly') nd.setDate(nd.getDate() + 7);
  else if (cadence === 'biweekly') nd.setDate(nd.getDate() + 14);
  else nd.setMonth(nd.getMonth() + 1);
  return nd;
}

export function computeIncomeVsSpending({ transactions = [], recurring = [], today = new Date() }) {
  const byMonth = {};
  const addTo = (m, field, amt) => {
    if (!byMonth[m]) byMonth[m] = { month: m, income: 0, spending: 0 };
    byMonth[m][field] += amt;
  };

  for (const t of transactions) {
    const m = String(t.date).slice(0, 7);
    if (t.amount >= 0) addTo(m, 'income', t.amount);
    else addTo(m, 'spending', Math.abs(t.amount));
  }

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const horizon = new Date(today.getFullYear(), today.getMonth() + 6, 0); // last day of month+5
  for (const r of recurring) {
    if (!r.next_date) continue;
    const amt = Math.abs(parseFloat(r.amount) || 0);
    if (!amt) continue;
    const field = r.kind === 'income' ? 'income' : 'spending';
    const [y, mo, dd] = String(r.next_date).slice(0, 10).split('-').map(Number);
    let d = new Date(y, mo - 1, dd);
    let guard = 0;
    while (d < startOfToday && guard < 500) { d = advance(d, r.cadence); guard++; }
    if (r.account_id && d.getTime() === startOfToday.getTime()) d = advance(d, r.cadence);
    guard = 0;
    while (d <= horizon && guard < 500) { addTo(ym(d), field, amt); d = advance(d, r.cadence); guard++; }
  }

  const minMonth = ym(new Date(today.getFullYear(), today.getMonth() - 2, 1));
  const currentMonth = ym(today);
  const rows = Object.values(byMonth)
    .filter(r => r.month >= minMonth)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(r => ({ month: r.month, income: Math.round(r.income), spending: Math.round(r.spending), projected: r.month > currentMonth }));

  const income = rows.reduce((s, r) => s + r.income, 0);
  const spending = rows.reduce((s, r) => s + r.spending, 0);
  return { rows, totals: { income, spending, net: income - spending } };
}
