import { useState } from 'react';
import { NotebookPen } from 'lucide-react';
import Card from '../../../shared/Card';
import ErrorState from '../../../shared/ErrorState';
import Skeleton from '../../../shared/Skeleton';
import EmptyState from '../../../shared/EmptyState';
import { useApi, api, queryClient } from '../../../../../lib/query';
import { toast } from '../../../../../lib/toast';

export default function Journal() {
  const { data: entries, isLoading, error, refetch } = useApi('trading/journal');
  const { data: summary } = useApi('trading/summary');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function addNote(e) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api('trading/journal', { method: 'POST', body: JSON.stringify({ note: note.trim() }) });
      setNote('');
      refetch();
      queryClient.invalidateQueries({ queryKey: ['trading/journal'] });
    } catch (err) { toast.error(`Couldn't save note: ${err.message}`); }
    finally { setBusy(false); }
  }

  if (isLoading) return <Skeleton height={220} />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  const closedWithLessons = (summary?.closed_trades || []).filter((t) => t.lesson || t.what_happened);

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <form onSubmit={addNote} style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label className="m-input-label">Add a note</label>
            <input className="m-input" placeholder="What are you learning right now?" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button type="submit" className="m-btn m-btn-primary" disabled={busy || !note.trim()}>{busy ? 'Saving…' : 'Add'}</button>
        </form>
      </Card>

      {(!entries || entries.length === 0) && closedWithLessons.length === 0 ? (
        <EmptyState icon={NotebookPen} title="No journal entries yet" message="Notes and lessons learned from closed positions show up here." />
      ) : (
        <>
          {entries && entries.length > 0 && (
            <Card className="m-card-sm" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)', marginBottom: 10 }}>Notes</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[...entries].reverse().map((j) => (
                  <div key={j.id} style={{ borderBottom: '1px solid var(--m-border)', paddingBottom: 8 }}>
                    <div style={{ fontSize: 13, color: 'var(--m-ink)' }}>{j.note}</div>
                    <div style={{ fontSize: 11, color: 'var(--m-muted)', marginTop: 2 }}>{new Date(j.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {closedWithLessons.length > 0 && (
            <Card className="m-card-sm">
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)', marginBottom: 10 }}>Lessons learned — closed trades</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[...closedWithLessons].reverse().map((t) => (
                  <div key={t.id} style={{ borderBottom: '1px solid var(--m-border)', paddingBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)' }}>
                      {t.ticker} <span style={{ fontWeight: 400, color: t.pnl >= 0 ? 'var(--m-green)' : 'var(--m-red)' }}>{t.pnl >= 0 ? '+' : '−'}${Math.abs(t.pnl).toFixed(2)}</span>
                    </div>
                    {t.what_happened && <div style={{ fontSize: 12, color: 'var(--m-ink-2)', marginTop: 2 }}>{t.what_happened}</div>}
                    {t.lesson && <div style={{ fontSize: 12, color: 'var(--m-muted)', marginTop: 2, fontStyle: 'italic' }}>Lesson: {t.lesson}</div>}
                    <div style={{ fontSize: 11, color: 'var(--m-muted)', marginTop: 4 }}>{new Date(t.closed_at).toLocaleDateString()}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
