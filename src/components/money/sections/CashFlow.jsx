import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Zap,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  Calendar,
  Plus,
  Edit2,
  Trash2,
} from 'lucide-react';
import SectionHeader from '../shared/SectionHeader';
import AdviceTip from '../shared/AdviceTip';
import Card from '../shared/Card';
import Money from '../shared/Money';
import Term from '../shared/Term';
import EmptyState from '../shared/EmptyState';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../../../lib/query';
import { toast } from '../../../lib/toast';
import { confirmDialog } from '../../../lib/confirm';

/**
 * Cash Flow section — 90/30-day projection + recurring calendar.
 *
 * Contract:
 * - No required props
 * - Fetches data from GET /api/money/cashflow?days=<90|30> and GET /api/money/recurring
 * - Renders projection chart + projected balance + recurring transactions list
 * - Scenario sliders for extra income/expense (optional, WIP)
 */
export default function CashFlow() {
  const [projection, setProjection] = useState(null);
  const [recurringData, setRecurringData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(90);

  // Scenario adjustments
  const [extraIncome, setExtraIncome] = useState(0);
  const [extraExpense, setExtraExpense] = useState(0);

  // Recurring management form
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({ payee: '', amount: '', cadence: 'monthly', kind: 'bill', next_date: '' });
  const [editingId, setEditingId] = useState(null);
  const [formLoading, setFormLoading] = useState(false);

  const refetchData = async () => {
    try {
      const [projectionRes, recurringRes] = await Promise.all([
        api(`money/cashflow?days=${days}`),
        api('money/recurring'),
      ]);
      setProjection(projectionRes);
      setRecurringData(recurringRes);
    } catch (err) {
      toast.error(`Failed to refetch data: ${err.message}`);
    }
  };

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        const [projection, recurring] = await Promise.all([
          api(`money/cashflow?days=${days}`),
          api('money/recurring'),
        ]);

        setProjection(projection);
        setRecurringData(recurring);
      } catch (err) {
        setError(err.message);
        toast.error(`Failed to load cash flow data: ${err.message}`);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [days]);

  // Adjust projection for scenario sliders
  let adjustedProjection = projection;
  if (projection && (extraIncome > 0 || extraExpense > 0)) {
    adjustedProjection = {
      ...projection,
      projection: projection.projection.map((p, idx) => ({
        ...p,
        balance: p.balance + extraIncome - extraExpense,
      })),
    };
  }

  // Calculate final balance and lowest balance
  const finalBalance = adjustedProjection?.projection?.[adjustedProjection.projection.length - 1]?.balance || 0;
  const lowestBalance = adjustedProjection?.projection
    ? Math.min(...adjustedProjection.projection.map(p => p.balance))
    : 0;
  const isLowBalance = lowestBalance < 0 || lowestBalance < 1000; // Arbitrary threshold

  // Extract recurring and declared from response
  const recurring = recurringData?.recurring || [];
  const declared = recurringData?.declared || [];

  // Separate recurring into income/bills
  const recurringIncome = recurring.filter(r => r.kind === 'income');
  const recurringBills = recurring.filter(r => r.kind === 'bill').sort((a, b) => new Date(a.next_date) - new Date(b.next_date));

  const handleAddRecurring = async (e) => {
    e.preventDefault();
    if (!formData.payee.trim()) {
      toast.error('Payee is required');
      return;
    }
    const amount = parseFloat(formData.amount);
    if (!Number.isFinite(amount)) {
      toast.error('Amount must be a valid number');
      return;
    }
    try {
      setFormLoading(true);
      if (editingId) {
        await api(`money/recurring/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({
            payee: formData.payee,
            amount,
            cadence: formData.cadence,
            kind: formData.kind,
            next_date: formData.next_date || undefined,
          }),
        });
        toast.success('Recurring item updated');
      } else {
        await api('money/recurring', {
          method: 'POST',
          body: JSON.stringify({
            payee: formData.payee,
            amount,
            cadence: formData.cadence,
            kind: formData.kind,
            next_date: formData.next_date || undefined,
          }),
        });
        toast.success('Recurring item added');
      }
      setFormData({ payee: '', amount: '', cadence: 'monthly', kind: 'bill', next_date: '' });
      setEditingId(null);
      setShowAddForm(false);
      await refetchData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteRecurring = async (id) => {
    const confirmed = await confirmDialog({
      title: 'Delete recurring item?',
      message: 'This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
    });
    if (confirmed) {
      try {
        await api(`money/recurring/${id}`, { method: 'DELETE' });
        toast.success('Recurring item deleted');
        await refetchData();
      } catch (err) {
        toast.error(err.message);
      }
    }
  };

  const handleEditRecurring = (item) => {
    setFormData({
      payee: item.payee,
      amount: item.amount.toString(),
      cadence: item.cadence,
      kind: item.kind,
      next_date: item.next_date || '',
    });
    setEditingId(item.id);
    setShowAddForm(true);
  };

  if (loading) {
    return (
      <div>
        <SectionHeader icon={Zap} title="Cash Flow" subtitle="Forecast your daily balance" />
        <Card className="m-card-sm">
          <div style={{ color: 'var(--m-ink-2)' }}>Loading forecast...</div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <SectionHeader icon={Zap} title="Cash Flow" subtitle="Forecast your daily balance" />
        <Card className="m-card-sm" style={{ color: 'var(--m-red)' }}>
          Error: {error}
        </Card>
      </div>
    );
  }

  const isEmpty = !adjustedProjection?.projection || adjustedProjection.projection.length === 0;

  return (
    <div>
      <SectionHeader icon={Zap} title="Cash Flow" subtitle="Forecast your daily balance" />

      <AdviceTip categories={['cashflow', 'subscriptions']} />

      {/* Educational explainer */}
      <Card className="m-card-sm" style={{ marginBottom: '24px', background: 'var(--m-accent-soft)', border: 'none' }}>
        <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', lineHeight: 1.5 }}>
          <Term name="cash flow">Cash flow</Term> is the movement of money in and out of your accounts. We project your balance based on <Term name="recurring">recurring</Term> income and bills, plus average <Term name="discretionary">discretionary</Term> spending.
        </div>
      </Card>

      {isEmpty ? (
        <EmptyState
          icon={Zap}
          title="No forecast available"
          message="Add accounts and transactions to see your cash flow projection."
        />
      ) : (
        <>
          {/* Projection Chart */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            style={{ marginBottom: '24px' }}
          >
            <Card className="m-card-sm" style={{ padding: '20px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '16px' }}>
                <TrendingUp size={16} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'text-bottom' }} />
                {days}-Day Projection
              </div>

              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={adjustedProjection.projection}>
                  <defs>
                    <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--m-accent)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--m-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" />
                  <XAxis
                    dataKey="date"
                    stroke="var(--m-muted)"
                    style={{ fontSize: '12px' }}
                    tickFormatter={d => {
                      const date = new Date(d);
                      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    }}
                    interval={Math.floor(adjustedProjection.projection.length / 6) || 0}
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
                    dataKey="balance"
                    stroke="var(--m-accent)"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorBalance)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </motion.div>

          {/* Day Toggle & Stats */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            style={{ marginBottom: '24px' }}
          >
            <Card className="m-card-sm">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => setDays(30)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: days === 30 ? '2px solid var(--m-accent)' : '1px solid var(--m-border)',
                      background: days === 30 ? 'var(--m-accent-soft)' : 'transparent',
                      color: days === 30 ? 'var(--m-accent)' : 'var(--m-ink-2)',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                      transition: 'all 150ms ease',
                    }}
                  >
                    30 days
                  </button>
                  <button
                    onClick={() => setDays(90)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: days === 90 ? '2px solid var(--m-accent)' : '1px solid var(--m-border)',
                      background: days === 90 ? 'var(--m-accent-soft)' : 'transparent',
                      color: days === 90 ? 'var(--m-accent)' : 'var(--m-ink-2)',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                      transition: 'all 150ms ease',
                    }}
                  >
                    90 days
                  </button>
                </div>
              </div>

              {/* Balance Stats Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '16px' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '12px', color: 'var(--m-muted)', fontWeight: 500, marginBottom: '4px' }}>
                    Current Balance
                  </div>
                  <div style={{ fontSize: 'clamp(16px, 4vw, 20px)', fontWeight: 700, color: 'var(--m-ink)', fontVariantNumeric: 'tabular-nums' }}>
                    <Money value={adjustedProjection.projection[0]?.balance || 0} prefix="$" decimals={0} />
                  </div>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '12px', color: 'var(--m-muted)', fontWeight: 500, marginBottom: '4px' }}>
                    Projected in {days}d
                  </div>
                  <div
                    style={{
                      fontSize: 'clamp(16px, 4vw, 20px)',
                      fontWeight: 700,
                      color: finalBalance >= 0 ? 'var(--m-green)' : 'var(--m-red)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    <Money value={finalBalance} prefix={finalBalance >= 0 ? '$' : '-$'} decimals={0} />
                  </div>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '12px', color: 'var(--m-muted)', fontWeight: 500, marginBottom: '4px' }}>
                    Lowest Balance
                  </div>
                  <div
                    style={{
                      fontSize: 'clamp(16px, 4vw, 20px)',
                      fontWeight: 700,
                      color: isLowBalance ? 'var(--m-amber)' : 'var(--m-green)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    <Money value={lowestBalance} prefix="$" decimals={0} />
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Low Balance Warning */}
          {isLowBalance && lowestBalance > -100 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.15 }}
              style={{ marginBottom: '24px' }}
            >
              <Card
                hoverable={false}
                className="m-card-sm"
                style={{ background: 'rgba(217, 119, 6, 0.05)', border: '1px solid var(--m-amber)' }}
              >
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <AlertTriangle size={18} style={{ color: 'var(--m-amber)', marginTop: '2px', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '14px', color: 'var(--m-amber)', fontWeight: 600, marginBottom: '4px' }}>
                      Cash flow gets tight
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', lineHeight: 1.5 }}>
                      Your balance may dip low in the next {days} days. Consider cutting discretionary spending or adding income.
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

          {lowestBalance < 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.15 }}
              style={{ marginBottom: '24px' }}
            >
              <Card
                hoverable={false}
                className="m-card-sm"
                style={{ background: 'rgba(220, 38, 38, 0.05)', border: '1px solid var(--m-red)' }}
              >
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <AlertTriangle size={18} style={{ color: 'var(--m-red)', marginTop: '2px', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '14px', color: 'var(--m-red)', fontWeight: 600, marginBottom: '4px' }}>
                      You may run out of cash
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', lineHeight: 1.5 }}>
                      Based on current recurring transactions and spending patterns, your balance could go negative. Review your budget or increase income.
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

          {/* Scenario Sliders */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
            style={{ marginBottom: '24px' }}
          >
            <Card className="m-card-sm">
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '16px' }}>
                Scenario: What if?
              </div>

              {/* Extra Income Slider */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--m-ink-2)' }}>
                    <DollarSign size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} />
                    Extra Income (monthly)
                  </label>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-green)' }}>
                    <Money value={extraIncome} prefix="+$" decimals={0} />
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="5000"
                  step="100"
                  value={extraIncome}
                  onChange={e => setExtraIncome(parseFloat(e.target.value))}
                  style={{
                    width: '100%',
                    height: '6px',
                    borderRadius: '3px',
                    background: 'var(--m-surface-2)',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                />
              </div>

              {/* Extra Expense Slider */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--m-ink-2)' }}>
                    Extra Expense (monthly)
                  </label>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-red)' }}>
                    <Money value={extraExpense} prefix="-$" decimals={0} />
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max="5000"
                  step="100"
                  value={extraExpense}
                  onChange={e => setExtraExpense(parseFloat(e.target.value))}
                  style={{
                    width: '100%',
                    height: '6px',
                    borderRadius: '3px',
                    background: 'var(--m-surface-2)',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                />
              </div>
            </Card>
          </motion.div>

          {/* Recurring Management Panel */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.25 }}
            style={{ marginBottom: '24px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)' }}>
                <Calendar size={16} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'text-bottom' }} />
                Manage Recurring
              </h3>
              {!showAddForm && (
                <button
                  onClick={() => {
                    setShowAddForm(true);
                    setEditingId(null);
                    setFormData({ payee: '', amount: '', cadence: 'monthly', kind: 'bill', next_date: '' });
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: 'var(--m-accent)',
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} />
                  Add recurring
                </button>
              )}
            </div>

            {showAddForm && (
              <Card className="m-card-sm" style={{ marginBottom: '12px' }}>
                <form onSubmit={handleAddRecurring}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--m-ink-2)', display: 'block', marginBottom: '4px' }}>
                        Payee
                      </label>
                      <input
                        type="text"
                        value={formData.payee}
                        onChange={e => setFormData({ ...formData, payee: e.target.value })}
                        placeholder="e.g., Rent, Salary"
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '6px',
                          border: '1px solid var(--m-border)',
                          background: 'var(--m-surface)',
                          color: 'var(--m-ink)',
                          fontSize: '13px',
                          fontFamily: 'inherit',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--m-ink-2)', display: 'block', marginBottom: '4px' }}>
                        Amount ($)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.amount}
                        onChange={e => setFormData({ ...formData, amount: e.target.value })}
                        placeholder="0.00"
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '6px',
                          border: '1px solid var(--m-border)',
                          background: 'var(--m-surface)',
                          color: 'var(--m-ink)',
                          fontSize: '13px',
                          fontFamily: 'inherit',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--m-ink-2)', display: 'block', marginBottom: '4px' }}>
                        Cadence
                      </label>
                      <select
                        value={formData.cadence}
                        onChange={e => setFormData({ ...formData, cadence: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '6px',
                          border: '1px solid var(--m-border)',
                          background: 'var(--m-surface)',
                          color: 'var(--m-ink)',
                          fontSize: '13px',
                          fontFamily: 'inherit',
                          boxSizing: 'border-box',
                        }}
                      >
                        <option value="weekly">Weekly</option>
                        <option value="biweekly">Biweekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--m-ink-2)', display: 'block', marginBottom: '4px' }}>
                        Type
                      </label>
                      <select
                        value={formData.kind}
                        onChange={e => setFormData({ ...formData, kind: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '8px',
                          borderRadius: '6px',
                          border: '1px solid var(--m-border)',
                          background: 'var(--m-surface)',
                          color: 'var(--m-ink)',
                          fontSize: '13px',
                          fontFamily: 'inherit',
                          boxSizing: 'border-box',
                        }}
                      >
                        <option value="bill">Bill</option>
                        <option value="income">Income</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--m-ink-2)', display: 'block', marginBottom: '4px' }}>
                      Next Date (optional)
                    </label>
                    <input
                      type="date"
                      value={formData.next_date}
                      onChange={e => setFormData({ ...formData, next_date: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '8px',
                        borderRadius: '6px',
                        border: '1px solid var(--m-border)',
                        background: 'var(--m-surface)',
                        color: 'var(--m-ink)',
                        fontSize: '13px',
                        fontFamily: 'inherit',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="submit"
                      disabled={formLoading}
                      style={{
                        flex: 1,
                        padding: '8px',
                        borderRadius: '6px',
                        border: 'none',
                        background: 'var(--m-accent)',
                        color: 'white',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: formLoading ? 'not-allowed' : 'pointer',
                        opacity: formLoading ? 0.6 : 1,
                      }}
                    >
                      {editingId ? 'Update' : 'Add'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddForm(false);
                        setEditingId(null);
                        setFormData({ payee: '', amount: '', cadence: 'monthly', kind: 'bill', next_date: '' });
                      }}
                      style={{
                        flex: 1,
                        padding: '8px',
                        borderRadius: '6px',
                        border: '1px solid var(--m-border)',
                        background: 'transparent',
                        color: 'var(--m-ink-2)',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </Card>
            )}

            {declared.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {declared.map(item => (
                  <Card key={item.id} hoverable={false} className="m-card-sm">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '4px' }}>
                          {item.payee}
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{ textTransform: 'capitalize' }}>{item.kind}</span>
                          <span>•</span>
                          <span style={{ textTransform: 'capitalize' }}>{item.cadence}</span>
                          {item.next_date && (
                            <>
                              <span>•</span>
                              <span>{new Date(item.next_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: item.kind === 'income' ? 'var(--m-green)' : 'var(--m-red)', fontVariantNumeric: 'tabular-nums' }}>
                        <Money value={Math.abs(parseFloat(item.amount))} prefix={item.kind === 'income' ? '+$' : '-$'} decimals={0} />
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          onClick={() => handleEditRecurring(item)}
                          style={{
                            padding: '6px 8px',
                            borderRadius: '4px',
                            border: '1px solid var(--m-border)',
                            background: 'transparent',
                            color: 'var(--m-ink-2)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteRecurring(item.id)}
                          style={{
                            padding: '6px 8px',
                            borderRadius: '4px',
                            border: '1px solid var(--m-border)',
                            background: 'transparent',
                            color: 'var(--m-red)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {!showAddForm && declared.length === 0 && (
              <Card hoverable={false} className="m-card-sm" style={{ background: 'var(--m-surface-2)', border: 'none', textAlign: 'center' }}>
                <div style={{ fontSize: '13px', color: 'var(--m-ink-2)' }}>
                  No recurring items yet. Add one to get started.
                </div>
              </Card>
            )}
          </motion.div>

          {/* Upcoming Bills */}
          {recurringBills.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.28 }}
              style={{ marginBottom: '24px' }}
            >
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '12px' }}>
                <AlertTriangle size={16} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'text-bottom', color: 'var(--m-red)' }} />
                Upcoming Bills
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {recurringBills.map((bill, idx) => (
                  <motion.div
                    key={bill.id || `${bill.payee}-${bill.cadence}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.28 + idx * 0.03 }}
                  >
                    <Card hoverable={false} className="m-card-sm">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '4px' }}>
                            {bill.payee}
                          </div>
                          {bill.next_date && (
                            <div style={{ fontSize: '13px', color: 'var(--m-ink-2)' }}>
                              Next: {new Date(bill.next_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--m-red)', fontVariantNumeric: 'tabular-nums' }}>
                          <Money value={Math.abs(parseFloat(bill.amount))} prefix="-$" decimals={0} />
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Recurring Income */}
          {recurringIncome.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.25 }}
              style={{ marginBottom: '24px' }}
            >
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '12px' }}>
                <TrendingUp size={16} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'text-bottom', color: 'var(--m-green)' }} />
                Incoming
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {recurringIncome.map((r, idx) => (
                  <motion.div
                    key={r.id || `${r.payee}-${r.cadence}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.25 + idx * 0.05 }}
                  >
                    <Card hoverable={false} className="m-card-sm">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '4px' }}>
                            {r.payee}
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <Calendar size={14} />
                            <span style={{ textTransform: 'capitalize' }}>{r.cadence}</span>
                            {r.next_date && (
                              <>
                                <span>•</span>
                                <span>Next: {new Date(r.next_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--m-green)', fontVariantNumeric: 'tabular-nums' }}>
                          <Money value={parseFloat(r.amount)} prefix="+$" decimals={0} />
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Recurring Bills */}
          {recurringBills.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.3 }}
              style={{ marginBottom: '24px' }}
            >
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '12px' }}>
                <AlertTriangle size={16} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'text-bottom', color: 'var(--m-red)' }} />
                Bills & Subscriptions
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {recurringBills.map((r, idx) => (
                  <motion.div
                    key={r.id || `${r.payee}-${r.cadence}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.3 + idx * 0.05 }}
                  >
                    <Card hoverable={false} className="m-card-sm">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '4px' }}>
                            {r.payee}
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <Calendar size={14} />
                            <span style={{ textTransform: 'capitalize' }}>{r.cadence}</span>
                            {r.next_date && (
                              <>
                                <span>•</span>
                                <span>Next: {new Date(r.next_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--m-red)', fontVariantNumeric: 'tabular-nums' }}>
                          <Money value={Math.abs(parseFloat(r.amount))} prefix="-$" decimals={0} />
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Empty recurring state */}
          {recurringIncome.length === 0 && recurringBills.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.25 }}
              style={{ marginBottom: '24px' }}
            >
              <Card
                hoverable={false}
                className="m-card-sm"
                style={{ background: 'var(--m-surface-2)', border: 'none', textAlign: 'center' }}
              >
                <div style={{ fontSize: '13px', color: 'var(--m-ink-2)' }}>
                  No recurring transactions detected yet. Add more transactions to enable forecasting.
                </div>
              </Card>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
