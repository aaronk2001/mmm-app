import { useState } from 'react';
import { api, queryClient } from '../../../lib/query';
import { toast } from '../../../lib/toast';

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });

export default function ProposalCard({ finding, onDecided }) {
  const p = finding.proposal;
  const [busy, setBusy] = useState(false);
  const ref = { finding_id: finding.id, fingerprint: p.fingerprint };

  async function confirm() {
    setBusy(true);
    try {
      const { applied } = await post('money/advice/confirm', ref);
      toast.success(`Recorded: ${applied.title}`);
      onDecided({ kind: 'applied', activity_log_id: applied.activity_log_id, title: applied.title });
      queryClient.invalidateQueries();
    } catch (err) {
      toast.error(err.message);
      queryClient.invalidateQueries({ queryKey: ['money/advice'] });
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    try {
      await post('money/advice/dismiss', ref);
    } catch (err) {
      toast.error(err.message);
    } finally {
      queryClient.invalidateQueries({ queryKey: ['money/advice'] });
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--m-ink)' }}>{p.title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 12, rowGap: 2, fontSize: 12, marginTop: 4 }}>
        {p.fields.map((x) => (
          <div key={x.label} style={{ display: 'contents' }}>
            <span style={{ color: 'var(--m-muted)' }}>{x.label}</span>
            <span style={{ color: 'var(--m-ink)' }}>{x.value}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--m-muted)', marginTop: 6 }}>{p.consequence}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="m-btn m-btn-primary m-btn-sm m-no-drag" disabled={busy} onClick={confirm}>{p.verb}</button>
        <button className="m-btn m-btn-secondary m-btn-sm m-no-drag" disabled={busy} onClick={dismiss}>Dismiss</button>
      </div>
    </div>
  );
}
