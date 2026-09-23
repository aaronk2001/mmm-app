import { useState } from 'react';
import { Star, Trash2, RefreshCw } from 'lucide-react';
import { useApi, api, queryClient } from '../../../../../lib/query';
import { confirmDialog } from '../../../../../lib/confirm';
import { toast } from '../../../../../lib/toast';
import Card from '../../../shared/Card';
import EmptyState from '../../../shared/EmptyState';
import Skeleton from '../../../shared/Skeleton';
import { f$, fPct, changeColor, num, rangeStr, formatUpdatedAt } from './common';

// This tab is the one the brief means by "UI reads snapshots and never
// triggers a fetch except explicit Refresh": prices come only from
// GET /market/snapshots (price_cache — zero network calls), and the only
// button that can open a socket is "Refresh now" -> POST /market/refresh.
export default function Watchlist() {
  const { data: wlRes, isLoading } = useApi('market/watchlist');
  const { data: snapRes } = useApi('market/snapshots?kind=quote');
  const [symbol, setSymbol] = useState('');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const watchlist = wlRes?.watchlist || [];
  const snapshots = snapRes?.price_cache || [];
  const bySymbol = Object.fromEntries(snapshots.map((s) => [s.symbol, s]));

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['market/watchlist'] });
    queryClient.invalidateQueries({ queryKey: ['market/snapshots?kind=quote'] });
  }

  async function addSymbol(e) {
    e.preventDefault();
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    setAdding(true);
    try {
      await api('market/watchlist', { method: 'POST', body: JSON.stringify({ symbol: s, note }) });
      setSymbol(''); setNote('');
      refresh();
      toast.success(`Added ${s} to watchlist`);
    } catch (err) {
      toast.error(err.message);
    } finally { setAdding(false); }
  }

  async function removeItem(item) {
    const ok = await confirmDialog(`Remove ${item.symbol} from the watchlist?`);
    if (!ok) return;
    try {
      await api(`market/watchlist/${item.id}`, { method: 'DELETE' });
      refresh();
    } catch (err) { toast.error(err.message); }
  }

  async function refreshNow() {
    setRefreshing(true);
    try {
      const res = await api('market/refresh', { method: 'POST' });
      refresh();
      toast.success(res.written != null ? `Refreshed ${res.written} price${res.written === 1 ? '' : 's'}` : (res.reason || 'Done'));
    } catch (err) {
      toast.error(err.message);
    } finally { setRefreshing(false); }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <Card>
        <form onSubmit={addSymbol} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 14 }}>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbol" className="m-input" style={{ width: 120, textTransform: 'uppercase' }} aria-label="Symbol" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="m-input" style={{ width: 220 }} aria-label="Note" />
          <button type="submit" className="m-btn m-btn-primary m-btn-sm" disabled={adding}>{adding ? 'Adding…' : 'Add'}</button>
          <div style={{ flex: 1 }} />
          <button type="button" className="m-btn m-btn-secondary m-btn-sm" onClick={refreshNow} disabled={refreshing}>
            <RefreshCw size={14} style={{ marginRight: 4 }} /> {refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
        </form>
      </Card>

      <div style={{ marginTop: 16 }}>
        {isLoading ? (
          <Skeleton height={160} />
        ) : watchlist.length === 0 ? (
          <EmptyState icon={Star} title="Watchlist is empty" message="Add a symbol above to track it here. Prices only update when you hit Refresh now, or the opt-in 30-minute job runs during market hours." />
        ) : (
          <Card className="m-card-sm" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--m-border)' }}>
                  {['Symbol', 'Note', 'Price', 'Change', 'Day Range', 'Updated', ''].map((h, i) => (
                    <th key={h} style={{ padding: '10px 12px', color: 'var(--m-muted)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em', textAlign: i >= 2 && i <= 4 ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {watchlist.map((item) => {
                  const snap = bySymbol[item.symbol];
                  const q = snap?.data || {};
                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--m-border)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--m-ink)' }}>{item.symbol}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--m-ink-2)' }}>{item.note || '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink)', ...num }}>{snap ? f$(snap.price) : '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: changeColor(snap?.change_pct), ...num }}>
                        {snap ? `${fPct(snap.change_pct)}${q.change != null ? ` (${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)})` : ''}` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink-2)', fontSize: 12, ...num }}>{rangeStr(q.dayLow, q.dayHigh)}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--m-muted)', fontSize: 12 }} title={snap?.fetched_at ? new Date(snap.fetched_at).toLocaleString() : undefined}>
                        {snap?.fetched_at ? (formatUpdatedAt(snap.fetched_at) || new Date(snap.fetched_at).toLocaleString()) : 'never — hit Refresh now'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <button className="m-btn m-btn-secondary m-btn-sm" onClick={() => removeItem(item)} aria-label={`Remove ${item.symbol}`}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
