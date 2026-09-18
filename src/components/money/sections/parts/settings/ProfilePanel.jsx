// Shared field-group renderer for the onboarding modal's steps and the
// Settings profile panel. Purely presentational: the caller owns state,
// the PUT call, and error display, so the two surfaces can never disagree
// about what "save" means — server/tools/profile.js is the only validator.
//
// Field keys, grouping, and enum values mirror server/tools/profile.js's
// PROFILE_FIELDS / FILING_STATUSES / EMPLOYMENT / RISK exactly (9 fields,
// no duplicates). The lists below are for building <option> labels only —
// they do not re-implement any validation rule.

export const FILING_STATUSES = [
  { value: 'single', label: 'Single' },
  { value: 'married_joint', label: 'Married filing jointly' },
  { value: 'married_separate', label: 'Married filing separately' },
  { value: 'head_of_household', label: 'Head of household' },
];
export const EMPLOYMENT = [
  { value: 'employed', label: 'Employed' },
  { value: 'self_employed', label: 'Self-employed' },
  { value: 'contract', label: 'Contract' },
  { value: 'student', label: 'Student' },
  { value: 'unemployed', label: 'Unemployed' },
];
export const RISK = [
  { value: 'conservative', label: 'Conservative' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'aggressive', label: 'Aggressive' },
];

export const PROFILE_STEPS = [
  { id: 'about', title: 'About you', fields: ['name', 'age', 'state', 'filing_status'] },
  { id: 'income', title: 'Income', fields: ['employment_status', 'gross_salary', 'income_end_date'] },
  { id: 'horizon', title: 'Horizon', fields: ['retirement_age', 'risk_tolerance'] },
];

export const ALL_PROFILE_FIELDS = PROFILE_STEPS.flatMap((s) => s.fields);

// Sensible, always-valid defaults for fields that would otherwise start
// blank — this is what makes "Next" work without forcing the user to type
// anything they don't have handy yet ("Skip for now" covers the rest).
export const PROFILE_DEFAULTS = {
  name: '',
  age: '',
  state: 'AZ',
  filing_status: 'single',
  employment_status: 'employed',
  gross_salary: '',
  income_end_date: '',
  retirement_age: '65',
  risk_tolerance: 'moderate',
};

const FIELD_META = {
  name: { label: 'Name', type: 'text' },
  age: { label: 'Age', type: 'number', min: 13, max: 120 },
  state: {
    label: 'State',
    type: 'state',
    hint: "State income tax rate. Leave it at AZ if you're not sure.",
  },
  filing_status: { label: 'Tax filing status', type: 'select', options: FILING_STATUSES },
  employment_status: { label: 'Employment status', type: 'select', options: EMPLOYMENT },
  gross_salary: {
    label: 'Gross annual salary',
    type: 'number',
    min: 0,
    hint: 'Your salary before taxes. We use it for take-home, offers and raises — it never leaves this laptop.',
  },
  income_end_date: {
    label: 'Income end date',
    type: 'date',
    hint: "If your income has an end date — a contract or a planned exit — tell us and runway will account for it.",
  },
  retirement_age: { label: 'Target retirement age', type: 'number', min: 30, max: 100 },
  risk_tolerance: {
    label: 'Risk tolerance',
    type: 'select',
    options: RISK,
    hint: "How you'd react to a market drop — shapes the growth assumptions the models use.",
  },
};

// Builds a PUT /api/plan/profile body from local form state. Blank optional
// fields are omitted rather than sent as 0/'' so leaving them empty and
// moving on never trips the server's range checks; income_end_date is the
// one field where blank has a real meaning (no end date) so it's sent as
// an explicit null, which the server accepts.
export function buildProfilePayload(values, fields = ALL_PROFILE_FIELDS) {
  const payload = {};
  for (const key of fields) {
    const raw = values[key];
    if (key === 'income_end_date') { payload[key] = raw ? raw : null; continue; }
    if (raw === '' || raw === undefined || raw === null) continue;
    payload[key] = raw;
  }
  return payload;
}

function Field({ fieldKey, value, onChange, inputRef, idPrefix }) {
  const meta = FIELD_META[fieldKey];
  const displayValue = value ?? '';
  const id = `${idPrefix}-${fieldKey}`;

  return (
    <div style={{ marginBottom: 14 }}>
      <label className="m-input-label" htmlFor={id}>{meta.label}</label>
      {meta.type === 'select' ? (
        <select id={id} ref={inputRef} className="m-input" value={displayValue} onChange={(e) => onChange(e.target.value)}>
          {meta.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : meta.type === 'state' ? (
        <input
          id={id} ref={inputRef} className="m-input" style={{ width: 80, textTransform: 'uppercase' }}
          maxLength={2} value={displayValue} onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
      ) : (
        <input
          id={id} ref={inputRef} className="m-input" type={meta.type}
          min={meta.min} max={meta.max} value={displayValue}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {meta.hint && <div style={{ fontSize: 12, color: 'var(--m-muted)', marginTop: 4, lineHeight: 1.4 }}>{meta.hint}</div>}
    </div>
  );
}

/**
 * @param {{id:string,title:string,fields:string[]}[]} steps  one or more
 *   PROFILE_STEPS groups to render (the onboarding modal passes one step
 *   at a time; Settings passes all three).
 * @param {object} values  controlled field values, keyed by PROFILE_FIELDS.
 * @param {(key:string, value:string)=>void} onChange
 * @param {import('react').Ref} [firstFieldRef]  attached to the first input
 *   of the first group, for initial-focus-on-open.
 * @param {string} [idPrefix]  namespaces input ids so the modal and the
 *   Settings panel can be mounted at the same time without colliding.
 */
export default function ProfilePanel({ steps = PROFILE_STEPS, values, onChange, firstFieldRef, idPrefix = 'profile' }) {
  return (
    <div>
      {steps.map((step, si) => (
        <div key={step.id} style={{ marginBottom: si < steps.length - 1 ? 20 : 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)', marginBottom: 10 }}>{step.title}</div>
          {step.fields.map((key, fi) => (
            <Field
              key={key}
              fieldKey={key}
              value={values[key]}
              onChange={(v) => onChange(key, v)}
              inputRef={si === 0 && fi === 0 ? firstFieldRef : undefined}
              idPrefix={idPrefix}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
