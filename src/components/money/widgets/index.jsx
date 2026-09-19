import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet, TrendingUp, Zap, PiggyBank, Target, Landmark, Receipt,
  Calculator, Pencil, Check, X, PieChart as PieIcon, BarChart3, Sparkles, Hourglass, GraduationCap, ArrowRight,
} from 'lucide-react';
import InsightsWidget from './InsightsWidget';
import Grade from '../shared/Grade';
import { reduced } from '../shared/AnimatedNumber';
import { AreaChart, Area, ResponsiveContainer, Tooltip, YAxis, PieChart, Pie, Cell } from 'recharts';

const CHART_COLORS = ['var(--m-chart-1)', 'var(--m-chart-2)', 'var(--m-chart-3)', 'var(--m-chart-4)', 'var(--m-chart-5)', 'var(--m-chart-6)', 'var(--m-chart-7)', 'var(--m-chart-8)'];
import { useQuery } from '@tanstack/react-query';
import { useApi, fetchSettings, saveSettings, queryClient } from '../../../lib/query';
import { evalFormula } from '../../../lib/formula';

// ── formatting ───────────────────────────────────────────────────────────────
const f$ = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();
const fSigned = (n) => (Number(n) >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(Number(n) || 0)).toLocaleString();

// ── shared bits ──────────────────────────────────────────────────────────────
function Loading() {
  return <div style={{ color: 'var(--m-muted)', fontSize: 13, padding: '8px 0' }}>Loading…</div>;
}
function Empty({ children }) {
  return <div style={{ color: 'var(--m-muted)', fontSize: 13, padding: '8px 0' }}>{children}</div>;
}
function Bar({ pct, color }) {
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  return (
    <div style={{ height: 6, background: 'var(--m-surface-2)', borderRadius: 999, overflow: 'hidden' }}>
      <div style={{ width: p + '%', height: '100%', background: color || 'var(--m-accent)', borderRadius: 999 }} />
    </div>
  );
}
const num = { fontVariantNumeric: 'tabular-nums' };

// ── widgets ──────────────────────────────────────────────────────────────────
function NetWorth() {
  const { data, isLoading } = useApi('money/overview');
  if (isLoading) return <Loading />;
  return (
    <div>
      <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--m-ink)', ...num }}>{f$(data?.netWorth)}</div>
      <div style={{ display: 'flex', gap: 20, marginTop: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--m-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Assets</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--m-green)', ...num }}>{f$(data?.assets)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--m-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Liabilities</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--m-red)', ...num }}>{f$(data?.liabilities)}</div>
        </div>
      </div>
    </div>
  );
}

function NetWorthTrend({ config = {} }) {
  const tf = config.timeframe || '30d';
  const { data: overview, isLoading } = useApi('money/overview');
  const { data: nwData, isLoading: nwLoading } = useApi('money/networth', { enabled: tf !== '30d' });
  if (isLoading) return <Loading />;
  let snaps;
  if (tf === '30d') {
    snaps = overview?.snapshots || [];
  } else {
    if (nwLoading) return <Loading />;
    const all = nwData?.snapshots || [];
    snaps = tf === '90d' ? all.filter((s) => new Date(s.date) >= new Date(Date.now() - 90 * 86400000)) : all;
  }
  const pts = snaps.map((s) => ({ date: s.date, net: s.net }));
  if (pts.length < 2) return <Empty>Net-worth history builds up as your balances change over time.</Empty>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={pts} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--m-accent)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--m-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Tooltip
          formatter={(v) => f$(v)}
          contentStyle={{ background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: 'var(--m-muted)' }}
        />
        <Area type="monotone" dataKey="net" stroke="var(--m-accent)" strokeWidth={2} fill="url(#nwFill)" isAnimationActive={!reduced()} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function CashFlow() {
  const { data, isLoading } = useApi('money/cashflow');
  if (isLoading) return <Loading />;
  const s = data?.summary || {};
  const up = (Number(s.netChange) || 0) >= 0;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Row label="90-day projected end" value={f$(s.endBalance)} />
      <Row label="Net change" value={fSigned(s.netChange)} color={up ? 'var(--m-green)' : 'var(--m-red)'} />
      <Row label="Lowest balance" value={f$(s.lowestBalance)} sub={s.lowestDate} />
    </div>
  );
}
function Row({ label, value, color, sub }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>{label}{sub ? <span style={{ color: 'var(--m-muted)', marginLeft: 6, fontSize: 11 }}>{sub}</span> : null}</span>
      <span style={{ fontSize: 15, fontWeight: 600, color: color || 'var(--m-ink)', ...num }}>{value}</span>
    </div>
  );
}

