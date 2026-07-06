import { useEffect, useState, useRef } from 'react';
import { motion } from 'motion/react';
import {
  TrendingDown,
  DollarSign,
  AlertCircle,
  Plus,
  Percent,
  Calendar,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';
import { api } from '../../../lib/query';
import { toast } from '../../../lib/toast';
import SectionHeader from '../shared/SectionHeader';
import Card from '../shared/Card';
import Money from '../shared/Money';
import Term from '../shared/Term';
import BigStat from '../shared/BigStat';
import EmptyState from '../shared/EmptyState';
import CalcPanel from './parts/debt/CalcPanel';

/**
 * Debt Payoff section — Debt list, strategy toggle, payoff simulation, timeline chart, and loan calculators.
 *
 * Contract:
 * - No required props
 * - Fetches data from GET /api/money/debt and POST /api/money/debt/payoff
 * - Renders debt summary, strategy (avalanche vs snowball), extra payment slider
 * - Shows payoff order, months-to-debt-free, total interest, and payoff timeline chart
 * - Includes loan calculator subsection (mortgage, auto, refi, DTI)
 */

export default function Debt() {
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Strategy and simulation state
  const [strategy, setStrategy] = useState('avalanche');
  const [monthlyExtra, setMonthlyExtra] = useState(0);
  const [payoffResult, setPayoffResult] = useState(null);
  const [baselineResult, setBaselineResult] = useState(null);

  // Debounce for extra payment input
  const debounceRef = useRef(null);

  // Loan calculator state
  const [showCalculators, setShowCalculators] = useState(false);
  const [activeCalculator, setActiveCalculator] = useState(null);

  // Load debts on mount
  useEffect(() => {
    loadDebts();
  }, []);

  async function loadDebts() {
    try {
      setLoading(true);
      setError(null);
      const data = await api('money/debt');
      setDebts(data.debts || []);
    } catch (err) {
      setError(err.message);
      toast.error('Failed to load debt data');
    } finally {
      setLoading(false);
    }
  }

  // Compute payoff strategy when debts or strategy changes; debounce monthlyExtra
  useEffect(() => {
    if (debts.length > 0) {
      computePayoff(monthlyExtra);
    }
  }, [strategy, debts]);

  // Clear any pending debounce on unmount so it can't fire setState afterward.
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // Debounced extra payment handler
  const handleExtraPaymentChange = (value) => {
    setMonthlyExtra(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (debts.length > 0) {
        computePayoff(value);
      }
    }, 500);
  };

  async function computePayoff(extra) {
    try {
      // Compute baseline (0 extra) and current payoff in parallel
      const [baseline, current] = await Promise.all([
        api('money/debt/payoff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            strategy,
            monthly_extra: 0,
          }),
        }),
        api('money/debt/payoff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            strategy,
            monthly_extra: extra,
          }),
        }),
      ]);

      setBaselineResult(baseline);
      setPayoffResult(current);
    } catch (err) {
      toast.error('Failed to compute payoff strategy');
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Empty state
  // ────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div>
        <SectionHeader
          icon={TrendingDown}
          title="Debt Payoff"
          subtitle="Strategy and timeline"
        />
        <Card className="m-card-sm">
          <div style={{ color: 'var(--m-ink-2)' }}>Loading debt data...</div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <SectionHeader
          icon={TrendingDown}
          title="Debt Payoff"
          subtitle="Strategy and timeline"
        />
        <Card className="m-card-sm">
          <div style={{ color: 'var(--m-red)' }}>Error: {error}</div>
        </Card>
      </div>
    );
  }

  if (debts.length === 0) {
    return (
      <div>
        <SectionHeader
          icon={TrendingDown}
          title="Debt Payoff"
          subtitle="Strategy and timeline"
        />
        <EmptyState
          title="No debts to track"
          message="Add a loan or credit card account to see payoff strategies and timelines."
          icon={AlertCircle}
        />
      </div>
    );
  }

  // Calculate total debt
  const totalDebt = debts.reduce((sum, d) => sum + d.balance, 0);
  const totalMinPayment = debts.reduce((sum, d) => sum + d.min_payment, 0);

  // Compute payoff months per debt from schedule
  const getPayoffMonths = (debtName, schedule) => {
    if (!schedule || schedule.length === 0) return null;
    for (const point of schedule) {
      const balance = point.balances.find(b => b.name === debtName);
      if (balance && balance.remaining < 0.01) {
        return point.month;
      }
    }
    return null;
  };

  // Format payoff date from months offset
  const getPayoffDate = (months) => {
    if (!months) return null;
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  };

  // Compute savings vs baseline
  const interestSavings = baselineResult && payoffResult
    ? baselineResult.totalInterest - payoffResult.totalInterest
    : 0;
  const monthsEarlier = baselineResult && payoffResult
    ? baselineResult.monthsToFree - payoffResult.monthsToFree
    : 0;

  // Chart data: transform schedule for line chart
  const chartData = payoffResult?.schedule?.map(point => ({
    month: point.month,
    total: point.balances.reduce((sum, b) => sum + b.remaining, 0),
    ...Object.fromEntries(point.balances.map(b => [b.name, b.remaining])),
  })) || [];

  return (
    <div>
      <SectionHeader
        icon={TrendingDown}
        title="Debt Payoff"
        subtitle="Strategy and timeline"
      />

      {/* ────────────────────────────────────────────────────────────────────
          Summary cards
          ──────────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card>
            <BigStat
              label="Total Debt"
              value={<Money value={totalDebt} />}
            />
          </Card>
        </motion.div>

        {payoffResult && (
          <>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.05 }}
            >
              <Card>
                <BigStat
                  label={`Debt-Free in ${payoffResult.monthsToFree} months`}
                  value={`${Math.floor(payoffResult.monthsToFree / 12)}y ${payoffResult.monthsToFree % 12}m`}
                />
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
            >
              <Card>
                <BigStat
                  label="Total Interest"
                  value={<Money value={payoffResult.totalInterest} />}
                  suffix=" (paid)"
                />
              </Card>
            </motion.div>
          </>
        )}
      </div>

      {/* ────────────────────────────────────────────────────────────────────
          Debt list
          ──────────────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      >
        <Card>
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '4px' }}>
              Your Debts
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--m-ink-2)' }}>
              {debts.length} active debt{debts.length !== 1 ? 's' : ''}. Minimum total payment: <Money value={totalMinPayment} />
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {debts.map((debt, idx) => {
              const payoffMonths = payoffResult ? getPayoffMonths(debt.name, payoffResult.schedule) : null;
              const payoffDate = payoffMonths ? getPayoffDate(payoffMonths) : null;
              const fallbackMonths = Math.ceil(debt.balance / debt.min_payment);
              return (
                <motion.div
                  key={debt.account_id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: idx * 0.05 }}
                  style={{
                    padding: '12px',
                    background: 'var(--m-surface-2)',
                    borderRadius: '8px',
                    border: '1px solid var(--m-border)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', minWidth: 0 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {debt.name}
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', marginTop: '2px' }}>
                        {debt.type === 'credit' ? 'Credit Card' : 'Loan'} at <Percent size={12} style={{ display: 'inline' }} /> {(debt.apr * 100).toFixed(1)}% APR
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '12px' }}>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--m-ink)', fontVariantNumeric: 'tabular-nums' }}>
                        <Money value={debt.balance} />
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginTop: '2px' }}>
                        Min: <Money value={debt.min_payment} decimals={0} />
                      </div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{
                    width: '100%',
                    height: '6px',
                    background: 'var(--m-border)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                    marginBottom: '8px',
                  }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, (debt.balance / totalDebt) * 100)}%`,
                        background: 'var(--m-accent)',
                        transition: 'width 150ms ease',
                      }}
                    />
                  </div>

                  {/* Payoff date */}
                  {payoffDate && (
                    <div style={{ fontSize: '12px', color: 'var(--m-ink-2)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Calendar size={12} />
                      Payoff: {payoffDate}
                    </div>
                  )}
                  {!payoffDate && !payoffResult && (
                    <div style={{ fontSize: '12px', color: 'var(--m-muted)' }}>
                      Est. {fallbackMonths} months at minimum payment
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </Card>
      </motion.div>

      {/* ────────────────────────────────────────────────────────────────────
          Strategy selector
          ──────────────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
      >
        <Card>
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '12px' }}>
              Payoff Strategy
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--m-ink-2)', marginBottom: '16px' }}>
              Choose <Term name="debt avalanche">debt avalanche</Term> (highest APR first) or <Term name="snowball method">snowball</Term> (smallest balance first).
            </p>

            {/* Strategy toggle */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              {['avalanche', 'snowball'].map(s => (
                <button
                  key={s}
                  onClick={() => setStrategy(s)}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    borderRadius: '8px',
                    border: '1px solid var(--m-border)',
                    background: strategy === s ? 'var(--m-accent)' : 'var(--m-surface)',
                    color: strategy === s ? '#fff' : 'var(--m-ink)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 150ms ease',
                  }}
                >
                  {s === 'avalanche' ? 'Avalanche (APR)' : 'Snowball (Balance)'}
                </button>
              ))}
            </div>

            {/* Extra monthly payment input */}
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--m-ink-2)', marginBottom: '8px' }}>
                Extra Monthly Payment
              </label>
              <input
                type="number"
                min="0"
                max={Math.round(totalDebt)}
                step="50"
                value={monthlyExtra}
                onChange={e => handleExtraPaymentChange(Math.max(0, Math.min(Math.round(totalDebt), Number(e.target.value) || 0)))}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--m-border)',
                  background: 'var(--m-surface)',
                  color: 'var(--m-ink)',
                  fontSize: '14px',
                  fontVariantNumeric: 'tabular-nums',
                }}
                placeholder="Enter any amount"
              />
              {interestSavings > 0 && monthsEarlier > 0 && (
                <div style={{ fontSize: '12px', color: 'var(--m-accent)', marginTop: '8px', fontWeight: 500 }}>
                  ✓ vs. no extra: save <Money value={interestSavings} prefix="" /> interest, debt-free {monthsEarlier} month{monthsEarlier !== 1 ? 's' : ''} earlier
                </div>
              )}
              <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginTop: '6px' }}>
                Enter any amount to see how extra payments accelerate debt freedom.
              </div>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* ────────────────────────────────────────────────────────────────────
          Payoff order
          ──────────────────────────────────────────────────────────────────── */}
      {payoffResult && payoffResult.order.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.25 }}
        >
          <Card>
            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '4px' }}>
                Payoff Order
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--m-ink-2)' }}>
                Based on {strategy === 'avalanche' ? 'highest APR first' : 'smallest balance first'} strategy.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {payoffResult.order.map((name, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 12px',
                    background: 'var(--m-surface-2)',
                    borderRadius: '6px',
                  }}
                >
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: 'var(--m-accent)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {idx + 1}
                  </div>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--m-ink)' }}>
                    {name}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      {/* ────────────────────────────────────────────────────────────────────
          Payoff timeline chart
          ──────────────────────────────────────────────────────────────────── */}
      {chartData.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        >
          <Card>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '16px' }}>
              Payoff Timeline
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" />
                <XAxis
                  dataKey="month"
                  stroke="var(--m-ink-2)"
                  style={{ fontSize: '12px' }}
                  label={{ value: 'Months', position: 'insideBottomRight', offset: -5 }}
                />
                <YAxis
                  stroke="var(--m-ink-2)"
                  style={{ fontSize: '12px' }}
                  label={{ value: 'Remaining Balance', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--m-surface)',
                    border: '1px solid var(--m-border)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    fontSize: '12px',
                  }}
                  formatter={(value) => `$${value?.toLocaleString('en-US', { maximumFractionDigits: 0 }) || '0'}`}
                  labelFormatter={(label) => `Month ${label}`}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="var(--m-accent)"
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={true}
                />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginTop: '12px', textAlign: 'center' }}>
              Assumes consistent {strategy} strategy with <Money value={monthlyExtra} prefix="" /> extra payment per month.
            </div>
          </Card>
        </motion.div>
      )}

      {/* ────────────────────────────────────────────────────────────────────
          Loan Calculators subsection
          ──────────────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.35 }}
      >
        <Card>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)' }}>
              Loan Calculators
            </h3>
          </div>

          {!showCalculators ? (
            <button
              onClick={() => setShowCalculators(true)}
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: '8px',
                border: '1px solid var(--m-border)',
                background: 'var(--m-accent-soft)',
                color: 'var(--m-accent)',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'all 150ms ease',
              }}
            >
              <Plus size={16} />
              Show Calculators
            </button>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              {['Mortgage', 'Auto Loan', 'Refi', 'DTI'].map(calc => (
                <button
                  key={calc}
                  onClick={() => setActiveCalculator(activeCalculator === calc ? null : calc)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--m-border)',
                    background: activeCalculator === calc ? 'var(--m-accent)' : 'var(--m-surface-2)',
                    color: activeCalculator === calc ? '#fff' : 'var(--m-ink)',
                    fontWeight: 500,
                    cursor: 'pointer',
                    fontSize: '13px',
                    transition: 'all 150ms ease',
                  }}
                >
                  {calc}
                </button>
              ))}
            </div>
          )}

          {activeCalculator && <CalcPanel type={activeCalculator} debts={debts} />}
        </Card>
      </motion.div>

      {/* Footer note */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.4 }}
        style={{ marginTop: '24px', fontSize: '12px', color: 'var(--m-ink-2)', textAlign: 'center' }}
      >
        💡 Tip: Add loans and credit cards as accounts to see them here. Set APR and minimum payment in account details.
      </motion.div>
    </div>
  );
}
