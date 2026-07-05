import { useEffect, useState, useRef } from 'react';
import { api } from '../../../../../lib/query';
import { toast } from '../../../../../lib/toast';

export function useTransactionsData() {
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const savingRef = useRef(false);

  async function loadAllData() {
    try {
      setLoading(true);
      setError(null);
      const [txnData, catData, accData] = await Promise.all([
        api('money/transactions'),
        api('money/categories'),
        api('money/accounts'),
      ]);
      setTransactions(txnData.transactions || []);
      setCategories(catData.categories || []);
      setAccounts(accData.accounts || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAllData();
  }, []);

  async function handleAddTransaction(payload) {
    try {
      await api('money/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await loadAllData();
      toast.success('Transaction added');
      return true;
    } catch (err) {
      toast.error(`Failed to add transaction: ${err.message}`);
      return false;
    }
  }

  async function handleDeleteTransaction(txnId) {
    try {
      await api(`money/transactions/${txnId}`, { method: 'DELETE' });
      await loadAllData();
      toast.success('Transaction deleted');
      return true;
    } catch (err) {
      toast.error(`Delete failed: ${err.message}`);
      return false;
    }
  }

  async function saveField(id, field, value) {
    if (savingRef.current) return false;
    savingRef.current = true;
    try {
      await api(`money/transactions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      await loadAllData();
      return true;
    } catch (err) {
      console.error('Save failed:', err);
      return false;
    } finally {
      savingRef.current = false;
    }
  }

  async function bulkSetCategory(ids, categoryId) {
    try {
      await api('money/transactions/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, updates: { category_id: categoryId } }),
      });
      await loadAllData();
      toast.success(`Updated ${ids.length} transaction(s)`);
      return true;
    } catch (err) {
      toast.error(`Bulk update failed: ${err.message}`);
      return false;
    }
  }

  async function bulkDelete(ids) {
    try {
      await api('money/transactions/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      await loadAllData();
      toast.success(`Deleted ${ids.length} transaction(s)`);
      return true;
    } catch (err) {
      toast.error(`Bulk delete failed: ${err.message}`);
      return false;
    }
  }

  async function seedSample() {
    try {
      await api('money/seed-sample', { method: 'POST' });
      await loadAllData();
      return true;
    } catch (err) {
      console.error('Seed failed:', err);
      return false;
    }
  }

  return {
    transactions,
    categories,
    accounts,
    loading,
    error,
    loadAllData,
    handleAddTransaction,
    handleDeleteTransaction,
    saveField,
    bulkSetCategory,
    bulkDelete,
    seedSample,
    savingRef,
  };
}