function Budgets({ config = {} }) {
  const { data, isLoading } = useApi('money/overview');
  const { data: cats } = useApi('money/categories');
  if (isLoading) return <Loading />;
  const catName = (id) => (cats?.categories || []).find((c) => c.id === id)?.name || id;
  let items = data?.budgetStatus || [];
  if (config.categories?.length) items = items.filter((b) => config.categories.includes(b.category_id));
  items = items.slice(0, config.count ?? 4);
  if (!items.length) return <Empty>No budgets yet. Add some in the Budget section.</Empty>;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {items.map((b) => (
        <div key={b.budget_id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
            <span style={{ color: 'var(--m-ink-2)' }}>{catName(b.category_id)}</span>
            <span style={{ color: 'var(--m-muted)', ...num }}>{f$(b.spent)} / {f$(b.limit)}</span>
          </div>
          <Bar pct={b.pct} color={b.pct > 100 ? 'var(--m-red)' : b.pct > 80 ? 'var(--m-amber)' : 'var(--m-green)'} />
        </div>
      ))}
    </div>
  );
}

function Goals({ config = {} }) {
  const { data, isLoading } = useApi('money/goals');
  if (isLoading) return <Loading />;
  const items = (data?.goals || []).slice(0, config.count ?? 4);
  if (!items.length) return <Empty>No goals yet. Set targets in the Goals section.</Empty>;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {items.map((g) => {
        const pct = g.target ? (g.current / g.target) * 100 : 0;
        return (
          <div key={g.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: 'var(--m-ink-2)' }}>{g.name}</span>
              <span style={{ color: 'var(--m-muted)', ...num }}>{f$(g.current)} / {f$(g.target)}</span>
            </div>
            <Bar pct={pct} />
          </div>
        );
      })}
    </div>
  );
}

function Accounts({ config = {} }) {
  const { data, isLoading } = useApi('money/accounts');
  if (isLoading) return <Loading />;
  let items = data?.accounts || [];
  if (config.accounts?.length) items = items.filter((a) => config.accounts.includes(a.id));
  items = items.slice(0, config.count ?? 6);
  if (!items.length) return <Empty>No accounts yet.</Empty>;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {items.map((a) => (
        <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 13, color: 'var(--m-ink)' }}>{a.name}</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: a.type === 'loan' || a.type === 'credit' ? 'var(--m-red)' : 'var(--m-ink)', ...num }}>{f$(a.balance)}</span>
        </div>
      ))}
    </div>
  );
}

function RecentTransactions({ config = {} }) {
  const { data, isLoading } = useApi('money/transactions');
  if (isLoading) return <Loading />;
  let items = data?.transactions || [];
  if (config.categories?.length) items = items.filter((t) => config.categories.includes(t.category_id));
  if (config.accounts?.length) items = items.filter((t) => config.accounts.includes(t.account_id));
  items = items.slice(0, config.count ?? 6);
  if (!items.length) return <Empty>No transactions yet.</Empty>;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {items.map((t) => (
        <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--m-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.payee || '—'}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: t.amount >= 0 ? 'var(--m-green)' : 'var(--m-ink)', ...num, flexShrink: 0 }}>{fSigned(t.amount)}</span>
        </div>
      ))}
    </div>
  );
}

// Custom-metric widget: user-defined formula over the named financial variables.
const CM_DEFAULT = { label: 'Savings Rate', formula: 'savings_rate * 100', format: 'percent' };

function fmtMetric(value, format) {
  if (value == null) return '—';
  if (format === 'currency') return f$(value);
  if (format === 'percent') return (Math.round(value * 10) / 10).toLocaleString() + '%';
  return (Math.round(value * 100) / 100).toLocaleString();
}

