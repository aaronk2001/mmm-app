import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { TrendingDown, Plus } from 'lucide-react';
import SectionHeader from '../shared/SectionHeader';
import { confirmDialog } from '../../../lib/confirm';
import { toast } from '../../../lib/toast';
import Card from '../shared/Card';
import EmptyState from '../shared/EmptyState';
import { useApi, api } from '../../../lib/query';
import { fieldsFor, matchesFilter } from '../../../lib/customFields';
import { useTransactionsData } from './parts/transactions/useTransactionsData';
import FiltersBar from './parts/transactions/FiltersBar';
import TransactionsTable from './parts/transactions/TransactionsTable';
import AddForm from './parts/transactions/AddForm';
import ImportPanel from './parts/transactions/ImportPanel';

export default function Transactions() {
  const { data: settings } = useApi('settings');
  const {
    transactions,
    categories,
    accounts,
    loading,
    error,
    handleAddTransaction,
    handleDeleteTransaction,
    saveField,
    bulkSetCategory,
    bulkDelete,
    seedSample,
    loadAllData,
    savingRef,
  } = useTransactionsData();

  // UI state
  const [activeTab, setActiveTab] = useState('list');

  // List filters
  const [filterAccount, setFilterAccount] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterFromDate, setFilterFromDate] = useState('');
  const [filterToDate, setFilterToDate] = useState('');
  const [cfFilters, setCfFilters] = useState({});

  // Add form
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

  // Import state
  const [csvText, setCsvText] = useState('');
  const [csvAccount, setCsvAccount] = useState('');
  const [csvMapping, setCsvMapping] = useState({ date: 0, amount: 1, payee: 2 });
  const [csvPreview, setCsvPreview] = useState([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvError, setCsvError] = useState(null);
  const [csvResult, setCsvResult] = useState(null);
  const [importFormat, setImportFormat] = useState('csv');
  const [fileContent, setFileContent] = useState('');
  const [fileName, setFileName] = useState('');

  // Inline edit + selection
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkCat, setBulkCat] = useState('');

  // Apply filters
  const filteredTransactions = transactions.filter(txn => {
    if (filterAccount !== 'all' && txn.account_id !== filterAccount) return false;
    if (filterCategory !== 'all' && txn.category_id !== filterCategory) return false;
    if (filterFromDate && txn.date < filterFromDate) return false;
    if (filterToDate && txn.date > filterToDate) return false;
    if (!fieldsFor(settings, 'transaction').every(f => matchesFilter(txn, f, cfFilters[f.id]))) return false;
    return true;
  });

  // Add transaction handler
  async function handleAdd() {
    setAddError(null);
    setAddLoading(true);
    const payload = {
      account_id: addForm.account_id,
      date: addForm.date,
      amount: parseFloat(addForm.amount),
      payee: addForm.payee,
      category_id: addForm.category_id || undefined,
      note: addForm.note || undefined,
      custom: addForm.custom || {},
    };
    const success = await handleAddTransaction(payload);
    setAddLoading(false);
    if (success) {
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
  }

  // Delete transaction handler with confirmation
  async function handleDelete(txnId) {
    if (!(await confirmDialog({ message: 'Delete this transaction?', confirmLabel: 'Delete' }))) return;
    await handleDeleteTransaction(txnId);
  }

  // Inline edit handlers
  function startEdit(txn, field) {
    setEditingCell({ id: txn.id, field });
    setEditValue(field === 'amount' ? String(txn.amount ?? '') : (txn[field] ?? ''));
  }

  function cancelEdit() {
    setEditingCell(null);
    setEditValue('');
  }

  async function commitSaveField(id, field, value) {
    if (savingRef.current) return;
    if (field === 'amount') {
      value = parseFloat(value);
      if (Number.isNaN(value)) {
        cancelEdit();
        return;
      }
    }
    await saveField(id, field, value);
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

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Bulk ops
  async function handleBulkSetCategory(categoryId) {
    if (!categoryId || !selectedIds.size) return;
    const success = await bulkSetCategory([...selectedIds], categoryId);
    if (success) {
      setBulkCat('');
      clearSelection();
    }
  }

  async function handleBulkDelete() {
    if (!selectedIds.size) return;
    if (!(await confirmDialog({ message: `Delete ${selectedIds.size} transaction(s)?`, confirmLabel: 'Delete' }))) return;
    const success = await bulkDelete([...selectedIds]);
    if (success) clearSelection();
  }

  // CSV import
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

      const result = await api('money/transactions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: csvAccount, rows }),
      });

      setCsvResult(result);
      setCsvText('');
      setCsvPreview([]);
      await loadAllData();
      toast.success(`Imported ${result.imported} transactions`);
    } catch (err) {
      setCsvError(err.message);
    } finally {
      setCsvImporting(false);
    }
  }

  // File import (OFX/QIF)
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
    if (!csvAccount) {
      setCsvError('Select an account');
      return;
    }
    if (!fileContent) {
      setCsvError('Choose a file first');
      return;
    }
    setCsvError(null);
    setCsvImporting(true);
    try {
      const out = await api('money/transactions/import-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: csvAccount, format: importFormat, content: fileContent }),
      });
      setCsvResult(out);
      setFileContent('');
      setFileName('');
      await loadAllData();
      toast.success(`Imported ${out.imported} transactions`);
    } catch (err) {
      setCsvError(err.message);
    } finally {
      setCsvImporting(false);
    }
  }

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
          {transactions.length > 0 && (
            <Card className="m-card-sm" style={{ marginBottom: '16px' }}>
              <FiltersBar
                accounts={accounts}
                categories={categories}
                filterAccount={filterAccount}
                filterCategory={filterCategory}
                filterFromDate={filterFromDate}
                filterToDate={filterToDate}
                cfFilters={cfFilters}
                settings={settings}
                onAccountChange={setFilterAccount}
                onCategoryChange={setFilterCategory}
                onFromDateChange={setFilterFromDate}
                onToDateChange={setFilterToDate}
                onCfFiltersChange={setCfFilters}
              />
            </Card>
          )}

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
                    onClick={seedSample}
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
                    <select className="m-input" value={bulkCat} onChange={e => handleBulkSetCategory(e.target.value)} style={{ fontSize: 13, padding: '4px 8px' }}>
                      <option value="">Set category…</option>
                      {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                    </select>
                  </div>
                  <button className="m-btn m-btn-secondary m-btn-sm" onClick={handleBulkDelete}>Delete</button>
                  <button className="m-btn m-btn-ghost m-btn-sm" onClick={clearSelection}>Clear</button>
                </div>
              )}
              <Card className="m-card-sm">
                <TransactionsTable
                  filteredTransactions={filteredTransactions}
                  selectedIds={selectedIds}
                  editingCell={editingCell}
                  editValue={editValue}
                  categories={categories}
                  accounts={accounts}
                  savingRef={savingRef}
                  onToggleRow={toggleRow}
                  onToggleAll={toggleAll}
                  onStartEdit={startEdit}
                  onCancelEdit={cancelEdit}
                  onEditValueChange={setEditValue}
                  onSaveField={commitSaveField}
                  onDelete={handleDelete}
                />
              </Card>
            </>
          )}
        </motion.div>
      )}

      {/* ADD TAB */}
      {activeTab === 'add' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
          <Card>
            <AddForm
              form={addForm}
              categories={categories}
              accounts={accounts}
              settings={settings}
              loading={addLoading}
              error={addError}
              onSubmit={handleAdd}
              onCancel={() => setActiveTab('list')}
              onChange={setAddForm}
            />
          </Card>
        </motion.div>
      )}

      {/* IMPORT TAB */}
      {activeTab === 'import' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
          <Card>
            <ImportPanel
              accounts={accounts}
              csvAccount={csvAccount}
              importFormat={importFormat}
              csvText={csvText}
              csvMapping={csvMapping}
              csvPreview={csvPreview}
              csvImporting={csvImporting}
              csvError={csvError}
              csvResult={csvResult}
              fileName={fileName}
              fileContent={fileContent}
              onAccountChange={setCsvAccount}
              onFormatChange={(fmt) => {
                setImportFormat(fmt);
                setCsvError(null);
                setCsvResult(null);
              }}
              onFilePick={onFilePick}
              onCsvTextChange={handleCsvTextChange}
              onMappingChange={setCsvMapping}
              onImport={importFormat === 'csv' ? handleCsvImport : handleFileImport}
              onCancel={() => {
                setCsvText('');
                setCsvPreview([]);
                setActiveTab('list');
              }}
            />
          </Card>
        </motion.div>
      )}
    </div>
  );
}
