import { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Plus, X } from 'lucide-react';
import MetricCard from '../../../shared/MetricCard';
import Money from '../../../shared/Money';
import Card from '../../../shared/Card';
import ErrorState from '../../../shared/ErrorState';
import Skeleton from '../../../shared/Skeleton';
import EmptyState from '../../../shared/EmptyState';
import { useApi, api, queryClient } from '../../../../../lib/query';
import { toast } from '../../../../../lib/toast';
import RiskCalculator from './RiskCalculator';

const num = { fontVariantNumeric: 'tabular-nums' };
const PALETTE = ['var(--m-chart-1)', 'var(--m-chart-2)', 'var(--m-chart-3)', 'var(--m-chart-4)', 'var(--m-chart-5)', 'var(--m-chart-6)', 'var(--m-chart-7)', 'var(--m-chart-8)'];
const f$ = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();

function invalidate() {
  queryClient.invalidateQueries({ queryKey: ['trading/summary'] });
  queryClient.invalidateQueries({ queryKey: ['trading/positions'] });
}

const BLANK_OPEN = {
  symbol: '', lastPrice: '', conviction: '8', thesis_id: '', thesis: '',
  position_pct: '10', sector: '', stop_pct: '', target_pct: '', catalyst: '',
};

function DirectionPill({ direction }) {
  const color = direction === 'LONG' ? 'var(--m-green)' : 'var(--m-red)';
  return (
    <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, lineHeight: '16px', padding: '0 6px', borderRadius: 999, border: `1px solid ${color}`, color }}>
      {direction}
    </span>
  );
}

