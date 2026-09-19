import { useState } from 'react';
import { useApi } from '../../../../../lib/query';

const CADENCES = ['monthly', 'biweekly', 'weekly', 'quarterly', 'annual'];
const PERIODS = ['monthly', 'weekly', 'biweekly', 'annual'];
const KINDS = ['bill', 'income'];

const ACTION_COPY = {
  create_goal: 'Create a savings goal',
  set_category_budget: 'Set a category budget',
  add_recurring: 'Add a recurring bill or income',
  enable_rollover: "Turn on a budget's rollover",
  create_rule: 'Create a categorization rule',
  export_backup: 'Export a backup',
};

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Pre-fills every field from the user's own computed variables (never an
// invented number) — the user can edit anything before confirming, and
// nothing is written until they press Confirm. See server/learn/apply.js
// for what each action actually validates and writes.
export function buildDefaults(action, variables) {
  const v = (name) => variables?.[name]?.value;
  if (action === 'create_goal') {
    const target = toNum(v('ef_target'), 6000);
    const surplus = toNum(v('monthly_surplus'), 0);
    return { name: 'Emergency Fund', target, current: 0, monthly_contribution: surplus > 0 ? Math.round(surplus) : '', target_date: '', linked_account_id: '' };
  }
  if (action === 'set_category_budget') {
    const top = (v('budget_variance_top3') || [])[0];
    return { category_id: top?.category_id || '', period: 'monthly', limit: top ? Math.round(Math.max(top.limit || 0, top.spent || 0)) : 200, rollover: false };
  }
  if (action === 'add_recurring') {
    // `largest_outflow.amount` is a 90-day TOTAL for the payee (see
    // server/money/runway.js), not a single bill amount — pre-filling it
    // straight into a monthly recurring amount silently writes a guess that
    // can be several times the real bill (e.g. rent posted 3x in 90 days).
    // The payee name is safe to carry over; the amount is left for the user
    // to enter from the actual bill.
    const outflow = v('largest_outflow') || {};
    return { payee: outflow.payee || '', amount: '', cadence: 'monthly', kind: 'bill', next_date: '', account_id: '' };
  }
  if (action === 'enable_rollover') {
    return { budget_id: '' };
  }
  if (action === 'create_rule') {
    const outflow = v('largest_outflow') || {};
    return { match: outflow.payee || '', category_id: '', tag: '' };
  }
  return {};
}

// Drops blank-string optional fields (the server's validators treat a
// present-but-empty optional field as an error, not "unset" — see
// server/middleware/validators.js's isMoney/isDate checks) and coerces the
// numeric fields each action expects.
const NUMERIC_FIELDS = new Set(['target', 'current', 'monthly_contribution', 'limit', 'amount']);
function cleanParams(action, form) {
  const out = {};
  for (const [k, val] of Object.entries(form)) {
    if (val === '' || val === null || val === undefined) continue;
    out[k] = NUMERIC_FIELDS.has(k) ? Number(val) : val;
  }
  if (action === 'set_category_budget') out.rollover = !!form.rollover;
  return out;
}

// Names the variable(s) each action's buildDefaults() actually draws its
// pre-fill from — used to decide whether the "pre-filled from your own
// numbers" claim below is true, or whether it's actually running on
// SAMPLE_DATA (server/learn/variables.js) and must say so instead.
const SOURCE_VARS = {
  create_goal: ['ef_target', 'monthly_surplus'],
  set_category_budget: ['budget_variance_top3'],
  add_recurring: ['largest_outflow'],
  create_rule: ['largest_outflow'],
  enable_rollover: [],
  export_backup: [],
};

function Field({ label, children }) {
  return (
    <div>
      <label className="m-input-label">{label}</label>
      {children}
    </div>
  );
}

// True when any variable this action's pre-fill draws from is running on
// SAMPLE_DATA rather than the user's own numbers (server/learn/variables.js).
export function usesSampleData(action, variables) {
  return (SOURCE_VARS[action] || []).some((name) => variables?.[name]?.sample);
}

