import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  TrendingDown,
  DollarSign,
  AlertCircle,
  Plus,
  Percent,
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
import SectionHeader from '../shared/SectionHeader';
import Card from '../shared/Card';
import Money from '../shared/Money';
import Term from '../shared/Term';
import BigStat from '../shared/BigStat';
import EmptyState from '../shared/EmptyState';

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
const f$ = (x) => '$' + Math.round(Number(x) || 0).toLocaleString();
function pmt(P, annualRatePct, months) {
  const r = (Number(annualRatePct) || 0) / 100 / 12;
  if (months <= 0 || P <= 0) return 0;
  return r === 0 ? P / months : (P * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

const CALC_FIELDS = {
  Mortgage: [['price', 'Home price'], ['down', 'Down payment'], ['rate', 'Rate (%)'], ['term', 'Term (years)']],
  'Auto Loan': [['price', 'Vehicle price'], ['down', 'Down payment'], ['rate', 'Rate (%)'], ['term', 'Term (months)']],
  Refi: [['bal', 'Current balance'], ['curRate', 'Current rate (%)'], ['curMonths', 'Months remaining'], ['newRate', 'New rate (%)'], ['newMonths', 'New term (months)'], ['cost', 'Closing costs']],
  DTI: [['income', 'Monthly gross income'], ['debt', 'Monthly debt payments']],
};

function CalcPanel({ type, debts }) {
  const [v, setV] = useState({});
  const n = (k, d = 0) => { const x = parseFloat(v[k]); return Number.isFinite(x) ? x : d; };

  let out = [];
  if (type === 'Mortgage' || type === 'Auto Loan') {
    const P = n('price') - n('down');
    const months = type === 'Mortgage' ? n('term', 30) * 12 : n('term', 60);
    const m = pmt(P, n('rate', 7), months);
    const total = m * months;
    out = [['Monthly payment', f$(m)], ['Total interest', f$(total - P)], ['Total paid', f$(total)]];
  } else if (type === 'Refi') {
    const bal = n('bal');
    const oldM = pmt(bal, n('curRate', 7), n('curMonths', 1));
    const newM = pmt(bal, n('newRate', 6), n('newMonths', 1));
    const save = oldM - newM;
    out = [['Old payment', f$(oldM)], ['New payment', f$(newM)], ['Monthly savings', f$(save)]];
    if (n('cost') > 0 && save > 0) out.push(['Break-even', Math.ceil(n('cost') / save) + ' months']);
  } else if (type === 'DTI') {
    const income = n('income');
    const debtDefault = (debts || []).reduce((s, d) => s + (Number(d.min_payment) || 0), 0);
    const debt = (v.debt !== undefined && v.debt !== '') ? n('debt') : debtDefault;
    const dti = income > 0 ? (debt / income) * 100 : 0;
    out = [['Monthly debt', f$(debt)], ['DTI ratio', dti.toFixed(1) + '%'], ['Assessment', dti <= 36 ? 'Healthy' : dti <= 43 ? 'Manageable' : 'High']];
  }

  const debtSum = (debts || []).reduce((s, d) => s + (Number(d.min_payment) || 0), 0);
  return (
    <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div style={{ display: 'grid', gap: 10 }}>
        {(CALC_FIELDS[type] || []).map(([k, label]) => (
          <div key={k}>
            <label className="m-input-label">{label}</label>
            <input className="m-input" type="number" step="any"
              placeholder={type === 'DTI' && k === 'debt' ? `auto: ${f$(debtSum)}` : ''}
              value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          </div>
        ))}
      </div>
      <div style={{ background: 'var(--m-surface-2)', borderRadius: 8, padding: 16, display: 'grid', gap: 10, alignContent: 'start' }}>
        {out.map(([label, val], i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>{label}</span>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--m-ink)', fontVariantNumeric: 'tabular-nums' }}>{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Debt() {
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Strategy and simulation state
  const [strategy, setStrategy] = useState('avalanche');
  const [monthlyExtra, setMonthlyExtra] = useState(0);
  const [payoffResult, setPayoffResult] = useState(null);

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
      const res = await fetch('/api/money/debt');
      if (res.ok) {
        const data = await res.json();
        setDebts(data.debts || []);
      } else {
        setError('Failed to load debt data');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Compute payoff strategy when debts, strategy, or monthlyExtra changes
  useEffect(() => {
    if (debts.length > 0) {
      computePayoff();
    }
  }, [strategy, monthlyExtra, debts]);

  async function computePayoff() {
    try {
      const res = await fetch('/api/money/debt/payoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy,
          monthly_extra: monthlyExtra,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setPayoffResult(result);
      }
    } catch (err) {
      console.error('Failed to compute payoff:', err);
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
            {debts.map((debt, idx) => (
              <motion.div
                key={idx}
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
              </motion.div>
            ))}
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

            {/* Extra monthly payment slider */}
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--m-ink-2)', marginBottom: '8px' }}>
                Extra Monthly Payment: <Money value={monthlyExtra} prefix="" />
              </label>
              <input
                type="range"
                min="0"
                max="2000"
                step="50"
                value={monthlyExtra}
                onChange={e => setMonthlyExtra(Number(e.target.value))}
                style={{
                  width: '100%',
                  height: '6px',
                  borderRadius: '3px',
                  background: 'var(--m-border)',
                  outline: 'none',
                  accentColor: 'var(--m-accent)',
                  cursor: 'pointer',
                }}
              />
              <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginTop: '6px' }}>
                Adjust the slider to see how extra payments speed up debt freedom.
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