function OpenPositionForm({ onClose, onSaved }) {
  const [form, setForm] = useState(BLANK_OPEN);
  const [busy, setBusy] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [error, setError] = useState(null);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setCheckResult(null); };

  function buildDecision() {
    return {
      action: 'BUY',
      symbol: form.symbol.trim().toUpperCase(),
      conviction: Number(form.conviction),
      thesis_id: form.thesis_id.trim() || 'manual',
      thesis: form.thesis.trim(),
      position_pct: Number(form.position_pct),
      ...(form.sector.trim() && { sector: form.sector.trim() }),
      ...(form.stop_pct !== '' && { stop_pct: Number(form.stop_pct) }),
      ...(form.target_pct !== '' && { target_pct: Number(form.target_pct) }),
      ...(form.catalyst.trim() && { catalyst: form.catalyst.trim() }),
    };
  }

  async function checkGate() {
    setError(null);
    try {
      const result = await api('trading/gate-check', {
        method: 'POST', body: JSON.stringify({ decision: buildDecision(), lastPrice: Number(form.lastPrice) }),
      });
      setCheckResult(result);
    } catch (err) { setError(err.message); }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('trading/open', {
        method: 'POST', body: JSON.stringify({ decision: buildDecision(), lastPrice: Number(form.lastPrice) }),
      });
      onSaved(); onClose();
      toast.success(`Opened ${form.symbol.toUpperCase()}.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--m-ink)' }}>Open Position (paper)</div>
        <button className="m-btn m-btn-icon m-btn-ghost m-btn-sm" onClick={onClose} style={{ width: 30, height: 30, padding: 0 }}><X size={15} /></button>
      </div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
          <div>
            <label className="m-input-label">Symbol *</label>
            <input className="m-input" placeholder="e.g. AAPL" value={form.symbol} onChange={(e) => set('symbol', e.target.value.toUpperCase())} required />
          </div>
          <div>
            <label className="m-input-label">Last price *</label>
            <input className="m-input" type="number" step="any" value={form.lastPrice} onChange={(e) => set('lastPrice', e.target.value)} required />
          </div>
          <div>
            <label className="m-input-label">Conviction (1-10) *</label>
            <input className="m-input" type="number" min="1" max="10" step="1" value={form.conviction} onChange={(e) => set('conviction', e.target.value)} required />
          </div>
          <div>
            <label className="m-input-label">Position % of equity</label>
            <input className="m-input" type="number" min="0" max="25" step="1" value={form.position_pct} onChange={(e) => set('position_pct', e.target.value)} />
          </div>
          <div>
            <label className="m-input-label">Sector</label>
            <input className="m-input" placeholder="optional" value={form.sector} onChange={(e) => set('sector', e.target.value)} />
          </div>
          <div>
            <label className="m-input-label">Stop %</label>
            <input className="m-input" type="number" min="0" max="15" step="0.1" value={form.stop_pct} onChange={(e) => set('stop_pct', e.target.value)} />
          </div>
          <div>
            <label className="m-input-label">Target %</label>
            <input className="m-input" type="number" min="0" max="100" step="0.1" value={form.target_pct} onChange={(e) => set('target_pct', e.target.value)} />
          </div>
          <div>
            <label className="m-input-label">Thesis ID</label>
            <input className="m-input" placeholder="optional" value={form.thesis_id} onChange={(e) => set('thesis_id', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="m-input-label">Thesis</label>
          <textarea className="m-input" rows={2} style={{ resize: 'none' }} value={form.thesis} onChange={(e) => set('thesis', e.target.value)} placeholder="Why are you entering this trade?" />
        </div>

        {checkResult && (
          checkResult.ok
            ? <div style={{ color: 'var(--m-green)', fontSize: 13 }}>Gate passes — sized at {checkResult.qty} shares.</div>
            : <div style={{ color: 'var(--m-red)', fontSize: 13 }}>Gate rejects: {checkResult.violations.join('; ')}</div>
        )}
        {error && <div style={{ color: 'var(--m-red)', fontSize: 13 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" className="m-btn m-btn-secondary" onClick={checkGate} disabled={!form.symbol || !form.lastPrice}>Check gate</button>
          <button type="submit" className="m-btn m-btn-primary" disabled={busy}>{busy ? 'Opening…' : 'Open Position'}</button>
          <button type="button" className="m-btn m-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Card>
  );
}

function ClosePositionForm({ position, onClose, onSaved }) {
  const [exitPrice, setExitPrice] = useState('');
  const [whatHappened, setWhatHappened] = useState('');
  const [lesson, setLesson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const estPnl = exitPrice
    ? (Number(exitPrice) - position.entry_price) * position.shares
    : null;

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api(`trading/close/${position.id}`, {
        method: 'POST',
        body: JSON.stringify({ exitPrice: Number(exitPrice), what_happened: whatHappened, lesson }),
      });
      onSaved(); onClose();
      toast.success(`Closed ${position.ticker}.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--m-ink)' }}>Close {position.ticker} {position.direction}</div>
        <button className="m-btn m-btn-icon m-btn-ghost m-btn-sm" onClick={onClose} style={{ width: 30, height: 30, padding: 0 }}><X size={15} /></button>
      </div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 24, padding: '10px 14px', background: 'var(--m-surface-2)', borderRadius: 8 }}>
          <div><div style={{ fontSize: 11, color: 'var(--m-muted)' }}>Entry</div><div style={{ fontWeight: 600, ...num }}>{f$(position.entry_price)}</div></div>
          <div><div style={{ fontSize: 11, color: 'var(--m-muted)' }}>Shares</div><div style={{ fontWeight: 600, ...num }}>{position.shares}</div></div>
        </div>
        <div>
          <label className="m-input-label">Exit price *</label>
          <input className="m-input" type="number" step="any" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} required />
        </div>
        {estPnl != null && (
          <div style={{ fontWeight: 700, fontSize: 14, color: estPnl >= 0 ? 'var(--m-green)' : 'var(--m-red)', ...num }}>
            Estimated P&amp;L: {estPnl >= 0 ? '+' : '−'}{f$(Math.abs(estPnl))}
          </div>
        )}
        <div>
          <label className="m-input-label">What happened</label>
          <textarea className="m-input" rows={2} style={{ resize: 'none' }} value={whatHappened} onChange={(e) => setWhatHappened(e.target.value)} />
        </div>
        <div>
          <label className="m-input-label">Lesson learned</label>
          <textarea className="m-input" rows={2} style={{ resize: 'none' }} value={lesson} onChange={(e) => setLesson(e.target.value)} />
        </div>
        {error && <div style={{ color: 'var(--m-red)', fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 12 }}>
          <button type="submit" className="m-btn m-btn-primary" disabled={busy}>{busy ? 'Closing…' : 'Close Position'}</button>
          <button type="button" className="m-btn m-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Card>
  );
}