export default function ApplyConfirm({ action, variables, onCancel, onConfirm, submitting }) {
  const [form, setForm] = useState(() => buildDefaults(action, variables));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const isSample = usesSampleData(action, variables);

  const needsCategories = action === 'set_category_budget' || action === 'create_rule';
  const needsAccounts = action === 'create_goal' || action === 'add_recurring';
  const needsBudgets = action === 'enable_rollover';
  const { data: catData } = useApi('money/categories', { enabled: needsCategories });
  const { data: acctData } = useApi('money/accounts', { enabled: needsAccounts });
  const { data: budgetData } = useApi('money/budgets', { enabled: needsBudgets });
  const categories = catData?.categories || [];
  const accounts = acctData?.accounts || [];
  const budgets = budgetData?.budgets || [];

  function submit(e) {
    e.preventDefault();
    onConfirm(cleanParams(action, form));
  }

  return (
    <form onSubmit={submit} className="m-card m-card-no-hover" style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--m-ink)' }}>{ACTION_COPY[action] || action}</div>
      <div style={{ fontSize: 12, color: 'var(--m-ink-2)' }}>
        {isSample
          ? "These are pre-filled from sample figures, not your own numbers — add accounts and transactions to personalize this. Review and edit before confirming; nothing is written until you confirm."
          : "Review and edit these values — they're pre-filled from your own numbers. Nothing is written until you confirm."}
      </div>

      {action === 'create_goal' && (
        <>
          <Field label="Goal name"><input className="m-input" value={form.name} onChange={set('name')} required /></Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Target amount"><input className="m-input" type="number" min="0.01" step="0.01" value={form.target} onChange={set('target')} required /></Field>
            <Field label="Starting balance"><input className="m-input" type="number" step="0.01" value={form.current} onChange={set('current')} /></Field>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Monthly contribution (optional)"><input className="m-input" type="number" step="0.01" value={form.monthly_contribution} onChange={set('monthly_contribution')} /></Field>
            <Field label="Target date (optional)"><input className="m-input" type="date" value={form.target_date} onChange={set('target_date')} /></Field>
          </div>
          {needsAccounts && (
            <Field label="Link to account (optional)">
              <select className="m-input" value={form.linked_account_id} onChange={set('linked_account_id')}>
                <option value="">None</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
        </>
      )}

      {action === 'set_category_budget' && (
        <>
          <Field label="Category">
            <select className="m-input" value={form.category_id} onChange={set('category_id')} required>
              <option value="" disabled>Choose a category…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Period">
              <select className="m-input" value={form.period} onChange={set('period')}>
                {PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Limit"><input className="m-input" type="number" min="0" step="0.01" value={form.limit} onChange={set('limit')} required /></Field>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--m-ink-2)' }}>
            <input type="checkbox" checked={form.rollover} onChange={set('rollover')} /> Roll over unused budget to next period
          </label>
        </>
      )}

      {action === 'add_recurring' && (
        <>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Payee"><input className="m-input" value={form.payee} onChange={set('payee')} required /></Field>
            <Field label="Amount"><input className="m-input" type="number" step="0.01" min="0.01" value={form.amount} onChange={set('amount')} required /></Field>
          </div>
          <div style={{ fontSize: 12, color: 'var(--m-ink-2)' }}>
            Enter the actual bill amount — the lesson's outflow figure is a 90-day total, not a single month's charge, so it isn't pre-filled here.
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Cadence">
              <select className="m-input" value={form.cadence} onChange={set('cadence')}>
                {CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Kind">
              <select className="m-input" value={form.kind} onChange={set('kind')}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Next date (optional)"><input className="m-input" type="date" value={form.next_date} onChange={set('next_date')} /></Field>
            {needsAccounts && (
              <Field label="Account (optional)">
                <select className="m-input" value={form.account_id} onChange={set('account_id')}>
                  <option value="">None</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            )}
          </div>
        </>
      )}

      {action === 'enable_rollover' && (
        <Field label="Budget">
          <select className="m-input" value={form.budget_id} onChange={set('budget_id')} required>
            <option value="" disabled>Choose a budget…</option>
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>{(categories.find((c) => c.id === b.category_id)?.name) || b.category_id} — {b.period}, limit ${b.limit}</option>
            ))}
          </select>
          {!budgets.length && <div style={{ fontSize: 12, color: 'var(--m-muted)', marginTop: 4 }}>No budgets yet — set one first with a "set a category budget" lesson.</div>}
        </Field>
      )}

      {action === 'create_rule' && (
        <>
          <Field label="Match text (payee contains)"><input className="m-input" value={form.match} onChange={set('match')} required /></Field>
          <Field label="Category">
            <select className="m-input" value={form.category_id} onChange={set('category_id')} required>
              <option value="" disabled>Choose a category…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Tag (optional)"><input className="m-input" value={form.tag} onChange={set('tag')} /></Field>
        </>
      )}

      {action === 'export_backup' && (
        <div style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>
          This takes a snapshot backup of your data right now. It doesn't change anything, so there's nothing to undo afterward.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button type="button" className="m-btn m-btn-secondary m-btn-sm" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button type="submit" className="m-btn m-btn-primary m-btn-sm" disabled={submitting}>{submitting ? 'Applying…' : 'Confirm'}</button>
      </div>
    </form>
  );
}
