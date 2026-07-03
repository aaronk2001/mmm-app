// Shared helpers for custom fields (definitions + values). Pure functions.

export function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';
}

export function makeUniqueSlug(name, existingSlugs = []) {
  const base = slugify(name);
  const set = new Set(existingSlugs);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export function valueSlug(field, value) {
  if (field.type === 'checkbox') return value ? 'yes' : 'no';
  return slugify(String(value));
}

export function fieldValues(field) {
  if (field.type === 'checkbox') return [{ value: true, label: 'Yes', slug: 'yes' }, { value: false, label: 'No', slug: 'no' }];
  return (field.options || []).map((o) => ({ value: o, label: o, slug: slugify(o) }));
}

export function fieldsFor(settings, entity) {
  return (settings?.customFields || []).filter((f) => f.entity === entity);
}

export function matchesFilter(record, field, filterValue) {
  if (!filterValue || filterValue === '__any__') return true;
  const v = (record.custom || {})[field.id];
  if (field.type === 'checkbox') return (v ? 'yes' : 'no') === filterValue;
  return String(v ?? '') === String(filterValue);
}
