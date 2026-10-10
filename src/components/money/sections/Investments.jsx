import { useState } from 'react';
import { TrendingUp, Plus, Trash2, Pencil, X, RefreshCw } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import SectionHeader from '../shared/SectionHeader';
import Card from '../shared/Card';
import EmptyState from '../shared/EmptyState';
import { useApi, api, queryClient } from '../../../lib/query';
import { confirmDialog } from '../../../lib/confirm';
import { toast } from '../../../lib/toast';
import Money from '../shared/Money';

const f$ = (n) => (Number(n) < 0 ? '-$' : '$') + Math.abs(Math.round(Number(n) || 0)).toLocaleString();
const fSigned = (n) => (Number(n) >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(Number(n) || 0)).toLocaleString();
const num = { fontVariantNumeric: 'tabular-nums' };
const PALETTE = ['var(--m-chart-1)', 'var(--m-chart-2)', 'var(--m-chart-3)', 'var(--m-chart-4)', 'var(--m-chart-5)', 'var(--m-chart-6)', 'var(--m-chart-7)', 'var(--m-chart-8)'];

const BLANK = { account_id: '', symbol: '', shares: '', cost_basis: '', current_price: '' };

export default function Investments() {
  const { data: summary, isLoading } = useApi('money/investments/summary');
  const { data: accRes } = useApi('money/accounts');
  const accounts = accRes?.accounts || [];
  const holdings = summary?.holdings || [];
  const allocation = summary?.allocation || [];

  const [form, setForm] = useState(BLANK);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingPrice, setEditingPrice] = useState(null);
  const [priceInput, setPriceInput] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const accName = (id) => accounts.find((a) => a.id === id)?.name || '—';

  function openAdd() { setForm(BLANK); setEditingId(null); setShowForm(true); }
  function openEdit(h) {
    setForm({ account_id: h.account_id || '', symbol: h.symbol, shares: String(h.shares), cost_basis: String(h.cost_basis), current_price: String(h.current_price) });
    setEditingId(h.id); setShowForm(true);
  }
  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['money/investments/summary'] });
    queryClient.invalidateQueries({ queryKey: ['money/holdings'] });
  }

  async function save(e) {
    e.preventDefault();
    if (!form.symbol.trim()) return;
    setBusy(true);
    try {
      const body = JSON.stringify(form);
      if (editingId) await api('money/holdings/' + editingId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
      else await api('money/holdings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      setShowForm(false); setForm(BLANK); setEditingId(null); refresh();
    } catch (err) { console.error(err); }
    finally { setBusy(false); }
  }
  async function remove(id) {
    if (!(await confirmDialog({ message: 'Delete this holding?', confirmLabel: 'Delete' }))) return;
    try { await api('money/holdings/' + id, { method: 'DELETE' }); refresh(); }
    catch (err) { console.error(err); toast.error(`Delete failed: ${err.message}`); }
  }
  // Manual price editing (savePriceEdit below) stays the default path — this
  // is the one explicit, user-triggered fetch: it never runs on its own, and
  // a disabled/failed market feature leaves prices exactly as they were.
  async function refreshPrices() {
    setRefreshing(true);
    try {
      const res = await api('market/refresh-holdings', { method: 'POST' });
      refresh();
      toast.success(`Refreshed ${res.updated}/${res.total} price${res.total === 1 ? '' : 's'} from Yahoo`);
    } catch (err) {
      toast.error(`Refresh failed: ${err.message}`);
    } finally { setRefreshing(false); }
  }
  function openPriceEdit(h) { setEditingPrice(h.id); setPriceInput(String(h.current_price)); }
  async function savePriceEdit(id) {
    if (!priceInput.trim()) return;
    try {
      await api('money/holdings/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_price: Number(priceInput) }) });
      setEditingPrice(null); setPriceInput(''); refresh();
    } catch (err) { console.error(err); toast.error(`Price update failed: ${err.message}`); }
  }

  if (isLoading) {
    return (
      <div>
        <SectionHeader icon={TrendingUp} title="Investments" subtitle="Holdings, allocation, and performance" />
        <Card><div style={{ textAlign: 'center', padding: 32, color: 'var(--m-muted)' }}>Loading…</div></Card>
      </div>
    );
  }

  const Stat = ({ label, value, color, sub }) => (
    <div>
      <div style={{ fontSize: 11, color: 'var(--m-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || 'var(--m-ink)', marginTop: 4, ...num }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--m-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      <SectionHeader icon={TrendingUp} title="Investments" subtitle="Holdings, allocation, and performance" />

      {holdings.length === 0 && !showForm ? (
        <EmptyState
          icon={TrendingUp}
          title="No holdings yet"
          message="Add the stocks, ETFs, and funds you own to track allocation and performance."
          action={<button className="m-btn m-btn-primary m-btn-sm" onClick={openAdd}><Plus size={16} /> Add Holding</button>}
        />
      ) : (
        <>
          {/* Stats + allocation */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', gap: 16, marginBottom: 16 }}>
            <Card className="m-card-no-hover">
              <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: 8 }}>
                <Stat label="Market Value" value={f$(summary?.marketValue)} />
                <Stat label="Total Gain / Loss" value={fSigned(summary?.gain)} color={(summary?.gain || 0) >= 0 ? 'var(--m-green)' : 'var(--m-red)'} />
                <Stat label="Return" value={(summary?.gainPct >= 0 ? '+' : '') + (summary?.gainPct ?? 0) + '%'} color={(summary?.gainPct || 0) >= 0 ? 'var(--m-green)' : 'var(--m-red)'} />
                <Stat label="Cost Basis" value={f$(summary?.costBasis)} />
                <Stat
                  label="Est. annual dividends"
                  value={summary?.annualIncome ? <Money value={summary.annualIncome} /> : '—'}
                  sub={summary?.annualIncome ? `${summary.yieldPct}% yield · trailing 12 mo, gross` : null}
                />
              </div>
            </Card>
            <Card className="m-card-no-hover">
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--m-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Allocation</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 130, height: 130, flexShrink: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={allocation} dataKey="value" nameKey="symbol" cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2} stroke="none">
                        {allocation.map((a, i) => <Cell key={a.symbol} fill={PALETTE[i % PALETTE.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v, n) => [f$(v), n]} contentStyle={{ background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 0 }}>
                  {allocation.slice(0, 6).map((a, i) => (
                    <div key={a.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: PALETTE[i % PALETTE.length], flexShrink: 0 }} />
                      <span style={{ color: 'var(--m-ink)', fontWeight: 600 }}>{a.symbol}</span>
                      <span style={{ color: 'var(--m-muted)', marginLeft: 'auto', ...num }}>{a.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          {/* Holdings table */}
          <Card className="m-card-sm" style={{ overflowX: 'auto', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--m-ink)' }}>Holdings</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="m-btn m-btn-secondary m-btn-sm" onClick={refreshPrices} disabled={refreshing}>
                  <RefreshCw size={14} style={{ marginRight: 4 }} /> {refreshing ? 'Refreshing…' : 'Refresh prices'}
                </button>
                <button className="m-btn m-btn-primary m-btn-sm" onClick={openAdd}><Plus size={15} style={{ marginRight: 4 }} /> Add</button>
              </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--m-border)', textAlign: 'left' }}>
                  {['Symbol', 'Shares', 'Cost', 'Price', 'Value', 'Gain', 'Div/yr', ''].map((h, i) => (
                    <th key={i} style={{ padding: '10px 12px', color: 'var(--m-muted)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em', textAlign: i >= 1 && i <= 6 ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const mv = h.shares * h.current_price;
                  const gain = (h.current_price - h.cost_basis) * h.shares;
                  return (
                    <tr key={h.id} style={{ borderBottom: '1px solid var(--m-border)' }}>
                      <td style={{ padding: '10px 12px', color: 'var(--m-ink)', fontWeight: 600 }}>{h.symbol}<div style={{ fontSize: 11, color: 'var(--m-muted)', fontWeight: 400 }}>{accName(h.account_id)}</div></td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink-2)', ...num }}>{h.shares}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink-2)', ...num }}>{f$(h.cost_basis)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink-2)', ...num }}>
                        {editingPrice === h.id ? (
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                            <input type="number" step="any" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} className="m-input" style={{ width: 80, padding: '4px 8px', fontSize: 13 }} autoFocus />
                            <button className="m-btn m-btn-primary m-btn-sm" onClick={() => savePriceEdit(h.id)} style={{ padding: '4px 8px', fontSize: 12 }}>✓</button>
                            <button className="m-btn m-btn-secondary m-btn-sm" onClick={() => setEditingPrice(null)} style={{ padding: '4px 8px', fontSize: 12 }}>✕</button>
                          </div>
                        ) : (
                          <div onClick={() => openPriceEdit(h)} style={{ cursor: 'default', userSelect: 'none' }}>{f$(h.current_price)}</div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink)', fontWeight: 600, ...num }}>{f$(mv)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: gain >= 0 ? 'var(--m-green)' : 'var(--m-red)', ...num }}>{fSigned(gain)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink-2)', ...num }}>{h.shares * h.dividend_ttm > 0 ? <Money value={h.shares * h.dividend_ttm} /> : '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="m-btn m-btn-icon m-btn-ghost m-btn-sm" onClick={() => openEdit(h)} title="Edit" style={{ width: 30, height: 30, padding: 0 }}><Pencil size={13} /></button>
                        <button className="m-btn m-btn-icon m-btn-ghost m-btn-sm" onClick={() => remove(h.id)} title="Delete" style={{ width: 30, height: 30, padding: 0 }}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {/* Add / edit form */}
      {showForm && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--m-ink)' }}>{editingId ? 'Edit holding' : 'Add holding'}</div>
            <button className="m-btn m-btn-icon m-btn-ghost m-btn-sm" onClick={() => setShowForm(false)} style={{ width: 30, height: 30, padding: 0 }}><X size={15} /></button>
          </div>
          <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
              <div>
                <label className="m-input-label">Symbol *</label>
                <input className="m-input" placeholder="e.g. AAPL" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} required />
              </div>
              <div>
                <label className="m-input-label">Shares *</label>
                <input className="m-input" type="number" step="any" placeholder="e.g. 10" value={form.shares} onChange={(e) => setForm({ ...form, shares: e.target.value })} required />
              </div>
              <div>
                <label className="m-input-label">Cost / share</label>
                <input className="m-input" type="number" step="any" placeholder="e.g. 150" value={form.cost_basis} onChange={(e) => setForm({ ...form, cost_basis: e.target.value })} />
              </div>
              <div>
                <label className="m-input-label">Current price</label>
                <input className="m-input" type="number" step="any" placeholder="e.g. 210" value={form.current_price} onChange={(e) => setForm({ ...form, current_price: e.target.value })} />
              </div>
              <div>
                <label className="m-input-label">Account</label>
                <select className="m-input" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
                  <option value="">Unassigned</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button type="submit" className="m-btn m-btn-primary" disabled={busy}>{busy ? 'Saving…' : (editingId ? 'Save' : 'Add Holding')}</button>
              <button type="button" className="m-btn m-btn-secondary" onClick={() => setShowForm(false)} disabled={busy}>Cancel</button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
