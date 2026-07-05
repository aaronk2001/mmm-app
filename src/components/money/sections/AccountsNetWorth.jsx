import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Wallet, Plus } from 'lucide-react';
import SectionHeader from '../shared/SectionHeader';
import Card from '../shared/Card';
import Money from '../shared/Money';
import { confirmDialog } from '../../../lib/confirm';
import { toast } from '../../../lib/toast';
import Term from '../shared/Term';
import EmptyState from '../shared/EmptyState';
import { api, useApi } from '../../../lib/query';
import { fieldsFor, matchesFilter } from '../../../lib/customFields';
import CustomFieldFilters from './parts/CustomFieldFilters';
import NetWorthTrendChart from './parts/accounts/NetWorthTrendChart';
import AccountForm from './parts/accounts/AccountForm';
import AccountsList from './parts/accounts/AccountsList';

export default function AccountsNetWorth() {
  const [accounts, setAccounts] = useState([]);
  const [overviewData, setOverviewData] = useState(null);
  const [networthSnapshots, setNetworthSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [cfFilters, setCfFilters] = useState({});
  const { data: cfSettings } = useApi('settings');

  useEffect(() => {
    loadAllData();
  }, []);

  async function loadAllData() {
    try {
      setLoading(true);
      setError(null);

      const [accountsData, overviewData, networthData] = await Promise.all([
        api('money/accounts'),
        api('money/overview'),
        api('money/networth'),
      ]);

      setAccounts(accountsData.accounts || []);
      setOverviewData(overviewData);
      setNetworthSnapshots(networthData.snapshots || []);
    } catch (err) {
      setError(err.message);
      toast.error(`Load failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteAccount(accountId) {
    if (!(await confirmDialog({
      title: 'Delete account?',
      message: 'Its transactions will also be removed.',
      confirmLabel: 'Delete',
    }))) return;

    try {
      await api(`money/accounts/${accountId}`, { method: 'DELETE' });
      await loadAllData();
      toast.success('Account deleted');
    } catch (err) {
      toast.error(`Delete failed: ${err.message}`);
    }
  }

  const visibleAccounts = accounts.filter(a =>
    fieldsFor(cfSettings, 'account').every(f => matchesFilter(a, f, cfFilters[f.id]))
  );

  if (loading) {
    return (
      <div>
        <SectionHeader icon={Wallet} title="Accounts & Net Worth" subtitle="Your financial snapshot" />
        <Card>
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--m-muted)' }}>
            Loading your accounts...
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <SectionHeader icon={Wallet} title="Accounts & Net Worth" subtitle="Your financial snapshot" />
        <Card style={{ background: 'rgba(220, 38, 38, 0.05)', borderColor: 'var(--m-red)' }}>
          <div style={{ color: 'var(--m-red)', fontWeight: 600 }}>Error: {error}</div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader icon={Wallet} title="Accounts & Net Worth" subtitle="Your financial snapshot" />

      {overviewData && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          style={{ marginBottom: '24px' }}
        >
          <Card className="m-card-sm" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '24px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--m-ink-2)', marginBottom: '8px' }}>
                <Term name="net worth">Net Worth</Term>
              </div>
              <div style={{ fontSize: 'clamp(24px, 5vw, 32px)', fontWeight: 700, color: 'var(--m-ink)', fontVariantNumeric: 'tabular-nums' }}>
                <Money value={overviewData.netWorth} prefix="$" decimals={0} />
              </div>
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--m-ink-2)', marginBottom: '8px' }}>
                <Term name="assets">Total Assets</Term>
              </div>
              <div style={{ fontSize: 'clamp(24px, 5vw, 32px)', fontWeight: 700, color: 'var(--m-green)', fontVariantNumeric: 'tabular-nums' }}>
                <Money value={overviewData.assets} prefix="$" decimals={0} />
              </div>
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--m-ink-2)', marginBottom: '8px' }}>
                <Term name="liabilities">Total Liabilities</Term>
              </div>
              <div style={{ fontSize: 'clamp(24px, 5vw, 32px)', fontWeight: 700, color: 'var(--m-red)', fontVariantNumeric: 'tabular-nums' }}>
                <Money value={Math.abs(overviewData.liabilities)} prefix="$" decimals={0} />
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      <NetWorthTrendChart data={networthSnapshots} />

      <AccountForm
        showAddForm={showAddForm}
        setShowAddForm={setShowAddForm}
        onAccountAdded={loadAllData}
        cfSettings={cfSettings}
      />

      {fieldsFor(cfSettings, 'account').length > 0 && (
        <Card className="m-card-sm" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
            <CustomFieldFilters entity="account" value={cfFilters} onChange={setCfFilters} />
          </div>
        </Card>
      )}

      <AccountsList accounts={visibleAccounts} onDelete={handleDeleteAccount} />

      {accounts.length === 0 && !showAddForm && (
        <EmptyState
          icon={Wallet}
          title="No accounts yet"
          message="Get started by adding your first account to track your wealth and net worth."
          action={
            <button className="m-btn m-btn-primary m-btn-sm" onClick={() => setShowAddForm(true)}>
              <Plus size={16} /> Add Account
            </button>
          }
        />
      )}
    </div>
  );
}
