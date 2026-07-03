import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Wallet,
  TrendingUp,
  Plus,
  Trash2,
  Building2,
  AlertCircle,
  Banknote,
  CreditCard,
  Landmark,
  Home,
  Car,
  Package,
  PiggyBank,
  Coins,
} from 'lucide-react';
import SectionHeader from '../shared/SectionHeader';
import Card from '../shared/Card';
import Money from '../shared/Money';
import Term from '../shared/Term';
import EmptyState from '../shared/EmptyState';
import BigStat from '../shared/BigStat';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import CustomFieldInputs from './parts/CustomFieldInputs';
import CustomFieldFilters from './parts/CustomFieldFilters';
import { useApi } from '../../../lib/query';
import { fieldsFor, matchesFilter } from '../../../lib/customFields';

/**
 * Accounts & Net Worth section.
 *
 * Contract:
 * - No required props
 * - Fetches data from GET /api/money/accounts, /api/money/overview, /api/money/networth
 * - Renders net worth display + trend chart + account list grouped by type
 * - Supports add/edit/delete account operations
 */
export default function AccountsNetWorth() {
  // Data state
  const [accounts, setAccounts] = useState([]);
  const [overviewData, setOverviewData] = useState(null);
  const [networthSnapshots, setNetworthSnapshots] = useState([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    type: 'cash',
    balance: '',
    institution: '',
    status: 'active',
    custom: {},
  });
  const [cfFilters, setCfFilters] = useState({});
  const { data: cfSettings } = useApi('settings');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState(null);

  // Load all data on mount
  useEffect(() => {
    loadAllData();
  }, []);

  async function loadAllData() {
    try {
      setLoading(true);
      setError(null);

      const [accountsRes, overviewRes, networthRes] = await Promise.all([
        fetch('/api/money/accounts'),
        fetch('/api/money/overview'),
        fetch('/api/money/networth'),
      ]);

      if (accountsRes.ok) {
        const data = await accountsRes.json();
        setAccounts(data.accounts || []);
      }
      if (overviewRes.ok) {
        const data = await overviewRes.json();
        setOverviewData(data);
      }
      if (networthRes.ok) {
        const data = await networthRes.json();
        setNetworthSnapshots(data.snapshots || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddAccount(e) {
    e.preventDefault();
    setFormError(null);
    setFormLoading(true);

    try {
      const payload = {
        name: formData.name,
        type: formData.type,
        balance: parseFloat(formData.balance),
        institution: formData.institution || undefined,
        status: formData.status,
        custom: formData.custom || {},
      };

      const res = await fetch('/api/money/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        await loadAllData();
        setFormData({
          name: '',
          type: 'cash',
          balance: '',
          institution: '',
          status: 'active',
          custom: {},
        });
        setShowAddForm(false);
      } else {
        setFormError('Failed to add account');
      }
    } catch (err) {
      setFormError(err.message);
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDeleteAccount(accountId) {
    if (!confirm('Delete this account?')) return;

    try {
      const res = await fetch(`/api/money/accounts/${accountId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await loadAllData();
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  // Group accounts by type
  const visibleAccounts = accounts.filter(a => fieldsFor(cfSettings, 'account').every(f => matchesFilter(a, f, cfFilters[f.id])));
  const groupedAccounts = {
    assets: visibleAccounts.filter(a => ['cash', 'brokerage', 'retirement', 'crypto', 'real_estate', 'vehicle', 'other'].includes(a.type)),
    liabilities: visibleAccounts.filter(a => ['credit', 'loan'].includes(a.type)),
  };

  const accountTypeIcons = {
    cash: Banknote,
    credit: CreditCard,
    loan: Landmark,
    brokerage: TrendingUp,
    retirement: PiggyBank,
    crypto: Coins,
    real_estate: Home,
    vehicle: Car,
    other: Package,
  };

  const accountTypeLabels = {
    cash: 'Cash & Checking',
    credit: 'Credit Card',
    loan: 'Loan',
    brokerage: 'Brokerage',
    retirement: 'Retirement',
    crypto: 'Cryptocurrency',
    real_estate: 'Real Estate',
    vehicle: 'Vehicle',
    other: 'Other',
  };

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

      {/* Net Worth Big Stat */}
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

      {/* Net Worth Trend Chart */}
      {networthSnapshots.length > 1 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          style={{ marginBottom: '24px' }}
        >
          <Card className="m-card-sm" style={{ padding: '20px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '16px' }}>
              <TrendingUp size={16} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'text-bottom' }} />
              Net Worth Trend
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={networthSnapshots}>
                <defs>
                  <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--m-accent)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--m-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" />
                <XAxis
                  dataKey="date"
                  stroke="var(--m-muted)"
                  style={{ fontSize: '12px' }}
                  tickFormatter={d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
                <YAxis
                  stroke="var(--m-muted)"
                  style={{ fontSize: '12px' }}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--m-surface)',
                    border: '1px solid var(--m-border)',
                    borderRadius: '8px',
                    color: 'var(--m-ink)',
                  }}
                  formatter={value => <Money value={value} prefix="$" decimals={0} />}
                  labelFormatter={label => new Date(label).toLocaleDateString('en-US')}
                />
                <Area
                  type="monotone"
                  dataKey="net"
                  stroke="var(--m-accent)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorNet)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
      )}

      {/* Add Account Button */}
      {!showAddForm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{ marginBottom: '24px' }}
        >
          <button
            className="m-btn m-btn-primary"
            onClick={() => setShowAddForm(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Plus size={16} /> Add Account
          </button>
        </motion.div>
      )}

      {/* Add Account Form */}
      {showAddForm && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          style={{ marginBottom: '24px' }}
        >
          <Card>
            <form onSubmit={handleAddAccount} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', margin: 0 }}>New Account</h3>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div>
                  <label className="m-input-label">Account Name *</label>
                  <input
                    type="text"
                    className="m-input"
                    placeholder="e.g. Chase Checking"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="m-input-label">Type *</label>
                  <select
                    className="m-input"
                    value={formData.type}
                    onChange={e => setFormData({ ...formData, type: e.target.value })}
                    style={{ appearance: 'none', paddingRight: '28px', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23475569'%3E%3Cpath fill-rule='evenodd' d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 8px center', backgroundRepeat: 'no-repeat', backgroundSize: '16px' }}
                  >
                    <optgroup label="Assets">
                      <option value="cash">Cash & Checking</option>
                      <option value="brokerage">Brokerage</option>
                      <option value="retirement">Retirement</option>
                      <option value="crypto">Cryptocurrency</option>
                      <option value="real_estate">Real Estate</option>
                      <option value="vehicle">Vehicle</option>
                      <option value="other">Other</option>
                    </optgroup>
                    <optgroup label="Liabilities">
                      <option value="credit">Credit Card</option>
                      <option value="loan">Loan</option>
                    </optgroup>
                  </select>
                </div>

                <div>
                  <label className="m-input-label">Balance ($) *</label>
                  <input
                    type="number"
                    step="0.01"
                    className="m-input"
                    placeholder="0.00"
                    value={formData.balance}
                    onChange={e => setFormData({ ...formData, balance: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="m-input-label">Institution (optional)</label>
                  <input
                    type="text"
                    className="m-input"
                    placeholder="e.g. Chase Bank"
                    value={formData.institution}
                    onChange={e => setFormData({ ...formData, institution: e.target.value })}
                  />
                </div>
                <CustomFieldInputs entity="account" value={formData.custom} onChange={(c) => setFormData({ ...formData, custom: c })} />
              </div>

              {formError && (
                <div style={{ padding: '12px', background: 'rgba(220, 38, 38, 0.05)', borderRadius: '8px', color: 'var(--m-red)', fontSize: '14px' }}>
                  {formError}
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="submit" className="m-btn m-btn-primary" disabled={formLoading}>
                  {formLoading ? 'Creating...' : 'Create Account'}
                </button>
                <button
                  type="button"
                  className="m-btn m-btn-secondary"
                  onClick={() => setShowAddForm(false)}
                  disabled={formLoading}
                >
                  Cancel
                </button>
              </div>
            </form>
          </Card>
        </motion.div>
      )}

      {fieldsFor(cfSettings, 'account').length > 0 && (
        <Card className="m-card-sm" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
            <CustomFieldFilters entity="account" value={cfFilters} onChange={setCfFilters} />
          </div>
        </Card>
      )}

      {/* Assets Section */}
      {groupedAccounts.assets.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          style={{ marginBottom: '24px' }}
        >
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '12px' }}>
            <Building2 size={16} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'text-bottom', color: 'var(--m-green)' }} />
            Assets
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {groupedAccounts.assets.map(account => {
              const Icon = accountTypeIcons[account.type] || Package;
              return (
              <Card key={account.id} className="m-card-sm" hoverable={false} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', minWidth: 0 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginBottom: '4px' }}>
                      {accountTypeLabels[account.type] || account.type}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', minWidth: 0 }}>
                      <Icon size={18} style={{ flexShrink: 0, color: 'var(--m-accent)' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.name}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      className="m-btn m-btn-icon m-btn-ghost m-btn-sm"
                      onClick={() => handleDeleteAccount(account.id)}
                      title="Delete"
                      style={{ width: '28px', height: '28px', padding: 0 }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {account.institution && (
                  <div style={{ fontSize: '12px', color: 'var(--m-ink-2)' }}>
                    {account.institution}
                  </div>
                )}

                <div style={{ borderTop: '1px solid var(--m-border)', paddingTop: '12px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginBottom: '4px' }}>Balance</div>
                  <div style={{ fontSize: 'clamp(18px, 4vw, 22px)', fontWeight: 700, color: 'var(--m-green)', fontVariantNumeric: 'tabular-nums' }}>
                    <Money value={account.balance} prefix="$" decimals={0} />
                  </div>
                </div>
              </Card>
            );
            })}
          </div>
        </motion.div>
      )}

      {/* Liabilities Section */}
      {groupedAccounts.liabilities.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.25 }}
          style={{ marginBottom: '24px' }}
        >
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '12px' }}>
            <AlertCircle size={16} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'text-bottom', color: 'var(--m-red)' }} />
            Liabilities
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {groupedAccounts.liabilities.map(account => {
              const Icon = accountTypeIcons[account.type] || Package;
              return (
              <Card key={account.id} className="m-card-sm" hoverable={false} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', minWidth: 0 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginBottom: '4px' }}>
                      {accountTypeLabels[account.type] || account.type}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', minWidth: 0 }}>
                      <Icon size={18} style={{ flexShrink: 0, color: 'var(--m-red)' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.name}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    <button
                      className="m-btn m-btn-icon m-btn-ghost m-btn-sm"
                      onClick={() => handleDeleteAccount(account.id)}
                      title="Delete"
                      style={{ width: '28px', height: '28px', padding: 0 }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {account.institution && (
                  <div style={{ fontSize: '12px', color: 'var(--m-ink-2)' }}>
                    {account.institution}
                  </div>
                )}

                <div style={{ borderTop: '1px solid var(--m-border)', paddingTop: '12px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginBottom: '4px' }}>Balance Owed</div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--m-red)', fontVariantNumeric: 'tabular-nums' }}>
                    <Money value={Math.abs(account.balance)} prefix="$" decimals={0} />
                  </div>
                </div>
              </Card>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Empty State */}
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
