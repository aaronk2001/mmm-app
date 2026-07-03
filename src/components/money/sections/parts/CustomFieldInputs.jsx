import { useApi } from '../../../../lib/query';
import { fieldsFor, fieldValues } from '../../../../lib/customFields';

export default function CustomFieldInputs({ entity, value = {}, onChange }) {
  const { data: settings } = useApi('settings');
  const fields = fieldsFor(settings, entity);
  if (!fields.length) return null;
  const set = (id, v) => onChange({ ...value, [id]: v });
  return (
    <>
      {fields.map((f) => (
        <div key={f.id}>
          <label className="m-input-label">{f.name}</label>
          {f.type === 'checkbox' ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--m-ink-2)' }}>
              <input type="checkbox" checked={!!value[f.id]} onChange={(e) => set(f.id, e.target.checked)} /> Yes
            </label>
          ) : (
            <select className="m-input" value={value[f.id] ?? ''} onChange={(e) => set(f.id, e.target.value)}>
              <option value="">—</option>
              {fieldValues(f).map((o) => <option key={o.slug} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </div>
      ))}
    </>
  );
}