export default function Open() {
  const { data: summary, isLoading, error, refetch } = useApi('trading/summary');
  const { data: invSummary } = useApi('money/investments/summary');
  const [showOpenForm, setShowOpenForm] = useState(false);
  const [closingPosition, setClosingPosition] = useState(null);
  const [resetBusy, setResetBusy] = useState(false);

  function refresh() { refetch(); invalidate(); }

  async function resetPortfolio() {
    setResetBusy(true);
    try {
      await api('trading/reset', { method: 'POST' });
      refresh();
      toast.success('Paper portfolio reset to starting capital.');
    } catch (err) { toast.error(`Reset failed: ${err.message}`); }
    finally { setResetBusy(false); }
  }

  if (isLoading) return <Skeleton height={280} />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  const positions = summary.open_positions || [];
  const holdings = invSummary?.allocation || [];

  const realSlices = holdings.map((h) => ({ name: h.symbol, value: h.value }));
  const paperSlices = positions.map((p) => ({ name: `${p.ticker} (paper)`, value: p.shares * p.entry_price }));
  const cashSlice = summary.capital > 0 ? [{ name: 'Paper cash', value: summary.capital }] : [];
  const allocation = [...realSlices, ...paperSlices, ...cashSlice].filter((s) => s.value > 0);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 16 }}>
        <MetricCard label="Paper capital" value={<Money value={summary.capital} decimals={0} />} sublabel={`of ${f$(summary.starting_capital)} starting`} />
        <MetricCard label="Total P&L" value={<Money value={summary.total_pnl} decimals={0} />} delta={summary.total_pnl} sublabel={`${summary.total_return_pct >= 0 ? '+' : ''}${summary.total_return_pct}%`} />
        <MetricCard label="Win rate" value={`${summary.win_rate}%`} sublabel={`${summary.total_trades} closed trades`} />
        <MetricCard label="Open positions" value={String(positions.length)} />
      </div>

      {allocation.length > 0 && (
        <Card className="m-card-no-hover" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--m-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
            Portfolio — real holdings + paper positions
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 130, height: 130, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={allocation} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2} stroke="none">
                    {allocation.map((a, i) => <Cell key={a.name} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [f$(v), n]} contentStyle={{ background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 0 }}>
              {allocation.slice(0, 8).map((a, i) => (
                <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: PALETTE[i % PALETTE.length], flexShrink: 0 }} />
                  <span style={{ color: 'var(--m-ink)', fontWeight: 600 }}>{a.name}</span>
                  <span style={{ color: 'var(--m-muted)', marginLeft: 'auto', ...num }}>{f$(a.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <button className="m-btn m-btn-primary m-btn-sm" onClick={() => setShowOpenForm(true)}><Plus size={15} style={{ marginRight: 4 }} /> Open Position</button>
        <button className="m-btn m-btn-secondary m-btn-sm" onClick={resetPortfolio} disabled={resetBusy}>{resetBusy ? 'Resetting…' : 'Reset paper portfolio'}</button>
      </div>

      {showOpenForm && <div style={{ marginBottom: 16 }}><OpenPositionForm onClose={() => setShowOpenForm(false)} onSaved={refresh} /></div>}
      {closingPosition && <ClosePositionForm position={closingPosition} onClose={() => setClosingPosition(null)} onSaved={refresh} />}

      {positions.length === 0 ? (
        <EmptyState title="No open positions" message="Paper-open a position above to test the strategy gate." />
      ) : (
        <Card className="m-card-sm" style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--m-border)', textAlign: 'left' }}>
                {['Ticker', 'Dir', 'Entry', 'Shares', 'Stop', 'Target', 'Cost basis', 'Opened', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', color: 'var(--m-muted)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em', textAlign: i >= 2 && i <= 6 ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--m-border)' }}>
                  <td style={{ padding: '10px 12px', color: 'var(--m-ink)', fontWeight: 600 }}>{p.ticker}</td>
                  <td style={{ padding: '10px 12px' }}><DirectionPill direction={p.direction} /></td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink-2)', ...num }}>{f$(p.entry_price)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink-2)', ...num }}>{p.shares}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink-2)', ...num }}>{p.stop_price ? f$(p.stop_price) : '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink-2)', ...num }}>{p.target1 ? f$(p.target1) : '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink)', fontWeight: 600, ...num }}>{f$(p.entry_price * p.shares)}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--m-muted)', fontSize: 12 }}>{new Date(p.opened_at).toLocaleDateString()}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <button className="m-btn m-btn-secondary m-btn-sm" onClick={() => setClosingPosition(p)}>Close</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <RiskCalculator />
    </div>
  );
}
