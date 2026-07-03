import { useState } from 'react';
import { Plus, Trash2, Tag } from 'lucide-react';
import { useApi, saveSettings, queryClient } from '../../../lib/query';
import { makeUniqueSlug } from '../../../lib/customFields';

const ENTITIES = [{ id: 'transaction', label: 'Transactions' }, { id: 'goal', label: 'Goals' }, { id: 'account', label: 'Accounts' }];
const BLANK = { name: '', entity: 'transaction', type: 'select', optionsText: '' };

export default function CustomFieldsManager() {
  const { data: settings } = useApi('settings');
  const fields = settings?.customFields || [];
  const [form, setForm] = useState(BLANK);

  function persist(next) {
    saveSettings({ customFields: next }).then((s) => queryClient.setQueryData(['settings'], s)).catch(() => {});
  }
  function addField() {
    if (!form.name.trim()) return;
    const slug = makeUniqueSlug(form.name, fields.map((f) => f.slug));
    const field = {
      id: 'cf_' + Math.random().toString(36).slice(2, 10),
      entity: form.entity, name: form.name.trim(), slug, type: form.type,
      ...(form.type === 'select' ? { options: form.optionsText.split(',').map((o) => o.trim()).filter(Boolean) } : {}),
    };
    persist([...fields, field]);
    setForm(BLANK);
  }
  function removeField(id) { persist(fields.filter((f) => f.id !== id)); }

  return (
    <div className="m-card m-card-no-hover" style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--m-ink)' }}>Custom fields</div>
      <div style={{ fontSize: 13, color: 'var(--m-ink-2)', marginTop: 2, marginBottom: 16 }}>
        Attach your own dropdown or yes/no fields to transactions, goals, and accounts. Filter by them and use them in custom-metric formulas.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: fields.length ? 16 : 4 }}>
        <input className="m-input" placeholder="Field name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ flex: '1 1 140px' }} />
        <select className="m-input" value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })} style={{ flex: '0 1 130px' }}>
          {ENTITIES.map((en) => <option key={en.id} value={en.id}>{en.label}</option>)}
        </select>
        <select className="m-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={{ flex: '0 1 120px' }}>
          <option value="select">Dropdown</option>
          <option value="checkbox">Yes / No</option>
        </select>
        {form.type === 'select' && (
          <input className="m-input" placeholder="Options: A, B, C" value={form.optionsText} onChange={(e) => setForm({ ...form, optionsText: e.target.value })} style={{ flex: '1 1 160px' }} />
        )}
        <button className="m-btn m-btn-primary m-btn-sm" onClick={addField} disabled={!form.name.trim()}><Plus size={14} style={{ marginRight: 4 }} /> Add</button>
      </div>

      {fields.length === 0 ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--m-border)', color: 'var(--m-muted)', fontSize: 13 }}>
          <Tag size={16} /> No custom fields yet.
        </div>
      ) : (
        <div>
          {fields.map((f) => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: '1px solid var(--m-border)' }}>
              <div style={{ fontSize: 13, color: 'var(--m-ink)' }}>
                <span style={{ fontWeight: 600 }}>{f.name}</span>
                <span style={{ color: 'var(--m-muted)', marginLeft: 8 }}>{ENTITIES.find((e) => e.id === f.entity)?.label} · {f.type === 'checkbox' ? 'Yes/No' : 'Dropdown'}{f.options?.length ? ` (${f.options.join(', ')})` : ''}</span>
              </div>
              <button onClick={() => removeField(f.id)} title="Delete field" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--m-muted)', display: 'flex', padding: 4 }}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