function CustomMetric() {
  const { data: metricsRes } = useApi('money/metrics');
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const metrics = metricsRes?.metrics || {};
  const cfg = settings?.customMetric || CM_DEFAULT;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cfg);

  const { value, error } = evalFormula(editing ? draft.formula : cfg.formula, metrics);

  function startEdit() { setDraft(settings?.customMetric || CM_DEFAULT); setEditing(true); }
  function save() {
    const next = { label: draft.label || 'Metric', formula: draft.formula || '', format: draft.format || 'number' };
    saveSettings({ customMetric: next }).then((s) => queryClient.setQueryData(['settings'], s)).catch(() => {});
    setEditing(false);
  }
  function insertVar(name) {
    setDraft((d) => ({ ...d, formula: (d.formula ? d.formula + ' ' : '') + name }));
  }

  if (editing) {
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        <input className="m-input m-no-drag" value={draft.label} placeholder="Label"
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} />
        <input className="m-input m-no-drag" value={draft.formula} placeholder="e.g. savings_rate * 100"
          style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
          onChange={(e) => setDraft((d) => ({ ...d, formula: e.target.value }))} />
        <div style={{ display: 'flex', gap: 4 }}>
          {['currency', 'percent', 'number'].map((ff) => (
            <button key={ff} className="m-no-drag" onClick={() => setDraft((d) => ({ ...d, format: ff }))}
              style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--m-border)',
                background: draft.format === ff ? 'var(--m-accent)' : 'var(--m-surface-2)',
                color: draft.format === ff ? '#fff' : 'var(--m-ink-2)' }}>{ff}</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: error ? 'var(--m-red)' : 'var(--m-green)', minHeight: 14, ...num }}>
          {error ? error : (value != null ? 'Preview: ' + fmtMetric(value, draft.format) : ' ')}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 64, overflow: 'auto' }}>
          {Object.keys(metrics).map((k) => (
            <button key={k} className="m-no-drag" onClick={() => insertVar(k)} title={'= ' + metrics[k]}
              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, cursor: 'pointer',
                border: '1px solid var(--m-border)', background: 'var(--m-surface-2)', color: 'var(--m-ink-2)', ...num }}>{k}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="m-btn m-btn-primary m-btn-sm m-no-drag" onClick={save}><Check size={13} style={{ marginRight: 4 }} />Save</button>
          <button className="m-btn m-btn-ghost m-btn-sm m-no-drag" onClick={() => setEditing(false)}><X size={13} style={{ marginRight: 4 }} />Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 12, color: 'var(--m-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{cfg.label}</div>
        <button type="button" className="m-no-drag" onClick={startEdit} title="Edit formula" aria-label="Edit formula"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--m-muted)', display: 'flex', padding: 2 }}><Pencil size={13} /></button>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: error ? 'var(--m-red)' : 'var(--m-ink)', marginTop: 6, ...num }}>
        {error ? 'error' : fmtMetric(value, cfg.format)}
      </div>
      <div style={{ fontSize: 11, color: 'var(--m-muted)', marginTop: 'auto', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {error ? error : cfg.formula}
      </div>
    </div>
  );
}

// Spending-by-category donut for the current month (from /overview).
function SpendingDonut() {
  const { data, isLoading } = useApi('money/overview');
  if (isLoading) return <Loading />;
  const cats = (data?.topCategoriesThisMonth || []).filter((c) => c.spent > 0);
  if (!cats.length) return <Empty>No spending categorized yet this month.</Empty>;
  const total = cats.reduce((s, c) => s + c.spent, 0);
  return (
    <div style={{ height: '100%', display: 'flex', gap: 8, alignItems: 'center' }}>
      <div style={{ position: 'relative', width: 116, height: 116, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={cats} dataKey="spent" nameKey="category" cx="50%" cy="50%" innerRadius={38} outerRadius={56} paddingAngle={2} stroke="none" isAnimationActive={!reduced()}>
              {cats.map((c, i) => <Cell key={c.category} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 8, color: 'var(--m-ink)' }} formatter={(v) => f$(v)} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 10, color: 'var(--m-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Spent</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--m-ink)', ...num }}>{f$(total)}</div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 5 }}>
        {cats.slice(0, 5).map((c, i) => (
          <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
            <span style={{ color: 'var(--m-ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{c.category}</span>
            <span style={{ color: 'var(--m-ink)', fontWeight: 600, ...num, flexShrink: 0 }}>{f$(c.spent)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Income vs. expenses (monthly averages, from /metrics).
function IncomeExpense() {
  const { data, isLoading } = useApi('money/metrics');
  if (isLoading) return <Loading />;
  const m = data?.metrics || {};
  const income = m.monthly_income || 0;
  const expenses = m.monthly_expenses || 0;
  const surplus = income - expenses;
  const max = Math.max(income, expenses, 1);
  const Row = ({ label, value, color }) => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: 'var(--m-ink-2)' }}>{label}</span>
        <span style={{ color: 'var(--m-ink)', fontWeight: 600, ...num }}>{f$(value)}</span>
      </div>
      <Bar pct={(value / max) * 100} color={color} />
    </div>
  );
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Row label="Income / mo" value={income} color="var(--m-green)" />
      <Row label="Expenses / mo" value={expenses} color="var(--m-red)" />
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--m-border)', paddingTop: 8, fontSize: 13 }}>
        <span style={{ color: 'var(--m-muted)' }}>{surplus >= 0 ? 'Surplus' : 'Shortfall'}</span>
        <span style={{ fontWeight: 700, color: surplus >= 0 ? 'var(--m-green)' : 'var(--m-red)', ...num }}>{fSigned(surplus)}</span>
      </div>
    </div>
  );
}

function Runway() {
  const { data, isLoading } = useApi('money/runway');
  if (isLoading) return <Loading />;
  if (!data || data.band === 'unknown') return <Empty>Add a few expenses or recurring bills and your runway appears here.</Empty>;
  const color = data.band === 'safe' ? 'var(--m-green)' : data.band === 'tight' ? 'var(--m-amber, #f59e0b)' : 'var(--m-red)';
  const dateLabel = new Date(...String(data.dateMoneyRunsOut).split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v)))).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 30, fontWeight: 700, color, ...num }}>{data.months.toFixed(1)} mo</div>
        <Grade grade={data.grade} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--m-ink-2)', marginTop: 4 }}>
        Cash lasts until <strong style={{ color: 'var(--m-ink)' }}>{dateLabel}</strong> at {f$(data.monthlyBurn)}/mo
      </div>
      <div style={{ marginTop: 10 }}><Bar pct={Math.min(100, (data.months / 6) * 100)} color={color} /></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--m-muted)', marginTop: 4 }}>
        <span>{f$(data.liquid)} liquid</span>
        <span>{data.largestOutflow ? `Biggest: ${data.largestOutflow.payee}` : ''}</span>
      </div>
    </div>
  );
}

