import { useEffect, useState, useRef } from 'react';
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
import CustomFieldInputs from './parts/CustomFieldInputs';
import CustomFieldFilters from './parts/CustomFieldFilters';
import { useApi } from '../../../lib/query';
import { fieldsFor, matchesFilter } from '../../../lib/customFields';

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
  const [cfFilters, setCfFilters] = useState({});

  const { data: settings } = useApi('settings');

  // State: add form
  const [addForm, setAddForm] = useState({
    date: new Date().toISOString().split('T')[0],
    amount: '',
    payee: '',
    account_id: '',
    category_id: '',
    note: '',
    custom: {},
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

  // State: file import (OFX / QIF)
  const [importFormat, setImportFormat] = useState('csv'); // 'csv' | 'ofx' | 'qif'
  const [fileContent, setFileContent] = useState('');
  const [fileName, setFileName] = useState('');

  // State: inline cell edit + row selection + bulk
  const [editingCell, setEditingCell] = useState(null); // { id, field }
  const [editValue, setEditValue] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkCat, setBulkCat] = useState('');
  const savingRef = useRef(false);

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
    if (!fieldsFor(settings, 'transaction').every(f => matchesFilter(txn, f, cfFilters[f.id]))) return false;
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
        custom: addForm.custom || {},
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
          custom: {},
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

  // Inline cell editing (date, payee, amount via text inputs; category via select)
  function startEdit(txn, field) {
    setEditingCell({ id: txn.id, field });
    setEditValue(field === 'amount' ? String(txn.amount ?? '') : (txn[field] ?? ''));
  }
  function cancelEdit() {
    setEditingCell(null);
    setEditValue('');
  }
  async function saveField(id, field, rawValue) {
    if (savingRef.current) return;
    let value = rawValue;
    if (field === 'amount') {
      value = parseFloat(rawValue);
      if (Number.isNaN(value)) { cancelEdit(); return; }
    }
    savingRef.current = true;
    try {
      const res = await fetch(`/api/money/transactions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) await loadAllData();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      savingRef.current = false;
      setEditingCell(null);
      setEditValue('');
    }
  }
  function commitEdit() {
    if (editingCell) saveField(editingCell.id, editingCell.field, editValue);
  }

  // Row selection
  function toggleRow(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelectedIds(prev =>
      prev.size === filteredTransactions.length && prev.size > 0
        ? new Set()
        : new Set(filteredTransactions.map(t => t.id))
    );
  }
  function clearSelection() { setSelectedIds(new Set()); }

  // Bulk ops
  async function bulkSetCategory(categoryId) {
    if (!categoryId || !selectedIds.size) return;
    await fetch('/api/money/transactions/bulk-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selectedIds], updates: { category_id: categoryId } }),
    });
    setBulkCat('');
    clearSelection();
    await loadAllData();
  }
  async function bulkDelete() {
    if (!selectedIds.size) return;
    if (!confirm(`Delete ${selectedIds.size} transaction(s)?`)) return;
    await fetch('/api/money/transactions/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selectedIds] }),
    });
    clearSelection();
    await loadAllData();
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

  // OFX / QIF file import — read as text client-side, post as JSON (no upload middleware)
  function onFilePick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFileName(file.name);
    setCsvError(null);
    setCsvResult(null);
    const reader = new FileReader();
    reader.onload = () => setFileContent(String(reader.result || ''));
    reader.readAsText(file);
  }
  async function handleFileImport() {
    if (!csvAccount) { setCsvError('Select an account'); return; }
    if (!fileContent) { setCsvError('Choose a file first'); return; }
    setCsvError(null);
    setCsvImporting(true);
    try {
      const res = await fetch('/api/money/transactions/import-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: csvAccount, format: importFormat, content: fileContent }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Import failed');
      setCsvResult(out);
      setFileContent('');
      setFileName('');
      await loadAllData();
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
                <CustomFieldFilters entity="transaction" value={cfFilters} onChange={setCfFilters} />
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
            <>
              {selectedIds.size > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12, padding: '10px 14px', background: 'var(--m-surface-2)', border: '1px solid var(--m-border)', borderRadius: 'var(--m-radius)' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)' }}>{selectedIds.size} selected</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Tag size={14} style={{ color: 'var(--m-muted)' }} />
                    <select className="m-input" value={bulkCat} onChange={e => bulkSetCategory(e.target.value)} style={{ fontSize: 13, padding: '4px 8px' }}>
                      <option value="">Set category…</option>
                      {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                    </select>
                  </div>
                  <button className="m-btn m-btn-secondary m-btn-sm" onClick={bulkDelete}><Trash2 size={14} style={{ marginRight: 4 }} /> Delete</button>
                  <button className="m-btn m-btn-ghost m-btn-sm" onClick={clearSelection}>Clear</button>
                </div>
              )}
              <Card className="m-card-sm m-scroll" style={{ overflowX: 'auto', maxHeight: '600px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--m-border)', textAlign: 'left' }}>
                      <th style={{ padding: '12px', width: 36 }}>
                        <input type="checkbox" checked={filteredTransactions.length > 0 && selectedIds.size === filteredTransactions.length} onChange={toggleAll} aria-label="Select all" style={{ cursor: 'pointer' }} />
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
                      const editing = field => editingCell && editingCell.id === txn.id && editingCell.field === field;
                      const cellInput = (field, type, align) => (
                        <input autoFocus type={type} step={type === 'number' ? '0.01' : undefined} className="m-input"
                          value={editValue} onChange={e => setEditValue(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                          onBlur={commitEdit}
                          style={{ fontSize: 13, padding: '4px 6px', width: '100%', textAlign: align || 'left' }} />
                      );
                      const display = (field, node) => (
                        <div onClick={() => startEdit(txn, field)} title="Click to edit" style={{ cursor: 'text', padding: '2px 4px', borderRadius: 4, minHeight: 20 }}>{node}</div>
                      );
                      return (
                        <tr key={txn.id} style={{ borderBottom: '1px solid var(--m-border)', backgroundColor: sel ? 'rgba(0,113,227,0.08)' : (idx % 2 === 0 ? 'transparent' : 'rgba(0,113,227,0.02)') }}>
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            <input type="checkbox" checked={sel} onChange={() => toggleRow(txn.id)} aria-label="Select row" style={{ cursor: 'pointer' }} />
                          </td>
                          <td style={{ padding: '8px 12px', color: 'var(--m-ink)', fontVariantNumeric: 'tabular-nums' }}>
                            {editing('date') ? cellInput('date', 'date') : display('date', new Date(txn.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}
                          </td>
                          <td style={{ padding: '8px 12px', color: 'var(--m-ink)' }}>
                            {editing('payee') ? cellInput('payee', 'text') : display('payee', txn.payee || '—')}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            {editing('category_id') ? (
                              <select autoFocus className="m-input" value={editValue} onChange={e => { setEditValue(e.target.value); saveField(txn.id, 'category_id', e.target.value); }} onBlur={cancelEdit} style={{ fontSize: 12, padding: '4px 8px' }}>
                                <option value="">Uncategorized</option>
                                {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                              </select>
                            ) : (
                              <div onClick={() => startEdit(txn, 'category_id')} title="Click to edit" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 6, background: 'var(--m-surface-2)', cursor: 'pointer', color: getCategoryColor(txn.category_id), fontSize: 12, fontWeight: 500 }}>
                                <Tag size={12} />{getCategoryLabel(txn.category_id)}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '8px 12px', color: 'var(--m-ink-2)', fontSize: 13 }}>{getAccountLabel(txn.account_id)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                            {editing('amount') ? cellInput('amount', 'number', 'right') : (
                              <div onClick={() => startEdit(txn, 'amount')} title="Click to edit" style={{ cursor: 'text' }}>
                                <Money value={txn.amount} className={txn.amount > 0 ? 'positive' : 'negative'} style={{ color: txn.amount > 0 ? 'var(--m-green)' : 'var(--m-red)', fontWeight: 600 }} />
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            <button className="m-btn m-btn-icon m-btn-ghost m-btn-sm" onClick={() => handleDeleteTransaction(txn.id)} title="Delete" style={{ width: 32, height: 32, padding: 0 }}><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            </>
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
                <CustomFieldInputs entity="transaction" value={addForm.custom} onChange={(c) => setAddForm({ ...addForm, custom: c })} />
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
                <label className="m-input-label">Format</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['csv', 'ofx', 'qif'].map(fmt => (
                    <button key={fmt} type="button" onClick={() => { setImportFormat(fmt); setCsvError(null); setCsvResult(null); }}
                      className={`m-btn m-btn-sm ${importFormat === fmt ? 'm-btn-primary' : 'm-btn-secondary'}`}>
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {importFormat !== 'csv' && (
                <div>
                  <label className="m-input-label">{importFormat.toUpperCase()} file</label>
                  <input type="file" accept={importFormat === 'ofx' ? '.ofx,.qfx' : '.qif'} onChange={onFilePick} className="m-input" style={{ padding: 8 }} />
                  {fileName && <div style={{ fontSize: 12, color: 'var(--m-ink-2)', marginTop: 6 }}>Loaded: {fileName}{fileContent ? '' : ' (reading…)'}</div>}
                </div>
              )}

              {importFormat === 'csv' && (<>
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
              </>)}

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
                  onClick={importFormat === 'csv' ? handleCsvImport : handleFileImport}
                  disabled={csvImporting || !csvAccount || (importFormat === 'csv' ? !csvText.trim() : !fileContent)}
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
