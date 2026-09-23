import { Trash2, Tag } from 'lucide-react';
import Term from '../../../shared/Term';
import Money from '../../../shared/Money';
import { parseYmd } from '../../../../../lib/localDate';

export default function TransactionsTable({
  filteredTransactions,
  selectedIds,
  editingCell,
  editValue,
  categories,
  accounts,
  savingRef,
  onToggleRow,
  onToggleAll,
  onStartEdit,
  onCancelEdit,
  onEditValueChange,
  onSaveField,
  onDelete,
}) {
  const getCategoryLabel = categoryId => {
    const cat = categories.find(c => c.id === categoryId);
    return cat ? cat.name : 'Uncategorized';
  };

  const getCategoryColor = categoryId => {
    const cat = categories.find(c => c.id === categoryId);
    return cat && cat.color ? cat.color : 'var(--m-muted)';
  };

  const getAccountLabel = accountId => {
    const acc = accounts.find(a => a.id === accountId);
    return acc ? acc.name : accountId;
  };

  const editing = (txnId, field) => editingCell && editingCell.id === txnId && editingCell.field === field;

  const cellInput = (type, align) => (
    <input autoFocus type={type} step={type === 'number' ? '0.01' : undefined} className="m-input"
      value={editValue} onChange={e => onEditValueChange(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') handleCommitEdit();
        if (e.key === 'Escape') onCancelEdit();
      }}
      onBlur={handleCommitEdit}
      style={{ fontSize: 13, padding: '4px 6px', width: '100%', textAlign: align || 'left' }} />
  );

  const display = (txnId, field, node) => (
    <div onClick={() => onStartEdit(txnId, field)} title="Click to edit" style={{ cursor: 'text', padding: '2px 4px', borderRadius: 4, minHeight: 20 }}>
      {node}
    </div>
  );

  function handleCommitEdit() {
    if (editingCell) {
      let value = editValue;
      if (editingCell.field === 'amount') {
        value = parseFloat(editValue);
        if (Number.isNaN(value)) {
          onCancelEdit();
          return;
        }
      }
      if (!savingRef.current) {
        onSaveField(editingCell.id, editingCell.field, value);
        onCancelEdit();
      }
      // A prior save is still in flight — keep the editor open so the value
      // isn't silently dropped.
    }
  }

  return (
    <div className="m-scroll" style={{ overflowX: 'auto', maxHeight: '600px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--m-border)', textAlign: 'left' }}>
            <th style={{ padding: '12px', width: 36 }}>
              <input type="checkbox" checked={filteredTransactions.length > 0 && selectedIds.size === filteredTransactions.length} onChange={onToggleAll} aria-label="Select all" style={{ cursor: 'pointer' }} />
            </th>
            {['Date', 'Payee', 'Category', 'Account', 'Amount', ''].map((h, i) => (
              <th key={i} style={{ padding: '12px', color: 'var(--m-muted)', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: h === 'Amount' ? 'right' : 'left', width: h === '' ? '48px' : undefined }}>
                {h === 'Category' ? <Term name="category">Category</Term> : h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredTransactions.map((txn, idx) => {
            const sel = selectedIds.has(txn.id);
            return (
              <tr key={txn.id} style={{ borderBottom: '1px solid var(--m-border)', backgroundColor: sel ? 'var(--m-accent-soft)' : (idx % 2 === 0 ? 'transparent' : 'var(--m-table-stripe)') }}>
                <td style={{ padding: '12px', textAlign: 'center' }}>
                  <input type="checkbox" checked={sel} onChange={() => onToggleRow(txn.id)} aria-label="Select row" style={{ cursor: 'pointer' }} />
                </td>
                <td style={{ padding: '8px 12px', color: 'var(--m-ink)', fontVariantNumeric: 'tabular-nums' }}>
                  {editing(txn.id, 'date') ? cellInput('date') : display(txn.id, 'date', parseYmd(txn.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}
                </td>
                <td style={{ padding: '8px 12px', color: 'var(--m-ink)' }}>
                  {editing(txn.id, 'payee') ? cellInput('text') : display(txn.id, 'payee', txn.payee || '—')}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  {editing(txn.id, 'category_id') ? (
                    <select autoFocus className="m-input" value={editValue} onChange={e => {
                      onEditValueChange(e.target.value);
                      if (!savingRef.current) onSaveField(txn.id, 'category_id', e.target.value);
                    }} onBlur={onCancelEdit} style={{ fontSize: 12, padding: '4px 8px' }}>
                      <option value="">Uncategorized</option>
                      {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                    </select>
                  ) : (
                    <div onClick={() => onStartEdit(txn.id, 'category_id')} title="Click to edit" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 6, background: 'var(--m-surface-2)', cursor: 'pointer', color: getCategoryColor(txn.category_id), fontSize: 12, fontWeight: 500 }}>
                      <Tag size={12} />{getCategoryLabel(txn.category_id)}
                    </div>
                  )}
                </td>
                <td style={{ padding: '8px 12px', color: 'var(--m-ink-2)', fontSize: 13 }}>{getAccountLabel(txn.account_id)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                  {editing(txn.id, 'amount') ? cellInput('number', 'right') : (
                    <div onClick={() => onStartEdit(txn.id, 'amount')} title="Click to edit" style={{ cursor: 'text', color: txn.amount > 0 ? 'var(--m-green)' : 'var(--m-red)', fontWeight: 600 }}>
                      <Money value={txn.amount} />
                    </div>
                  )}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                  <button className="m-btn m-btn-icon m-btn-ghost m-btn-sm" onClick={() => onDelete(txn.id)} title="Delete" style={{ width: 32, height: 32, padding: 0 }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
