import { useState } from 'react';
import { Plus, Trash2, Zap, ArrowRight, Wand2 } from 'lucide-react';
import { api, useApi, queryClient } from '../../../lib/query';

export default function RulesManager() {
  const { data: rulesRes } = useApi('money/rules');
  const { data: catsRes } = useApi('money/categories');
  const rules = rulesRes?.rules || [];
  const categories = catsRes?.categories || [];

  const [match, setMatch] = useState('');
  const [catId, setCatId] = useState('');
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(null);

  const catName = (id) => categories.find((c) => c.id === id)?.name || id || '—';

  async function addRule() {
    if (!match.trim() || !catId) return;
    setBusy(true);
    try {
      await api('money/rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match: match.trim(), category_id: catId }),
      });
      setMatch(''); setCatId('');
      queryClient.invalidateQueries({ queryKey: ['money/rules'] });
    } catch { /* surfaced by disabled-state; keep simple */ }
    finally { setBusy(false); }
  }

  async function removeRule(id) {
    try {
      await api('money/rules/' + id, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['money/rules'] });
    } catch { /* no-op */ }
  }

  async function applyRules() {
    setBusy(true); setApplied(null);
    try {
      const r = await api('money/rules/apply', { method: 'POST' });
      setApplied(r?.updated ?? 0);
      queryClient.invalidateQueries({ queryKey: ['money/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['money/overview'] });
    } catch { /* no-op */ }
    finally { setBusy(false); }
  }

  return (
    <div className="m-card m-card-no-hover" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--m-ink)' }}>Auto-categorization rules</div>
          <div style={{ fontSize: 13, color: 'var(--m-ink-2)', marginTop: 2 }}>
            When a transaction&rsquo;s payee contains your text, it&rsquo;s filed under the chosen category.
          </div>
        </div>
        <button className="m-btn m-btn-secondary m-btn-sm" onClick={applyRules} disabled={busy || !rules.length}>
          <Zap size={14} style={{ marginRight: 6 }} /> Apply now
        </button>
      </div>

      {applied != null && (
        <div style={{ fontSize: 13, color: applied > 0 ? 'var(--m-green)' : 'var(--m-muted)', marginBottom: 12 }}>
          {applied > 0 ? `Re-categorized ${applied} transaction${applied === 1 ? '' : 's'}.` : 'No transactions needed changes.'}
        </div>
      )}

      {/* Add form */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: rules.length ? 16 : 4 }}>
        <span style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>If payee contains</span>
        <input
          className="m-input"
          value={match}
          placeholder="e.g. Starbucks"
          onChange={(e) => setMatch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addRule(); }}
          style={{ flex: '1 1 160px', minWidth: 120 }}
        />
        <ArrowRight size={15} style={{ color: 'var(--m-muted)' }} />
        <select className="m-input" value={catId} onChange={(e) => setCatId(e.target.value)} style={{ flex: '0 1 180px' }}>
          <option value="">Category…</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="m-btn m-btn-primary m-btn-sm" onClick={addRule} disabled={busy || !match.trim() || !catId}>
          <Plus size={14} style={{ marginRight: 4 }} /> Add
        </button>
      </div>

      {/* Rules list */}
      {rules.length === 0 ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--m-border)', color: 'var(--m-muted)', fontSize: 13 }}>
          <Wand2 size={16} /> No rules yet. Add one above to auto-file matching transactions.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 0 }}>
          {rules.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: '1px solid var(--m-border)' }}>
              <div style={{ fontSize: 13, color: 'var(--m-ink)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--m-ink-2)' }}>contains</span>
                <code style={{ background: 'var(--m-surface-2)', padding: '2px 7px', borderRadius: 6, fontSize: 12 }}>{r.match}</code>
                <ArrowRight size={14} style={{ color: 'var(--m-muted)' }} />
                <span style={{ fontWeight: 600 }}>{catName(r.category_id)}</span>
              </div>
              <button
                onClick={() => removeRule(r.id)}
                title="Delete rule"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--m-muted)', display: 'flex', padding: 4 }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