// Picks the lesson to resume/start: an in-progress one first (so the widget
// never abandons a half-finished lesson), else the first not-started lesson
// in module order. `null` means every lesson is done — a genuinely positive
// state, not an error.
function pickTodaysLesson(lessons) {
  return lessons.find((l) => l.status === 'in_progress') || lessons.find((l) => l.status === 'not_started') || null;
}

function TodaysLesson() {
  const { data, isLoading } = useApi('learn/lessons');
  const { data: due } = useApi('learn/review/session');
  if (isLoading) return <Loading />;
  const lessons = data?.lessons || [];
  const lesson = pickTodaysLesson(lessons);
  const dueCount = due?.cards?.length || 0;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {lesson ? (
        <Link to={`/learn/lesson/${lesson.id}`} className="m-no-drag" style={{ textDecoration: 'none', display: 'block' }}>
          <div style={{ fontSize: 11, color: 'var(--m-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {lesson.status === 'in_progress' ? 'Continue' : "Today's lesson"}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--m-ink)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
            {lesson.title}
            <ArrowRight size={15} style={{ color: 'var(--m-accent)', flexShrink: 0 }} aria-hidden="true" />
          </div>
          <div style={{ fontSize: 12, color: 'var(--m-ink-2)', marginTop: 4 }}>{lesson.est_minutes} min</div>
        </Link>
      ) : (
        <Empty>You've worked through every lesson — nice going.</Empty>
      )}
      <Link to="/learn/review" className="m-no-drag" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderTop: '1px solid var(--m-border)', paddingTop: 10, fontSize: 12 }}>
        <span style={{ color: 'var(--m-ink-2)' }}>Spaced review</span>
        <span style={{ color: dueCount > 0 ? 'var(--m-accent)' : 'var(--m-muted)', fontWeight: 600, ...num }}>
          {dueCount > 0 ? `${dueCount} due` : 'All caught up'}
        </span>
      </Link>
    </div>
  );
}

