import { useApi } from '../../../../lib/query';
import { fieldsFor, fieldValues } from '../../../../lib/customFields';

export default function CustomFieldFilters({ entity, value = {}, onChange }) {
  const { data: settings } = useApi('settings');
  const fields = fieldsFor(settings, entity);
  if (!fields.length) return null;
  return (
    <>
      {fields.map((f) => (
        <div key={f.id}>
          <label className="m-input-label">{f.name}</label>
          <select className="m-input" value={value[f.id] ?? '__any__'} onChange={(e) => onChange({ ...value, [f.id]: e.target.value })}>
            <option value="__any__">Any</option>
            {fieldValues(f).map((o) => <option key={o.slug} value={f.type === 'checkbox' ? o.slug : o.value}>{o.label}</option>)}
          </select>
        </div>
      ))}
    </>
  );
}
