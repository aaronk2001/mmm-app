import { useState, useEffect } from 'react';
import {
  ResponsiveContainer, ComposedChart, LineChart, AreaChart, BarChart,
  Line, Area, Bar, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';
import { Play, Table2, LineChart as LineChartIcon, Upload } from 'lucide-react';
import Card from '../../../shared/Card';
import MetricCard from '../../../shared/MetricCard';
import Grade from '../../../shared/Grade';
import ErrorState from '../../../shared/ErrorState';
import EmptyState from '../../../shared/EmptyState';
import { api } from '../../../../../lib/query';
import { toast } from '../../../../../lib/toast';

// Dates in every payload here are local 'YYYY-MM-DD' strings straight from
// engine.js/repo.js — never fed through `new Date(...)`, which silently
// reinterprets a bare date string in UTC and can shift the displayed day.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (ymd) => { const [, m, d] = String(ymd).split('-'); return `${MONTHS[Number(m) - 1]} ${Number(d)}`; };
const num = { fontVariantNumeric: 'tabular-nums' };
const PALETTE = ['var(--m-chart-1)', 'var(--m-chart-2)', 'var(--m-chart-3)', 'var(--m-chart-4)', 'var(--m-chart-5)', 'var(--m-chart-6)', 'var(--m-chart-7)', 'var(--m-chart-8)'];
const f$ = (cents) => (cents == null ? '—' : '$' + Math.round(cents / 100).toLocaleString());
// Whole-dollar rounding hides small-but-real cost figures (M6): $12.50 of
// commission rendered as "$13" on the cost waterfall. Cost figures always
// use two decimals.
const f$2 = (cents) => (cents == null ? '—' : '$' + (cents / 100).toFixed(2));
const fPct = (v, digits = 2) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`);
const signColor = (v) => (v == null ? 'var(--m-ink-2)' : v >= 0 ? 'var(--m-green)' : 'var(--m-red)');

const STRATEGY_KINDS = [
  { value: 'buyAndHold', label: 'Buy & Hold' },
  { value: 'dca', label: 'Dollar-Cost Average' },
  { value: 'fixedWeightRebalance', label: 'Fixed-Weight Rebalance' },
  { value: 'smaCross', label: 'SMA Crossover' },
  { value: 'emaCross', label: 'EMA Crossover' },
];

const tooltipStyle = { background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 8, fontSize: 12, color: 'var(--m-ink)' };

// ────────────────────────────────────────────────────────────────────────────
// Accessibility rule: every chart ships with a table fallback behind a
// toggle — never color/canvas-only.
// ────────────────────────────────────────────────────────────────────────────
function ChartCard({ title, chart, table, height = 260 }) {
  const [view, setView] = useState('chart');
  return (
    <Card hoverable={false} style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)' }}>{title}</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className={view === 'chart' ? 'm-btn m-btn-primary m-btn-sm' : 'm-btn m-btn-secondary m-btn-sm'}
            onClick={() => setView('chart')} aria-pressed={view === 'chart'} title="Chart view"
          ><LineChartIcon size={13} style={{ marginRight: 4 }} />Chart</button>
          <button
            className={view === 'table' ? 'm-btn m-btn-primary m-btn-sm' : 'm-btn m-btn-secondary m-btn-sm'}
            onClick={() => setView('table')} aria-pressed={view === 'table'} title="Table view"
          ><Table2 size={13} style={{ marginRight: 4 }} />Table</button>
        </div>
      </div>
      {view === 'chart' ? <div style={{ width: '100%', height }}>{chart}</div> : <div style={{ maxHeight: height, overflow: 'auto' }}>{table}</div>}
    </Card>
  );
}

function DataTable({ columns, rows }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: '2px solid var(--m-border)' }}>
          {columns.map((c) => (
            <th key={c.key} style={{ padding: '6px 10px', color: 'var(--m-muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', textAlign: c.align || 'left' }}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderBottom: '1px solid var(--m-border)' }}>
            {columns.map((c) => (
              <td key={c.key} style={{ padding: '6px 10px', textAlign: c.align || 'left', color: c.strong ? 'var(--m-ink)' : 'var(--m-ink-2)', fontWeight: c.strong ? 600 : 400, ...num }}>
                {c.render ? c.render(r) : r[c.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Derived series — all pure functions of the run's own equityCurve/trades so
// re-rendering never re-runs the backtest.
// ────────────────────────────────────────────────────────────────────────────
function computeDrawdown(equityCurve) {
  let peak = -Infinity;
  return equityCurve.map((p) => {
    peak = Math.max(peak, p.equity_cents);
    return { date: p.date, ddPct: peak > 0 ? (p.equity_cents / peak - 1) * 100 : 0 };
  });
}

function computeMonthlyReturns(equityCurve) {
  const byMonth = new Map(); // 'YYYY-MM' -> {first, last}
  for (const p of equityCurve) {
    const key = p.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, { first: p.equity_cents, last: p.equity_cents });
    byMonth.get(key).last = p.equity_cents;
  }
  // Each month's return is measured off the PRIOR month's last close, not
  // its own first bar — otherwise gap-ups/downs between the last bar of one
  // month and the first bar of the next (e.g. a weekend, or simply the
  // bar-to-bar move itself) vanish from every month, and the per-month
  // returns stop compounding to the actual total. The very first month has
  // no prior bucket, so it keeps its own first point as its base.
  const entries = [...byMonth.entries()];
  let prevLast = null;
  return entries.map(([key, { first, last }], i) => {
    const base = i === 0 ? first : prevLast;
    const retPct = base > 0 ? (last / base - 1) * 100 : null;
    prevLast = last;
    return { key, year: key.slice(0, 4), month: Number(key.slice(5, 7)), retPct };
  });
}

function computeRollingSharpe(equityCurve, window = 21) {
  const rets = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity_cents, cur = equityCurve[i].equity_cents;
    rets.push(prev > 0 ? cur / prev - 1 : 0);
  }
  const out = [];
  for (let i = window; i <= rets.length; i++) {
    const slice = rets.slice(i - window, i);
    const mean = slice.reduce((s, r) => s + r, 0) / slice.length;
    const variance = slice.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, slice.length - 1);
    const sd = Math.sqrt(variance);
    out.push({ date: equityCurve[i].date, sharpe: sd > 0 ? (mean / sd) * Math.sqrt(252) : null });
  }
  return out;
}

// Replays trades chronologically against a per-symbol close-price map to
// build a weight-over-time series (cash = whatever equity isn't in a
// position). Best-effort: symbols with no fetched bars just don't appear.
function computeAllocationOverTime(equityCurve, trades, closesBySymbol, symbols) {
  const qty = Object.fromEntries(symbols.map((s) => [s, 0]));
  const tradesByDate = new Map();
  for (const t of trades) {
    if (!tradesByDate.has(t.date)) tradesByDate.set(t.date, []);
    tradesByDate.get(t.date).push(t);
  }
  return equityCurve.map((p) => {
    for (const t of tradesByDate.get(p.date) || []) {
      qty[t.symbol] = (qty[t.symbol] || 0) + (t.side === 'buy' ? t.qty : -t.qty);
    }
    const row = { date: p.date };
    let invested = 0;
    for (const s of symbols) {
      const close = closesBySymbol[s]?.get(p.date);
      const valueCents = close != null ? qty[s] * close * 100 : 0;
      row[s] = p.equity_cents > 0 ? Math.max(0, (valueCents / p.equity_cents) * 100) : 0;
      invested += row[s];
    }
    row.Cash = Math.max(0, 100 - invested);
    return row;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Run configuration form
// ────────────────────────────────────────────────────────────────────────────
function RunForm({ onResult }) {
  const [symbols, setSymbols] = useState('AAPL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState('buyAndHold');
  const [strategySymbol, setStrategySymbol] = useState('AAPL');
  const [fastPeriod, setFastPeriod] = useState('20');
  const [slowPeriod, setSlowPeriod] = useState('50');
  const [amountCents, setAmountCents] = useState('50000');
  const [everyNBars, setEveryNBars] = useState('21');
  const [initialCash, setInitialCash] = useState('100000');
  const [slippageBps, setSlippageBps] = useState('10');
  const [commissionCents, setCommissionCents] = useState('100');
  const [benchmarkSymbol, setBenchmarkSymbol] = useState('SPY');
  const [csvSymbol, setCsvSymbol] = useState('AAPL');
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState(null);

  function buildStrategySpec() {
    switch (kind) {
      case 'buyAndHold': return { kind, params: { symbol: strategySymbol.trim().toUpperCase() } };
      case 'dca': return { kind, params: { symbol: strategySymbol.trim().toUpperCase(), amountCents: Number(amountCents), everyNBars: Number(everyNBars) } };
      case 'fixedWeightRebalance': {
        const list = symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
        const w = 1 / Math.max(1, list.length);
        return { kind, params: { weights: Object.fromEntries(list.map((s) => [s, w])), everyNBars: Number(everyNBars) } };
      }
      case 'smaCross':
      case 'emaCross':
        return { kind, params: { symbol: strategySymbol.trim().toUpperCase(), fastPeriod: Number(fastPeriod), slowPeriod: Number(slowPeriod) } };
      default: return { kind, params: {} };
    }
  }

  async function uploadCsv(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadBusy(true); setError(null);
    try {
      const csv = await file.text();
      const result = await api('backtest/bars/csv', { method: 'POST', body: JSON.stringify({ symbol: csvSymbol.trim().toUpperCase(), csv }) });
      toast.success(`Loaded ${result.count} bars for ${result.symbol} (offline CSV).`);
    } catch (err) { setError(err.message); }
    finally { setUploadBusy(false); e.target.value = ''; }
  }

  async function run() {
    setBusy(true); setError(null);
    try {
      const list = symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      const body = {
        symbols: list,
        from: from || undefined,
        to: to || undefined,
        strategy: buildStrategySpec(),
        initialCashCents: Math.round(Number(initialCash) * 100),
        slippageBps: Number(slippageBps),
        commissionCents: Math.round(Number(commissionCents)),
        benchmarkSymbol: benchmarkSymbol.trim() ? benchmarkSymbol.trim().toUpperCase() : undefined,
      };
      const res = await api('backtest/run', { method: 'POST', body: JSON.stringify(body) });
      onResult(res, body);
      if (res.outcome === 'completed') toast.success(res.reused ? 'Matched a prior run with this exact config.' : 'Backtest complete.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--m-ink)', marginBottom: 12 }}>Configure backtest</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 14 }}>
        <div>
          <label className="m-input-label">Symbols (comma-separated)</label>
          <input className="m-input" value={symbols} onChange={(e) => setSymbols(e.target.value)} placeholder="AAPL, SPY" />
        </div>
        <div>
          <label className="m-input-label">From (optional)</label>
          <input className="m-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="m-input-label">To (optional)</label>
          <input className="m-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label className="m-input-label">Benchmark symbol (optional)</label>
          <input className="m-input" value={benchmarkSymbol} onChange={(e) => setBenchmarkSymbol(e.target.value)} placeholder="SPY" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 14 }}>
        <div>
          <label className="m-input-label">Strategy</label>
          <select className="m-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {STRATEGY_KINDS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        {kind !== 'fixedWeightRebalance' && (
          <div>
            <label className="m-input-label">Strategy symbol</label>
            <input className="m-input" value={strategySymbol} onChange={(e) => setStrategySymbol(e.target.value)} />
          </div>
        )}
        {(kind === 'smaCross' || kind === 'emaCross') && (
          <>
            <div><label className="m-input-label">Fast period</label><input className="m-input" type="number" min="1" value={fastPeriod} onChange={(e) => setFastPeriod(e.target.value)} /></div>
            <div><label className="m-input-label">Slow period</label><input className="m-input" type="number" min="2" value={slowPeriod} onChange={(e) => setSlowPeriod(e.target.value)} /></div>
          </>
        )}
        {kind === 'dca' && (
          <div><label className="m-input-label">Buy amount ($)</label><input className="m-input" type="number" min="0" value={Number(amountCents) / 100} onChange={(e) => setAmountCents(String(Math.round(Number(e.target.value) * 100)))} /></div>
        )}
        {(kind === 'dca' || kind === 'fixedWeightRebalance') && (
          <div><label className="m-input-label">Every N bars</label><input className="m-input" type="number" min="1" value={everyNBars} onChange={(e) => setEveryNBars(e.target.value)} /></div>
        )}
        <div><label className="m-input-label">Initial cash ($)</label><input className="m-input" type="number" min="0" value={initialCash} onChange={(e) => setInitialCash(e.target.value)} /></div>
        <div><label className="m-input-label">Slippage (bps)</label><input className="m-input" type="number" min="0" value={slippageBps} onChange={(e) => setSlippageBps(e.target.value)} /></div>
        <div><label className="m-input-label">Commission ($/trade)</label><input className="m-input" type="number" min="0" value={Number(commissionCents) / 100} onChange={(e) => setCommissionCents(String(Math.round(Number(e.target.value) * 100)))} /></div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', paddingTop: 12, borderTop: '1px solid var(--m-border)' }}>
        <div>
          <label className="m-input-label">Offline CSV upload — symbol</label>
          <input className="m-input" style={{ width: 120 }} value={csvSymbol} onChange={(e) => setCsvSymbol(e.target.value)} />
        </div>
        <label className="m-btn m-btn-secondary m-btn-sm" style={{ cursor: 'default' }}>
          <Upload size={13} style={{ marginRight: 4 }} />{uploadBusy ? 'Loading…' : 'Upload CSV (date,open,high,low,close[,volume])'}
          <input type="file" accept=".csv,text/csv" onChange={uploadCsv} style={{ display: 'none' }} disabled={uploadBusy} />
        </label>
        <button className="m-btn m-btn-primary" onClick={run} disabled={busy} style={{ marginLeft: 'auto' }}>
          <Play size={14} style={{ marginRight: 6 }} />{busy ? 'Running…' : 'Run backtest'}
        </button>
      </div>

      {error && <div style={{ color: 'var(--m-red)', fontSize: 13, marginTop: 10 }}>{error}</div>}
      <div style={{ color: 'var(--m-muted)', fontSize: 11, marginTop: 10 }}>
        Works fully offline on CSV bars — no API key required. Bars can also be synced from Yahoo (opt-in) in Settings → Online &amp; Keys, then re-run.
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Results
// ────────────────────────────────────────────────────────────────────────────
function Results({ run, config }) {
  const { result, metrics } = run;
  const [benchmarkCurve, setBenchmarkCurve] = useState(null);
  const [primaryBars, setPrimaryBars] = useState(null);
  const [supportError, setSupportError] = useState(null);

  const primarySymbol = config.symbols[0];

  // Best-effort supplementary fetches for the equity-vs-benchmark and
  // trade-marker charts — a failure here degrades those two charts to their
  // no-benchmark / no-price-context form, it never blocks the run itself.
  // This must be a useEffect (not a render-phase useState initializer): under
  // React.StrictMode the initializer double-fires, and — worse — a second
  // backtest run that reuses the mounted Results component would never
  // re-run it at all, plotting the new run's equity/trades against the
  // PREVIOUS run's benchmark/price data. Keying <Results> on the run id
  // (see Backtest below) forces a remount on every new run; this effect's
  // own dependency array covers the same inputs so a config-only change
  // (no new run) still refetches correctly.
  useEffect(() => {
    let cancelled = false;
    setBenchmarkCurve(null);
    setPrimaryBars(null);
    setSupportError(null);
    (async () => {
      try {
        if (config.benchmarkSymbol) {
          const rows = await api(`backtest/bars/${encodeURIComponent(config.benchmarkSymbol)}${config.from ? `?from=${config.from}` : ''}`);
          if (!cancelled) setBenchmarkCurve(rows);
        }
        const rows = await api(`backtest/bars/${encodeURIComponent(primarySymbol)}${config.from ? `?from=${config.from}` : ''}`);
        if (!cancelled) setPrimaryBars(rows);
      } catch (err) { if (!cancelled) setSupportError(err.message); }
    })();
    return () => { cancelled = true; };
  }, [config.benchmarkSymbol, primarySymbol, config.from]);

  const equityCurve = result.equityCurve;
  const drawdown = computeDrawdown(equityCurve);
  const monthly = computeMonthlyReturns(equityCurve);
  const rollingSharpe = computeRollingSharpe(equityCurve);

  const closesBySymbol = {};
  if (primaryBars) closesBySymbol[primarySymbol] = new Map(primaryBars.map((b) => [b.date, b.close]));
  const allocation = computeAllocationOverTime(equityCurve, result.trades, closesBySymbol, [primarySymbol]);

  let equityVsBenchmark = equityCurve.map((p) => ({ date: p.date, equity: p.equity_cents / 100 }));
  if (benchmarkCurve?.length) {
    const basePrice = benchmarkCurve[0].close;
    const byDate = new Map(benchmarkCurve.map((b) => [b.date, b.close]));
    equityVsBenchmark = equityVsBenchmark.map((row) => {
      const close = byDate.get(row.date);
      const benchDollars = close != null && basePrice ? (close / basePrice) * (equityCurve[0].equity_cents / 100) : null;
      return { ...row, benchmark: benchDollars };
    });
  }

  const priceByDate = primaryBars ? new Map(primaryBars.map((b) => [b.date, b.close])) : new Map();
  const tradeMarkers = result.trades.map((t) => ({
    date: t.date, price: t.priceCents / 100, side: t.side, symbol: t.symbol,
    contextPrice: priceByDate.get(t.date) ?? t.priceCents / 100,
  }));

  const totalCommissionCents = result.trades.reduce((s, t) => s + t.commissionCents, 0);
  const totalSlippageCents = result.trades.reduce((s, t) => s + t.slippageCents, 0);
  const costBars = [
    { name: 'Commission', cents: totalCommissionCents },
    { name: 'Slippage', cents: totalSlippageCents },
    { name: 'Total costs', cents: metrics.totalCostsCents },
  ];

  const finalEquityCents = equityCurve[equityCurve.length - 1]?.equity_cents ?? null;
  const totalReturnPct = equityCurve.length && equityCurve[0].equity_cents > 0
    ? finalEquityCents / equityCurve[0].equity_cents - 1 : null;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 16 }}>
        <MetricCard label="Final equity" value={f$(finalEquityCents)} sublabel={fPct(totalReturnPct)} delta={totalReturnPct} grade="A" gradeLabel="Computed from the engine's own equity curve" />
        <MetricCard label="CAGR" value={fPct(metrics.cagr)} grade={metrics.cagr != null ? 'A' : 'C'} gradeLabel={metrics.cagr != null ? 'Computed from the run’s equity curve' : 'Not computable — run spans too short a period'} />
        <MetricCard label="Sharpe" value={metrics.sharpe != null ? metrics.sharpe.toFixed(2) : '—'} grade={metrics.sharpe != null ? 'A' : 'C'} gradeLabel={metrics.sharpe != null ? 'Computed from the run’s daily returns' : 'Not computable — zero-volatility or too-short a run'} />
        <MetricCard label="Max drawdown" value={fPct(metrics.maxDrawdown?.pct)} grade={metrics.maxDrawdown?.pct != null ? 'A' : 'C'} gradeLabel={metrics.maxDrawdown?.pct != null ? 'Computed from the run’s equity curve' : 'Not computable'} />
        <MetricCard label="Win rate" value={metrics.winRate != null ? `${(metrics.winRate * 100).toFixed(0)}%` : '—'} grade={metrics.winRate != null ? 'A' : 'C'} gradeLabel={metrics.winRate != null ? 'Computed from closed trades in this run' : 'No closed trades to compute a win rate'} />
        <MetricCard label="Total costs" value={f$2(metrics.totalCostsCents)} grade="A" gradeLabel="Sum of commission + slippage across all fills" />
      </div>

      {supportError && (
        <div style={{ color: 'var(--m-muted)', fontSize: 12, marginBottom: 12 }}>
          Benchmark/price context unavailable ({supportError}) — the charts below fall back to strategy-only data.
        </div>
      )}

      <ChartCard
        title="Equity vs. benchmark"
        height={280}
        chart={
          <ResponsiveContainer>
            <LineChart data={equityVsBenchmark}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" />
              <XAxis dataKey="date" stroke="var(--m-muted)" style={{ fontSize: 11 }} tickFormatter={fmtDate} />
              <YAxis stroke="var(--m-muted)" style={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate} formatter={(v) => `$${Math.round(v).toLocaleString()}`} />
              {config.benchmarkSymbol && <Legend wrapperStyle={{ fontSize: 12 }} />}
              <Line type="monotone" dataKey="equity" name="Strategy" stroke="var(--m-chart-1)" strokeWidth={2} dot={false} />
              {config.benchmarkSymbol && <Line type="monotone" dataKey="benchmark" name={config.benchmarkSymbol} stroke="var(--m-chart-2)" strokeWidth={2} dot={false} connectNulls />}
            </LineChart>
          </ResponsiveContainer>
        }
        table={<DataTable
          columns={[
            { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
            { key: 'equity', label: 'Strategy', align: 'right', strong: true, render: (r) => `$${Math.round(r.equity).toLocaleString()}` },
            ...(config.benchmarkSymbol ? [{ key: 'benchmark', label: config.benchmarkSymbol, align: 'right', render: (r) => (r.benchmark != null ? `$${Math.round(r.benchmark).toLocaleString()}` : '—') }] : []),
          ]}
          rows={equityVsBenchmark}
        />}
      />

      <ChartCard
        title="Underwater curve (drawdown from peak)"
        chart={
          <ResponsiveContainer>
            <AreaChart data={drawdown}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" />
              <XAxis dataKey="date" stroke="var(--m-muted)" style={{ fontSize: 11 }} tickFormatter={fmtDate} />
              <YAxis stroke="var(--m-muted)" style={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate} formatter={(v) => `${v.toFixed(2)}%`} />
              <ReferenceLine y={0} stroke="var(--m-border)" />
              <Area type="monotone" dataKey="ddPct" name="Drawdown" stroke="var(--m-red)" fill="var(--m-red-bg)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        }
        table={<DataTable
          columns={[{ key: 'date', label: 'Date', render: (r) => fmtDate(r.date) }, { key: 'ddPct', label: 'Drawdown', align: 'right', strong: true, render: (r) => `${r.ddPct.toFixed(2)}%` }]}
          rows={drawdown}
        />}
      />

      <ChartCard
        title="Monthly returns"
        chart={<MonthlyHeatmap monthly={monthly} />}
        table={<DataTable
          columns={[{ key: 'key', label: 'Month' }, { key: 'retPct', label: 'Return', align: 'right', strong: true, render: (r) => fPct(r.retPct != null ? r.retPct / 100 : null) }]}
          rows={monthly}
        />}
      />

      <ChartCard
        title="Rolling Sharpe (21-bar)"
        chart={
          <ResponsiveContainer>
            <LineChart data={rollingSharpe}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" />
              <XAxis dataKey="date" stroke="var(--m-muted)" style={{ fontSize: 11 }} tickFormatter={fmtDate} />
              <YAxis stroke="var(--m-muted)" style={{ fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate} formatter={(v) => (v == null ? '—' : v.toFixed(2))} />
              <ReferenceLine y={0} stroke="var(--m-border)" />
              <Line type="monotone" dataKey="sharpe" name="Rolling Sharpe" stroke="var(--m-chart-1)" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        }
        table={<DataTable
          columns={[{ key: 'date', label: 'Date', render: (r) => fmtDate(r.date) }, { key: 'sharpe', label: 'Sharpe', align: 'right', strong: true, render: (r) => (r.sharpe == null ? '—' : r.sharpe.toFixed(2)) }]}
          rows={rollingSharpe}
        />}
      />

      <ChartCard
        title={`Allocation over time (${primarySymbol} vs. cash)`}
        chart={
          <ResponsiveContainer>
            <AreaChart data={allocation}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" />
              <XAxis dataKey="date" stroke="var(--m-muted)" style={{ fontSize: 11 }} tickFormatter={fmtDate} />
              <YAxis stroke="var(--m-muted)" style={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate} formatter={(v) => `${Number(v).toFixed(1)}%`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey={primarySymbol} stackId="1" stroke={PALETTE[0]} fill={PALETTE[0]} />
              <Area type="monotone" dataKey="Cash" stackId="1" stroke="var(--m-muted)" fill="var(--m-muted)" fillOpacity={0.3} />
            </AreaChart>
          </ResponsiveContainer>
        }
        table={<DataTable
          columns={[{ key: 'date', label: 'Date', render: (r) => fmtDate(r.date) }, { key: primarySymbol, label: primarySymbol, align: 'right', render: (r) => `${r[primarySymbol].toFixed(1)}%` }, { key: 'Cash', label: 'Cash', align: 'right', render: (r) => `${r.Cash.toFixed(1)}%` }]}
          rows={allocation}
        />}
      />

      <ChartCard
        title={`Trade markers (${primarySymbol} fill price)`}
        chart={
          <ResponsiveContainer>
            <ComposedChart data={primaryBars || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" />
              <XAxis dataKey="date" stroke="var(--m-muted)" style={{ fontSize: 11 }} tickFormatter={fmtDate} />
              <YAxis stroke="var(--m-muted)" style={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(0)}`} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={fmtDate} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="close" name={primarySymbol} stroke="var(--m-chart-1)" strokeWidth={1.5} dot={false} />
              <Scatter name="Buy" data={tradeMarkers.filter((t) => t.side === 'buy')} dataKey="price" fill="var(--m-green)" shape="triangle" />
              <Scatter name="Sell" data={tradeMarkers.filter((t) => t.side === 'sell')} dataKey="price" fill="var(--m-red)" shape="triangle" />
            </ComposedChart>
          </ResponsiveContainer>
        }
        table={<DataTable
          columns={[
            { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
            { key: 'symbol', label: 'Symbol' },
            { key: 'side', label: 'Side' },
            { key: 'price', label: 'Fill price', align: 'right', strong: true, render: (r) => `$${r.price.toFixed(2)}` },
          ]}
          rows={tradeMarkers}
        />}
      />

      <ChartCard
        title="Cost waterfall"
        chart={
          <ResponsiveContainer>
            <BarChart data={costBars}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" />
              <XAxis dataKey="name" stroke="var(--m-muted)" style={{ fontSize: 11 }} />
              <YAxis stroke="var(--m-muted)" style={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 100).toFixed(0)}`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => f$2(v)} />
              <Bar dataKey="cents" name="Cost" fill="var(--m-red)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        }
        table={<DataTable columns={[{ key: 'name', label: 'Cost' }, { key: 'cents', label: 'Amount', align: 'right', strong: true, render: (r) => f$2(r.cents) }]} rows={costBars} />}
      />
    </div>
  );
}

function MonthlyHeatmap({ monthly }) {
  if (!monthly.length) return <EmptyState title="No monthly data" message="Run a backtest spanning at least one full month." />;
  const years = [...new Set(monthly.map((m) => m.year))].sort();
  const byKey = new Map(monthly.map((m) => [m.key, m]));
  const maxAbs = Math.max(1, ...monthly.map((m) => Math.abs(m.retPct ?? 0)));
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ padding: 4 }} />
            {MONTHS.map((m) => <th key={m} style={{ padding: 4, color: 'var(--m-muted)', fontWeight: 600 }}>{m}</th>)}
          </tr>
        </thead>
        <tbody>
          {years.map((year) => (
            <tr key={year}>
              <td style={{ padding: 4, color: 'var(--m-ink)', fontWeight: 600 }}>{year}</td>
              {MONTHS.map((_, mi) => {
                const cell = byKey.get(`${year}-${String(mi + 1).padStart(2, '0')}`);
                const ret = cell?.retPct;
                const intensity = ret == null ? 0 : Math.min(85, Math.round((Math.abs(ret) / maxAbs) * 85));
                const bg = ret == null ? 'var(--m-surface-2)' : `color-mix(in srgb, ${ret >= 0 ? 'var(--m-green)' : 'var(--m-red)'} ${intensity}%, var(--m-surface-2))`;
                return (
                  <td key={mi} title={ret == null ? 'No data' : `${fPct(ret / 100)}`} style={{ padding: 0 }}>
                    <div style={{ width: 46, height: 30, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', ...num, color: 'var(--m-ink)', fontSize: 10 }}>
                      {ret != null ? `${ret >= 0 ? '+' : ''}${ret.toFixed(0)}%` : ''}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Only 'completed' and 'no_data' ever reach this component: both are 200
// responses. 'invalid_config' (400) and 'failed' (500) are thrown by
// lib/query.js's api() before a result object exists, and are surfaced by
// RunForm's own inline error box instead — see RunForm's catch block.
function OutcomeBanner() {
  return <ErrorState message="No overlapping price data for the requested symbols/date range — upload CSV bars (or sync from Yahoo) first, then re-run." />;
}

export default function Backtest() {
  const [run, setRun] = useState(null);
  const [config, setConfig] = useState(null);

  return (
    <div>
      <RunForm onResult={(res, body) => { setRun(res); setConfig({ ...body, symbols: body.symbols }); }} />
      {run && run.outcome === 'completed' && config && <Results key={run.run.id} run={run.run} config={config} />}
      {run && run.outcome !== 'completed' && <OutcomeBanner run={run} />}
      {!run && <EmptyState title="No backtest yet" message="Load bars (CSV or Yahoo sync) and configure a strategy above, then run." />}
    </div>
  );
}
