import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  TrendingDown,
  Plus,
  Upload,
  Trash2,
  Tag,
  X,
  ChevronDown,
} from 'lucide-react';
import SectionHeader from '../shared/SectionHeader';
import Card from '../shared/Card';
import EmptyState from '../shared/EmptyState';
import Term from '../shared/Term';
import Money from '../shared/Money';

/**
 * Transactions (Spending) section.
 *
 * Contract:
 * - No required props
 * - Fetches data from GET /api/money/transactions, /api/money/categories, /api/money/accounts
 * - Renders transaction ledger, add/edit/delete forms, CSV import, filters
 */
export default function Transactions() {
  // State: data
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);

  // State: ui
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('list'); // 'list', 'add', 'import'

  // State: filters
  const [filterAccount, setFilterAccount] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterFromDate, setFilterFromDate] = useState('');
  const [filterToDate, setFilterToDate] = useState('');

  // State: add form
  const [addForm, setAddForm] = useState({
    date: new Date().toISOString().split('T')[0],
    amount: '',
    payee: '',
    account_id: '',
    category_id: '',
    note: '',
  });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState(null);

  // State: csv import
  const [csvText, setCsvText] = useState('');
  const [csvAccount, setCsvAccount] = useState('');
  const [csvMapping, setCsvMapping] = useState({ date: 0, amount: 1, payee: 2 });
  const [csvPreview, setCsvPreview] = useState([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvError, setCsvError] = useState(null);
  const [csvResult, setCsvResult] = useState(null);

  // State: edit inline
  const [editingTxnId, setEditingTxnId] = useState(null);
  const [editingCategory, setEditingCategory] = useState(null);

  // Load data on mount
  useEffect(() => {
    loadAllData();
  }, []);

  async function loadAllData() {
    try {
      setLoading(true);
      setError(null);
      const [txnRes, catRes, accRes] = await Promise.all([
        fetch('/api/money/transactions'),
        fetch('/api/money/categories'),
        fetch('/api/money/accounts'),
      ]);

      if (txnRes.ok) {
        const txnData = await txnRes.json();
        setTransactions(txnData.transactions || []);
      }
      if (catRes.ok) {
        const catData = await catRes.json();
        setCategories(catData.categories || []);
      }
      if (accRes.ok) {
        const accData = await accRes.json();
        setAccounts(accData.accounts || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Apply filters
  const filteredTransactions = transactions.filter(txn => {
    if (filterAccount !== 'all' && txn.account_id !== filterAccount) return false;
    if (filterCategory !== 'all' && txn.category_id !== filterCategory) return false;
    if (filterFromDate && txn.date < filterFromDate) return false;
    if (filterToDate && txn.date > filterToDate) return false;
    return true;
  });

  // Add transaction
  async function handleAddTransaction(e) {
    e.preventDefault();
    setAddError(null);
    setAddLoading(true);

    try {
      const payload = {
        account_id: addForm.account_id,
        date: addForm.date,
        amount: parseFloat(addForm.amount),
        payee: addForm.payee,
        category_id: addForm.category_id || undefined,
        note: addForm.note || undefined,
      };

      const res = await fetch('/api/money/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        await loadAllData();
        setAddForm({
          date: new Date().toISOString().split('T')[0],
          amount: '',
          payee: '',
          account_id: '',
          category_id: '',
          note: '',
        });
        setActiveTab('list');
      } else {
        setAddError('Failed to add transaction');
      }
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAddLoading(false);
    }
  }

  // Delete transaction
  async function handleDeleteTransaction(txnId) {
    if (!confirm('Delete this transaction?')) return;

    try {
      const res = await fetch(`/api/money/transactions/${txnId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await loadAllData();
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  // Update transaction category
  async function handleUpdateCategory(txnId, newCategoryId) {
    try {
      const res = await fetch(`/api/money/transactions/${txnId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: newCategoryId }),
      });

      if (res.ok) {
        await loadAllData();
        setEditingTxnId(null);
      }
    } catch (err) {
      console.error('Update failed:', err);
    }
  }

  // CSV: parse preview
  function handleCsvTextChange(text) {
    setCsvText(text);
    setCsvError(null);
    setCsvResult(null);

    if (!text.trim()) {
      setCsvPreview([]);
      return;
    }

    try {
      const lines = text
        .trim()
        .split('\n')
        .slice(0, 5)
        .map(line => {
          const cols = line.split(',').map(c => c.trim());
          return {
            date: cols[csvMapping.date] || '',
            amount: cols[csvMapping.amount] || '',
            payee: cols[csvMapping.payee] || '',
          };
        });
      setCsvPreview(lines);
    } catch (err) {
      setCsvError('Failed to parse CSV');
    }
  }

  // CSV: import
  async function handleCsvImport() {
    if (!csvAccount) {
      setCsvError('Select an account');
      return;
    }

    setCsvError(null);
    setCsvImporting(true);

    try {
      const rows = csvText
        .trim()
        .split('\n')
        .map(line => {
          const cols = line.split(',').map(c => c.trim());
          return {
            date: cols[csvMapping.date],
            amount: parseFloat(cols[csvMapping.amount]),
            payee: cols[csvMapping.payee],
          };
        });

      const res = await fetch('/api/money/transactions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: csvAccount,
          rows,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        setCsvResult(result);
        setCsvText('');
        setCsvPreview([]);
        await loadAllData();
      } else {
        setCsvError('Import failed');
      }
    } catch (err) {
      setCsvError(err.message);
    } finally {
      setCsvImporting(false);
    }
  }

  // Helpers
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

  if (loading) {
    return (
      <div>
        <SectionHeader icon={TrendingDown} title="Spending" subtitle="Track your transactions" />
        <Card>
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--m-muted)' }}>
            Loading transactions...
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <SectionHeader icon={TrendingDown} title="Spending" subtitle="Track your transactions" />
        <Card style={{ background: 'rgba(220, 38, 38, 0.05)', borderColor: 'var(--m-red)' }}>
          <div style={{ color: 'var(--m-red)', fontWeight: 600 }}>Error: {error}</div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader icon={TrendingDown} title="Spending" subtitle="Track your transactions" />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid var(--m-border)' }}>
        {['list', 'add', 'import'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`m-btn m-btn-ghost m-btn-sm ${activeTab === tab ? 'active' : ''}`}
            style={{
              borderRadius: '0',
              borderBottom: activeTab === tab ? '2px solid var(--m-accent)' : 'transparent',
              color: activeTab === tab ? 'var(--m-accent)' : 'var(--m-ink-2)',
            }}
          >
            {tab === 'list' && 'Transactions'}
            {tab === 'add' && 'Add'}
            {tab === 'import' && 'Import CSV'}
          </button>
        ))}
      </div>

      {/* LIST TAB */}
      {activeTab === 'list' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
          {/* Filters */}
          {transactions.length > 0 && (
            <Card className="m-card-sm" style={{ marginBottom: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div>
                  <label className="m-input-label">Account</label>
                  <select
                    className="m-input"
                    value={filterAccount}
                    onChange={e => setFilterAccount(e.target.value)}
                    style={{ paddingRight: '28px', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23475569'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 8px center', backgroundRepeat: 'no-repeat', backgroundSize: '16px', appearance: 'none' }}
                  >
                    <option value="all">All accounts</option>
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="m-input-label">Category</label>
                  <select
                    className="m-input"
                    value={filterCategory}
                    onChange={e => setFilterCategory(e.target.value)}
                    style={{ paddingRight: '28px', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23475569'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 8px center', backgroundRepeat: 'no-repeat', backgroundSize: '16px', appearance: 'none' }}
                  >
                    <option value="all">All categories</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="m-input-label">From</label>
                  <input
                    type="date"
                    className="m-input"
                    value={filterFromDate}
                    onChange={e => setFilterFromDate(e.target.value)}
                  />
                </div>

                <div>
                  <label className="m-input-label">To</label>
                  <input
                    type="date"
                    className="m-input"
                    value={filterToDate}
                    onChange={e => setFilterToDate(e.target.value)}
                  />
                </div>
              </div>
            </Card>
          )}

          {/* Ledger */}
          {filteredTransactions.length === 0 ? (
            <EmptyState
              icon={TrendingDown}
              title="No transactions yet"
              message="Start tracking your spending by adding your first transaction or importing from CSV."
              action={
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                  <button className="m-btn m-btn-primary m-btn-sm" onClick={() => setActiveTab('add')}>
                    <Plus size={16} /> Add Transaction
                  </button>
                  <button
                    className="m-btn m-btn-secondary m-btn-sm"
                    onClick={() => {
                      // Load sample data if available
                      fetch('/api/money/seed-sample', { method: 'POST' })
                        .then(() => loadAllData())
                        .catch(err => console.error(err));
                    }}
                  >
                    Load Sample
                  </button>
                </div>
              }
            />
          ) : (
            <Card className="m-card-sm m-scroll" style={{ overflowX: 'auto', maxHeight: '600px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--m-border)', textAlign: 'left' }}>
                    <th style={{ padding: '12px', color: 'var(--m-muted)', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Date
                    </th>
                    <th style={{ padding: '12px', color: 'var(--m-muted)', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Payee
                    </th>
                    <th style={{ padding: '12px', color: 'var(--m-muted)', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      <Term name="category">Category</Term>
                    </th>
                    <th style={{ padding: '12px', color: 'var(--m-muted)', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Account
                    </th>
                    <th style={{ padding: '12px', color: 'var(--m-muted)', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>
                      Amount
                    </th>
                    <th style={{ padding: '12px', color: 'var(--m-muted)', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', width: '60px' }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((txn, idx) => (
                    <tr
                      key={txn.id}
                      style={{
                        borderBottom: '1px solid var(--m-border)',
                        backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(0, 113, 227, 0.02)',
                      }}
                    >
                      <td style={{ padding: '12px' }}>
                        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--m-ink)' }}>
                          {new Date(txn.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </td>
                      <td style={{ padding: '12px', color: 'var(--m-ink)' }}>{txn.payee}</td>
                      <td style={{ padding: '12px' }}>
                        {editingTxnId === txn.id ? (
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <select
                              className="m-input"
                              value={editingCategory || txn.category_id || ''}
                              onChange={e => setEditingCategory(e.target.value)}
                              style={{ fontSize: '12px', padding: '4px 8px', flex: 1 }}
                            >
                              <option value="">Uncategorized</option>
                              {categories.map(cat => (
                                <option key={cat.id} value={cat.id}>
                                  {cat.name}
                                </option>
                              ))}
                            </select>
                            <button
                              className="m-btn m-btn-sm m-btn-primary"
                              onClick={() => handleUpdateCategory(txn.id, editingCategory)}
                              style={{ padding: '4px 8px' }}
                            >
                              ✓
                            </button>
                            <button
                              className="m-btn m-btn-sm"
                              onClick={() => setEditingTxnId(null)}
                              style={{ padding: '4px 8px' }}
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              background: 'var(--m-surface-2)',
                              cursor: 'pointer',
                              color: getCategoryColor(txn.category_id),
                              fontSize: '12px',
                              fontWeight: 500,
                            }}
                            onClick={() => {
                              setEditingTxnId(txn.id);
                              setEditingCategory(txn.category_id);
                            }}
                          >
                            <Tag size={12} />
                            {getCategoryLabel(txn.category_id)}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px', color: 'var(--m-ink-2)', fontSize: '13px' }}>
                        {getAccountLabel(txn.account_id)}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        <Money
                          value={txn.amount}
                          className={txn.amount > 0 ? 'positive' : 'negative'}
                          style={{
                            color: txn.amount > 0 ? 'var(--m-green)' : 'var(--m-red)',
                            fontWeight: 600,
                          }}
                        />
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <button
                          className="m-btn m-btn-icon m-btn-ghost m-btn-sm"
                          onClick={() => handleDeleteTransaction(txn.id)}
                          title="Delete"
                          style={{ width: '32px', height: '32px', padding: 0 }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </motion.div>
      )}

      {/* ADD TAB */}
      {activeTab === 'add' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
          <Card>
            <form onSubmit={handleAddTransaction} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div>
                  <label className="m-input-label">Date *</label>
                  <input
                    type="date"
                    className="m-input"
                    value={addForm.date}
                    onChange={e => setAddForm({ ...addForm, date: e.target.value })}
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
                    value={addForm.amount}
                    onChange={e => setAddForm({ ...addForm, amount: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="m-input-label">Payee *</label>
                  <input
                    type="text"
                    className="m-input"
                    placeholder="e.g. Whole Foods, Uber"
                    value={addForm.payee}
                    onChange={e => setAddForm({ ...addForm, payee: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="m-input-label">Account *</label>
                  <select
                    className="m-input"
                    value={addForm.account_id}
                    onChange={e => setAddForm({ ...addForm, account_id: e.target.value })}
                    required
                    style={{ appearance: 'none', paddingRight: '28px', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23475569'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 8px center', backgroundRepeat: 'no-repeat', backgroundSize: '16px' }}
                  >
                    <option value="">Select account</option>
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="m-input-label">Category (optional)</label>
                  <select
                    className="m-input"
                    value={addForm.category_id}
                    onChange={e => setAddForm({ ...addForm, category_id: e.target.value })}
                    style={{ appearance: 'none', paddingRight: '28px', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23475569'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 8px center', backgroundRepeat: 'no-repeat', backgroundSize: '16px' }}
                  >
                    <option value="">Auto-categorize</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="m-input-label">Note (optional)</label>
                <textarea
                  className="m-input"
                  placeholder="e.g. Groceries for the week"
                  value={addForm.note}
                  onChange={e => setAddForm({ ...addForm, note: e.target.value })}
                  rows="3"
                  style={{ resize: 'vertical' }}
                />
              </div>

              {addError && (
                <div style={{ padding: '12px', background: 'rgba(220, 38, 38, 0.05)', borderRadius: '8px', color: 'var(--m-red)', fontSize: '14px' }}>
                  {addError}
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="submit" className="m-btn m-btn-primary" disabled={addLoading}>
                  {addLoading ? 'Adding...' : 'Add Transaction'}
                </button>
                <button
                  type="button"
                  className="m-btn m-btn-secondary"
                  onClick={() => setActiveTab('list')}
                  disabled={addLoading}
                >
                  Cancel
                </button>
              </div>
            </form>
          </Card>
        </motion.div>
      )}

      {/* IMPORT TAB */}
      {activeTab === 'import' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
          <Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label className="m-input-label">Select Account *</label>
                <select
                  className="m-input"
                  value={csvAccount}
                  onChange={e => setCsvAccount(e.target.value)}
                  style={{ appearance: 'none', paddingRight: '28px', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23475569'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 8px center', backgroundRepeat: 'no-repeat', backgroundSize: '16px' }}
                >
                  <option value="">Select account</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="m-input-label">Column Mapping</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                  <div>
                    <span style={{ fontSize: '12px', color: 'var(--m-muted)' }}>Date column (0-based)</span>
                    <input
                      type="number"
                      className="m-input"
                      min="0"
                      value={csvMapping.date}
                      onChange={e => setCsvMapping({ ...csvMapping, date: parseInt(e.target.value) })}
                      style={{ marginTop: '4px' }}
                    />
                  </div>
                  <div>
                    <span style={{ fontSize: '12px', color: 'var(--m-muted)' }}>Amount column</span>
                    <input
                      type="number"
                      className="m-input"
                      min="0"
                      value={csvMapping.amount}
                      onChange={e => setCsvMapping({ ...csvMapping, amount: parseInt(e.target.value) })}
                      style={{ marginTop: '4px' }}
                    />
                  </div>
                  <div>
                    <span style={{ fontSize: '12px', color: 'var(--m-muted)' }}>Payee column</span>
                    <input
                      type="number"
                      className="m-input"
                      min="0"
                      value={csvMapping.payee}
                      onChange={e => setCsvMapping({ ...csvMapping, payee: parseInt(e.target.value) })}
                      style={{ marginTop: '4px' }}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="m-input-label">CSV Data (comma-separated)</label>
                <textarea
                  className="m-input"
                  placeholder="2024-06-21,50.00,Whole Foods&#10;2024-06-20,-25.00,Uber&#10;..."
                  value={csvText}
                  onChange={e => handleCsvTextChange(e.target.value)}
                  rows="6"
                  style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '12px' }}
                />
              </div>

              {csvPreview.length > 0 && (
                <div style={{ padding: '12px', background: 'var(--m-surface-2)', borderRadius: '8px', fontSize: '12px' }}>
                  <div style={{ fontWeight: 600, marginBottom: '8px', color: 'var(--m-ink)' }}>Preview (first 5 rows):</div>
                  {csvPreview.map((row, idx) => (
                    <div key={idx} style={{ marginBottom: '4px', color: 'var(--m-ink-2)' }}>
                      {row.date} | {row.amount} | {row.payee}
                    </div>
                  ))}
                </div>
              )}

              {csvError && (
                <div style={{ padding: '12px', background: 'rgba(220, 38, 38, 0.05)', borderRadius: '8px', color: 'var(--m-red)', fontSize: '14px' }}>
                  {csvError}
                </div>
              )}

              {csvResult && (
                <div style={{ padding: '12px', background: 'rgba(21, 163, 74, 0.05)', borderRadius: '8px', color: 'var(--m-green)', fontSize: '14px' }}>
                  <div style={{ fontWeight: 600 }}>✓ Imported {csvResult.imported} transactions</div>
                  {csvResult.sample && csvResult.sample.length > 0 && (
                    <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--m-ink-2)' }}>
                      {csvResult.sample.slice(0, 3).map((s, idx) => (
                        <div key={idx}>{s.payee} → {s.category_name || 'Other'}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  className="m-btn m-btn-primary"
                  onClick={handleCsvImport}
                  disabled={csvImporting || !csvText.trim() || !csvAccount}
                >
                  {csvImporting ? 'Importing...' : 'Import Transactions'}
                </button>
                <button
                  type="button"
                  className="m-btn m-btn-secondary"
                  onClick={() => {
                    setCsvText('');
                    setCsvPreview([]);
                    setActiveTab('list');
                  }}
                  disabled={csvImporting}
                >
                  Cancel
                </button>
              </div>
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
