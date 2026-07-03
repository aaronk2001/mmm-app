import { useState } from 'react';
import { useApi } from '../../../lib/query';
import { WIDGET_SETTINGS, TIMEFRAMES } from './settings';

function MultiSelect({ items, selected = [], onToggle }) {
  return (
    <div style={{ maxHeight: 120, overflow: 'auto', display: 'grid', gap: 4 }}>
      {items.map((it) => (
        <label key={it.id} className="m-no-drag" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--m-ink-2)', cursor: 'pointer' }}>
          <input type="checkbox" className="m-no-drag" checked={selected.includes(it.id)} onChange={() => onToggle(it.id)} /> {it.name}
        </label>
      ))}
    </div>
  );
}

export default function WidgetSettingsPopover({ widgetId, config = {}, onChange }) {
  const schema = WIDGET_SETTINGS[widgetId];
  const { data: cats } = useApi('money/categories');
  const { data: accs } = useApi('money/accounts');
  // Local state accumulates edits so the debounced save carries them all (server
  // settings lag, so reading `config` per-edit would drop earlier changes).
  const [local, setLocal] = useState(config);
  if (!schema) return null;
  const set = (k, v) => { const next = { ...local, [k]: v }; setLocal(next); onChange(next); };
  const toggle = (k, id) => {
    const cur = local[k] || [];
    set(k, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  return (
    <div className="m-no-drag" style={{ position: 'absolute', top: 34, right: 8, zIndex: 30, background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 10, boxShadow: 'var(--m-shadow)', padding: 12, minWidth: 200, display: 'grid', gap: 12 }}>
      {schema.map((s) => (
        <div key={s.key}>
          <div style={{ fontSize: 11, color: 'var(--m-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>{s.label}</div>
          {s.type === 'count' && (
            <input className="m-input m-no-drag" type="number" min="1" max="20" value={local.count ?? ''} placeholder="default"
              onChange={(e) => set('count', e.target.value === '' ? undefined : Math.max(1, parseInt(e.target.value, 10) || 1))} style={{ padding: '4px 8px', fontSize: 13 }} />
          )}
          {s.type === 'timeframe' && (
            <div style={{ display: 'flex', gap: 4 }}>
              {TIMEFRAMES.map((t) => (
                <button key={t.id} className="m-no-drag" onClick={() => set('timeframe', t.id)}
                  style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--m-border)',
                    background: (local.timeframe || '30d') === t.id ? 'var(--m-accent)' : 'var(--m-surface-2)',
                    color: (local.timeframe || '30d') === t.id ? '#fff' : 'var(--m-ink-2)' }}>{t.label}</button>
              ))}
            </div>
          )}
          {s.type === 'categories' && <MultiSelect items={(cats?.categories || [])} selected={local.categories} onToggle={(id) => toggle('categories', id)} />}
          {s.type === 'accounts' && <MultiSelect items={(accs?.accounts || [])} selected={local.accounts} onToggle={(id) => toggle('accounts', id)} />}
        </div>
      ))}
    </div>
  );
}
