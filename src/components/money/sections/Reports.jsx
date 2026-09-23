import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Download } from 'lucide-react';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import SectionHeader from '../shared/SectionHeader';
import Card from '../shared/Card';
import EmptyState from '../shared/EmptyState';
import { useApi } from '../../../lib/query';
import { parseYmd, todayYmd } from '../../../lib/localDate';

const f$ = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();
const num = { fontVariantNumeric: 'tabular-nums' };

const REPORTS = [
  { id: 'spending', label: 'Spending by Category' },
  { id: 'income-expense', label: 'Income vs Expenses' },
  { id: 'networth', label: 'Net Worth' },
];
const RANGES = [
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'all', label: 'All time' },
];

function rangeStart(range) {
  const now = new Date();
  if (range === '30d') return new Date(now.getTime() - 30 * 86400000);
  if (range === '90d') return new Date(now.getTime() - 90 * 86400000);
  if (range === 'ytd') return new Date(now.getFullYear(), 0, 1);
  return new Date(0);
}

export default function Reports() {
  const navigate = useNavigate();
  const { data: txnRes, isLoading } = useApi('money/transactions');
  const { data: catRes } = useApi('money/categories');
  const { data: nwRes } = useApi('money/networth');

  const [reportType, setReportType] = useState('spending');
  const [range, setRange] = useState('90d');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const txns = txnRes?.transactions || [];
  const categories = catRes?.categories || [];
  const snapshots = nwRes?.snapshots || [];
  const catName = (id) => categories.find((c) => c.id === id)?.name || (id ? id : 'Uncategorized');

  let start, end;
  if (fromDate && toDate) {
    start = parseYmd(fromDate);
    end = parseYmd(toDate);
    end.setDate(end.getDate() + 1);
  } else {
    start = rangeStart(range);
    end = new Date(2099, 0, 1);
  }
  const inRange = txns.filter((t) => {
    const d = parseYmd(t.date);
    return d >= start && d < end;
  });

  // Spending by category
  const byCat = {};
  inRange.filter((t) => t.amount < 0).forEach((t) => {
    const id = t.category_id || 'uncategorized';
    byCat[id] = (byCat[id] || 0) + Math.abs(t.amount);
  });
  const spendingRows = Object.entries(byCat)
    .map(([id, total]) => ({ id, category: catName(id), total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);

  // Income vs expenses by month
  const byMonth = {};
  inRange.forEach((t) => {
    const m = String(t.date).slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { month: m, income: 0, expenses: 0 };
    if (t.amount >= 0) byMonth[m].income += t.amount;
    else byMonth[m].expenses += Math.abs(t.amount);
  });
  const ieRows = Object.values(byMonth)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((r) => ({ month: r.month, income: Math.round(r.income), expenses: Math.round(r.expenses), net: Math.round(r.income - r.expenses) }));

  // Net worth — respect BOTH ends of the range (matches the transaction filter).
  const nwRows = snapshots.filter((s) => { const d = parseYmd(s.date); return d >= start && d < end; })
    .map((s) => ({ date: s.date, net: s.net, assets: s.assets, liabilities: s.liabilities }));

  function exportCSV() {
    let headers, rows, name;
    if (reportType === 'spending') { headers = ['Category', 'Total']; rows = spendingRows.map((r) => [r.category, r.total]); name = 'spending'; }
    else if (reportType === 'income-expense') { headers = ['Month', 'Income', 'Expenses', 'Net']; rows = ieRows.map((r) => [r.month, r.income, r.expenses, r.net]); name = 'income-expenses'; }
    else { headers = ['Date', 'Net Worth', 'Assets', 'Liabilities']; rows = nwRows.map((r) => [r.date, r.net, r.assets, r.liabilities]); name = 'net-worth'; }
    const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
    const csv = [headers.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `mmm-${name}-${todayYmd()}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  const tip = { background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 8, fontSize: 12 };
  const hasData = reportType === 'spending' ? spendingRows.length : reportType === 'income-expense' ? ieRows.length : nwRows.length;

  if (isLoading) {
    return (
      <div>
        <SectionHeader icon={FileText} title="Reports" subtitle="Spending, income, and net-worth reports" />
        <Card><div style={{ textAlign: 'center', padding: 32, color: 'var(--m-muted)' }}>Loading…</div></Card>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader icon={FileText} title="Reports" subtitle="Spending, income, and net-worth reports" />

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {REPORTS.map((r) => (
            <button key={r.id} onClick={() => setReportType(r.id)} className={`m-btn m-btn-sm ${reportType === r.id ? 'm-btn-primary' : 'm-btn-secondary'}`}>{r.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="m-input" value={range} onChange={(e) => setRange(e.target.value)} style={{ fontSize: 13, padding: '6px 10px' }}>
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <input type="date" className="m-input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ fontSize: 13, padding: '6px 10px' }} />
          <input type="date" className="m-input" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ fontSize: 13, padding: '6px 10px' }} />
          {(fromDate || toDate) && <button className="m-btn m-btn-secondary m-btn-sm" onClick={() => { setFromDate(''); setToDate(''); }}>Clear</button>}
          <button className="m-btn m-btn-secondary m-btn-sm" onClick={exportCSV} disabled={!hasData}><Download size={14} style={{ marginRight: 6 }} /> CSV</button>
        </div>
      </div>

      {!hasData ? (
        <EmptyState icon={FileText} title="No data for this range" message="Try a wider date range, or add transactions to build your reports." />
      ) : (
        <>
          <Card className="m-card-no-hover" style={{ marginBottom: 16 }}>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                {reportType === 'spending' ? (
                  <BarChart data={spendingRows} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" vertical={false} />
                    <XAxis dataKey="category" tick={{ fontSize: 11, fill: 'var(--m-muted)' }} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--m-muted)' }} tickFormatter={f$} width={60} />
                    <Tooltip formatter={(v) => f$(v)} contentStyle={tip} cursor={{ fill: 'var(--m-surface-2)' }} />
                    <Bar dataKey="total" fill="var(--m-accent)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                ) : reportType === 'income-expense' ? (
                  <BarChart data={ieRows} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--m-muted)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--m-muted)' }} tickFormatter={f$} width={60} />
                    <Tooltip formatter={(v) => f$(v)} contentStyle={tip} cursor={{ fill: 'var(--m-surface-2)' }} />
                    <Bar dataKey="income" fill="var(--m-green)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenses" fill="var(--m-red)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                ) : (
                  <AreaChart data={nwRows} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                    <defs>
                      <linearGradient id="rNw" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--m-accent)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--m-accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--m-muted)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--m-muted)' }} tickFormatter={f$} width={60} domain={['dataMin', 'dataMax']} />
                    <Tooltip formatter={(v) => f$(v)} contentStyle={tip} />
                    <Area type="monotone" dataKey="net" stroke="var(--m-accent)" strokeWidth={2} fill="url(#rNw)" />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Table */}
          <Card className="m-card-sm" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--m-border)', textAlign: 'left' }}>
                  {(reportType === 'spending' ? ['Category', 'Total']
                    : reportType === 'income-expense' ? ['Month', 'Income', 'Expenses', 'Net']
                      : ['Date', 'Net Worth', 'Assets', 'Liabilities']).map((h, i) => (
                    <th key={i} style={{ padding: '10px 12px', color: 'var(--m-muted)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em', textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reportType === 'spending' && spendingRows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--m-border)' }}>
                    <td style={{ padding: '10px 12px', color: 'var(--m-ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {r.category}
                      <button
                        onClick={() => navigate(`/transactions?category=${encodeURIComponent(r.id)}`)}
                        style={{ background: 'none', border: 'none', color: 'var(--m-accent)', fontSize: 12, textDecoration: 'underline', padding: 0, cursor: 'pointer' }}
                      >
                        View transactions
                      </button>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink)', fontWeight: 600, ...num }}>{f$(r.total)}</td>
                  </tr>
                ))}
                {reportType === 'income-expense' && ieRows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--m-border)' }}>
                    <td style={{ padding: '10px 12px', color: 'var(--m-ink)' }}>{r.month}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-green)', ...num }}>{f$(r.income)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-red)', ...num }}>{f$(r.expenses)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: r.net >= 0 ? 'var(--m-green)' : 'var(--m-red)', ...num }}>{f$(r.net)}</td>
                  </tr>
                ))}
                {reportType === 'networth' && nwRows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--m-border)' }}>
                    <td style={{ padding: '10px 12px', color: 'var(--m-ink)', ...num }}>{r.date}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink)', fontWeight: 600, ...num }}>{f$(r.net)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink-2)', ...num }}>{f$(r.assets)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink-2)', ...num }}>{f$(r.liabilities)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
