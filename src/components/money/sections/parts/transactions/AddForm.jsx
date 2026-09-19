import CustomFieldInputs from '../CustomFieldInputs';

export default function AddForm({
  form,
  categories,
  accounts,
  settings,
  loading,
  error,
  onSubmit,
  onCancel,
  onChange,
}) {
  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      account_id: form.account_id,
      date: form.date,
      amount: parseFloat(form.amount),
      payee: form.payee,
      category_id: form.category_id || undefined,
      note: form.note || undefined,
      custom: form.custom || {},
    };
    await onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        <div>
          <label className="m-input-label">Date *</label>
          <input
            type="date"
            className="m-input"
            value={form.date}
            onChange={e => onChange({ ...form, date: e.target.value })}
            required
          />
        </div>

        <div>
          <label className="m-input-label">Amount ($ or -$) *</label>
          <input
            type="number"
            step="0.01"
            className="m-input"
            placeholder="e.g. 50.00 or -25.50"
            value={form.amount}
            onChange={e => onChange({ ...form, amount: e.target.value })}
            required
          />
        </div>

        <div>
          <label className="m-input-label">Payee *</label>
          <input
            type="text"
            className="m-input"
            placeholder="e.g. Whole Foods, Uber"
            value={form.payee}
            onChange={e => onChange({ ...form, payee: e.target.value })}
            required
          />
        </div>

        <div>
          <label className="m-input-label">Account *</label>
          <select
            className="m-input"
            value={form.account_id}
            onChange={e => onChange({ ...form, account_id: e.target.value })}
            required
            style={{ appearance: 'none', paddingRight: '28px', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23475569'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 8px center', backgroundRepeat: 'no-repeat', backgroundSize: '16px' }}
          >
            <option value="">Select account</option>
            {accounts.map(acc => (
              <option key={acc.id} value={acc.id}>{acc.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="m-input-label">Category (optional)</label>
          <select
            className="m-input"
            value={form.category_id}
            onChange={e => onChange({ ...form, category_id: e.target.value })}
            style={{ appearance: 'none', paddingRight: '28px', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23475569'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 8px center', backgroundRepeat: 'no-repeat', backgroundSize: '16px' }}
          >
            <option value="">Auto-categorize</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>

        <CustomFieldInputs entity="transaction" value={form.custom} onChange={(c) => onChange({ ...form, custom: c })} />
      </div>

      <div>
        <label className="m-input-label">Note (optional)</label>
        <textarea
          className="m-input"
          placeholder="e.g. Groceries for the week"
          value={form.note}
          onChange={e => onChange({ ...form, note: e.target.value })}
          rows="3"
          style={{ resize: 'vertical' }}
        />
      </div>

      {error && (
        <div style={{ padding: '12px', background: 'var(--m-red-bg)', borderRadius: '8px', color: 'var(--m-red)', fontSize: '14px' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px' }}>
        <button type="submit" className="m-btn m-btn-primary" disabled={loading}>
          {loading ? 'Adding...' : 'Add Transaction'}
        </button>
        <button
          type="button"
          className="m-btn m-btn-secondary"
          onClick={onCancel}
          disabled={loading}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