// ── registry ─────────────────────────────────────────────────────────────────
// defaultLayout uses a 12-col grid; rowHeight ~80px. `scroll` => content area
// gets its own overflow; chart widgets fill height instead.
export const WIDGETS = {
  runway:             { title: 'Runway',              icon: Hourglass,     layout: { w: 4, h: 2, minW: 3, minH: 2 }, Component: Runway },
  insights:           { title: 'Coach Insights',      icon: Sparkles,      layout: { w: 8, h: 6, minW: 4, minH: 4 }, Component: InsightsWidget, scroll: true },
  netWorth:           { title: 'Net Worth',           icon: Wallet,        layout: { w: 4, h: 2, minW: 3, minH: 2 }, Component: NetWorth },
  netWorthTrend:      { title: 'Net Worth Trend',      icon: TrendingUp,    layout: { w: 8, h: 4, minW: 4, minH: 3 }, Component: NetWorthTrend, fill: true },
  cashFlow:           { title: 'Cash Flow',            icon: Zap,           layout: { w: 4, h: 3, minW: 3, minH: 2 }, Component: CashFlow },
  budgets:            { title: 'Budgets',              icon: PiggyBank,     layout: { w: 4, h: 4, minW: 3, minH: 3 }, Component: Budgets, scroll: true },
  goals:              { title: 'Goals',                icon: Target,        layout: { w: 4, h: 4, minW: 3, minH: 3 }, Component: Goals, scroll: true },
  accounts:           { title: 'Accounts',             icon: Landmark,      layout: { w: 4, h: 4, minW: 3, minH: 3 }, Component: Accounts, scroll: true },
  recentTransactions: { title: 'Recent Transactions',  icon: Receipt,       layout: { w: 4, h: 5, minW: 3, minH: 3 }, Component: RecentTransactions, scroll: true },
  spendingDonut:      { title: 'Spending by Category',  icon: PieIcon,       layout: { w: 4, h: 3, minW: 3, minH: 3 }, Component: SpendingDonut },
  incomeExpense:      { title: 'Income vs. Expenses',   icon: BarChart3,     layout: { w: 4, h: 3, minW: 3, minH: 2 }, Component: IncomeExpense },
  customMetric:       { title: 'Custom Metric',        icon: Calculator,    layout: { w: 4, h: 3, minW: 3, minH: 3 }, Component: CustomMetric, scroll: true },
  todaysLesson:       { title: "Today's Lesson",       icon: GraduationCap, layout: { w: 4, h: 3, minW: 3, minH: 3 }, Component: TodaysLesson },
};

// Dashboard presets — quick layouts users can apply from the Overview toolbar.
export const PRESETS = {
  'Quick glance': [
    { i: 'insights',           x: 0, y: 0, w: 8, h: 6 },
    { i: 'runway',             x: 8, y: 0, w: 4, h: 2 },
    { i: 'netWorth',           x: 8, y: 2, w: 4, h: 2 },
    { i: 'cashFlow',           x: 8, y: 4, w: 4, h: 2 },
    { i: 'spendingDonut',      x: 8, y: 6, w: 4, h: 3 },
    { i: 'netWorthTrend',      x: 0, y: 6, w: 8, h: 4 },
  ],
  'Deep dive': [
    { i: 'insights',           x: 0, y: 0, w: 8, h: 6 },
    { i: 'runway',             x: 8, y: 0, w: 4, h: 2 },
    { i: 'netWorth',           x: 8, y: 2, w: 4, h: 2 },
    { i: 'cashFlow',           x: 8, y: 4, w: 4, h: 2 },
    { i: 'spendingDonut',      x: 8, y: 6, w: 4, h: 3 },
    { i: 'netWorthTrend',      x: 0, y: 6, w: 8, h: 4 },
    { i: 'incomeExpense',      x: 8, y: 9, w: 4, h: 3 },
    { i: 'budgets',            x: 0, y: 10, w: 4, h: 4 },
    { i: 'goals',              x: 4, y: 10, w: 4, h: 4 },
    { i: 'accounts',           x: 8, y: 12, w: 4, h: 4 },
    { i: 'recentTransactions', x: 0, y: 14, w: 6, h: 5 },
  ],
};

// Default dashboard: which widgets + where (12-col grid).
export const DEFAULT_LAYOUT = [
  { i: 'insights',           x: 0, y: 0, w: 8, h: 6 },
  { i: 'runway',             x: 8, y: 0, w: 4, h: 2 },
  { i: 'netWorth',           x: 8, y: 2, w: 4, h: 2 },
  { i: 'cashFlow',           x: 8, y: 4, w: 4, h: 2 },
  { i: 'accounts',           x: 8, y: 6, w: 4, h: 4 },
  { i: 'netWorthTrend',      x: 0, y: 6, w: 8, h: 4 },
  { i: 'budgets',            x: 0, y: 10, w: 4, h: 4 },
  { i: 'goals',              x: 4, y: 10, w: 4, h: 4 },
  { i: 'recentTransactions', x: 8, y: 10, w: 4, h: 5 },
  { i: 'todaysLesson',       x: 0, y: 15, w: 4, h: 3 },
];
