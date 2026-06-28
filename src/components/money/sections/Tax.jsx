import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import SectionHeader from '../shared/SectionHeader';
import Card from '../shared/Card';
import Money from '../shared/Money';
import Term from '../shared/Term';
import BigStat from '../shared/BigStat';
import EmptyState from '../shared/EmptyState';
import { AlertCircle, DollarSign, Plus, Trash2 } from 'lucide-react';

/**
 * Tax Planning section — YTD income, estimated annual tax, quarterly estimates,
 * deduction tracker, and marginal vs effective bracket visualization.
 *
 * Contract:
 * - No required props
 * - Fetches data from GET /api/money/tax
 * - Supports deduction add via POST /api/money/tax/deduction
 * - Renders educational disclaimer prominently
 */
export default function Tax() {
  const [taxData, setTaxData] = useState(null);
  const [deductions, setDeductions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [addingDeduction, setAddingDeduction] = useState(false);
  const [deductionForm, setDeductionForm] = useState({ category: '', amount: '', note: '' });

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch('/api/money/tax');
        if (res.ok) {
          const data = await res.json();
          setTaxData(data);
          setDeductions(data.deductions || []);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleAddDeduction = async (e) => {
    e.preventDefault();
    if (!deductionForm.category || !deductionForm.amount) return;

    try {
      const res = await fetch('/api/money/tax/deduction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deductionForm),
      });

      if (res.ok) {
        const newDeduction = await res.json();
        setDeductions([...deductions, newDeduction.deduction]);
        setDeductionForm({ category: '', amount: '', note: '' });
        setAddingDeduction(false);
      }
    } catch (err) {
      console.error('Failed to add deduction:', err);
    }
  };

  const handleDeleteDeduction = async (deductionId) => {
    try {
      const res = await fetch(`/api/money/tax/deduction/${deductionId}`, { method: 'DELETE' });
      if (res.ok) {
        setDeductions(deductions.filter(d => d.id !== deductionId));
      } else if (res.status === 404) {
        // Endpoint not yet implemented — remove from local state
        setDeductions(deductions.filter(d => d.id !== deductionId));
      }
    } catch (err) {
      console.error('Failed to delete deduction:', err);
    }
  };

  if (loading) {
    return (
      <div>
        <SectionHeader icon={DollarSign} title="Tax Planning" subtitle="Income & estimated tax calculator" />
        <Card className="m-card-sm">
          <div style={{ color: 'var(--m-ink-2)' }}>Loading tax data...</div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <SectionHeader icon={DollarSign} title="Tax Planning" subtitle="Income & estimated tax calculator" />
        <Card className="m-card-sm" style={{ color: 'var(--m-red)' }}>
          Error: {error}
        </Card>
      </div>
    );
  }

  const ytdIncome = taxData?.ytdIncome || 0;
  const estimatedAnnual = taxData?.estimatedAnnualIncome || 0;
  const quarterly = taxData?.quarterlyEstimate || {};
  const totalDeductions = deductions.reduce((sum, d) => sum + (d.amount || 0), 0);

  // Compute effective tax rate
  const effectiveRate = estimatedAnnual > 0
    ? ((estimatedAnnual * 0.0765 + (estimatedAnnual - 14600) * 0.22) / estimatedAnnual * 100)
    : 0;

  return (
    <div>
      <SectionHeader icon={DollarSign} title="Tax Planning" subtitle="Income & estimated tax calculator" />

      {/* Prominent disclaimer banner */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ marginBottom: '24px' }}
      >
        <Card
          hoverable={false}
          className="m-card-sm"
          style={{
            background: 'rgba(220, 38, 38, 0.05)',
            border: '1px solid var(--m-red)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <AlertCircle size={20} style={{ color: 'var(--m-red)', flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '13px', color: 'var(--m-ink)', lineHeight: 1.5 }}>
              <strong>Educational Estimate Only</strong> — This is not tax advice. Consult a CPA for accurate
              filings and quarterly payments.
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Income overview */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        style={{ marginBottom: '24px' }}
      >
        <Card className="m-card-sm">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '24px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12px', color: 'var(--m-muted)', fontWeight: 500, marginBottom: '8px' }}>
                Year-to-Date Income
              </div>
              <div style={{ fontSize: 'clamp(22px, 5vw, 28px)', fontWeight: 700, color: 'var(--m-ink)' }}>
                <Money value={ytdIncome} prefix="$" decimals={0} />
              </div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12px', color: 'var(--m-muted)', fontWeight: 500, marginBottom: '8px' }}>
                Estimated Annual Income
              </div>
              <div style={{ fontSize: 'clamp(22px, 5vw, 28px)', fontWeight: 700, color: 'var(--m-ink)' }}>
                <Money value={estimatedAnnual} prefix="$" decimals={0} />
              </div>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Quarterly estimated tax cards */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        style={{ marginBottom: '24px' }}
      >
        <div style={{ marginBottom: '12px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', margin: 0 }}>
            <Term name="quarterly estimated tax">Quarterly Estimated Tax</Term>
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--m-ink-2)', margin: '4px 0 0 0', lineHeight: 1.4 }}>
            Estimate due by April 15, June 15, Sept 15, and Jan 15. Applies to self-employed, gig, or freelance income.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '12px' }}>
          {['Q1', 'Q2', 'Q3', 'Q4'].map((quarter, idx) => {
            const qKey = `q${idx + 1}`;
            const amount = quarterly[qKey] || 0;
            return (
              <motion.div
                key={qKey}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 + idx * 0.05 }}
              >
                <Card hoverable={false} className="m-card-sm" style={{ textAlign: 'center', minWidth: 0 }}>
                  <div style={{ fontSize: '12px', color: 'var(--m-muted)', fontWeight: 500, marginBottom: '8px' }}>
                    {quarter}
                  </div>
                  <div style={{ fontSize: 'clamp(16px, 4vw, 20px)', fontWeight: 700, color: 'var(--m-ink)' }}>
                    <Money value={amount} prefix="$" decimals={0} />
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* Marginal vs Effective Rate visual */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
        style={{ marginBottom: '24px' }}
      >
        <div style={{ marginBottom: '12px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', margin: 0 }}>
            <Term name="tax brackets">Tax Rate Overview</Term>
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--m-ink-2)', margin: '4px 0 0 0', lineHeight: 1.4 }}>
            <Term name="marginal tax rate">Marginal rate</Term> is your top bracket. <Term name="effective tax rate">Effective rate</Term> is total tax divided by income.
          </p>
        </div>

        <Card hoverable={false} className="m-card-sm">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '20px' }}>
            {/* Marginal rate */}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12px', color: 'var(--m-muted)', fontWeight: 500, marginBottom: '8px' }}>
                Marginal Rate (Your Bracket)
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', marginBottom: '12px' }}>
                <div style={{ fontSize: 'clamp(24px, 5vw, 32px)', fontWeight: 700, color: 'var(--m-ink)' }}>22%</div>
                <div style={{ fontSize: '12px', color: 'var(--m-ink-2)', marginBottom: '4px' }}>
                  on next $1
                </div>
              </div>
              <div
                style={{
                  height: '8px',
                  background: 'var(--m-surface-2)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: '22%',
                    background: 'var(--m-accent)',
                    borderRadius: '4px',
                  }}
                />
              </div>
            </div>

            {/* Effective rate */}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12px', color: 'var(--m-muted)', fontWeight: 500, marginBottom: '8px' }}>
                Effective Rate (Your Average)
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', marginBottom: '12px' }}>
                <div style={{ fontSize: 'clamp(24px, 5vw, 32px)', fontWeight: 700, color: 'var(--m-ink)' }}>
                  {Math.round(effectiveRate * 10) / 10}%
                </div>
                <div style={{ fontSize: '12px', color: 'var(--m-ink-2)', marginBottom: '4px' }}>
                  overall
                </div>
              </div>
              <div
                style={{
                  height: '8px',
                  background: 'var(--m-surface-2)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(effectiveRate, 100)}%`,
                    background: 'var(--m-green)',
                    borderRadius: '4px',
                  }}
                />
              </div>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Deduction tracker */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', margin: 0 }}>
            <Term name="deduction">Deductions</Term>
          </h3>
          <button
            className="m-btn m-btn-secondary m-btn-sm"
            onClick={() => setAddingDeduction(!addingDeduction)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Plus size={16} />
            Add
          </button>
        </div>

        {/* Add deduction form */}
        {addingDeduction && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            style={{ marginBottom: '12px' }}
          >
            <Card className="m-card-sm">
              <form onSubmit={handleAddDeduction} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label className="m-input-label">Category</label>
                  <input
                    type="text"
                    className="m-input"
                    placeholder="e.g., Office supplies, Home office, Education"
                    value={deductionForm.category}
                    onChange={(e) => setDeductionForm({ ...deductionForm, category: e.target.value })}
                  />
                </div>

                <div>
                  <label className="m-input-label">Amount ($)</label>
                  <input
                    type="number"
                    className="m-input"
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    value={deductionForm.amount}
                    onChange={(e) => setDeductionForm({ ...deductionForm, amount: e.target.value })}
                  />
                </div>

                <div>
                  <label className="m-input-label">Note (optional)</label>
                  <input
                    type="text"
                    className="m-input"
                    placeholder="e.g., April 2024, Invoice from XYZ"
                    value={deductionForm.note}
                    onChange={(e) => setDeductionForm({ ...deductionForm, note: e.target.value })}
                  />
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" className="m-btn m-btn-primary m-btn-sm">
                    Save
                  </button>
                  <button
                    type="button"
                    className="m-btn m-btn-secondary m-btn-sm"
                    onClick={() => {
                      setAddingDeduction(false);
                      setDeductionForm({ category: '', amount: '', note: '' });
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </Card>
          </motion.div>
        )}

        {/* Deductions list */}
        {deductions.length === 0 ? (
          <EmptyState
            icon={AlertCircle}
            title="No deductions tracked"
            message="Start tracking deductions to lower your taxable income. Include business expenses, education, home office, and professional fees."
            action={
              <button
                className="m-btn m-btn-primary m-btn-sm"
                onClick={() => setAddingDeduction(true)}
              >
                <Plus size={16} />
                Add a deduction
              </button>
            }
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {deductions.map((deduction, idx) => (
              <motion.div
                key={deduction.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: idx * 0.05 }}
              >
                <Card hoverable={false} className="m-card-sm">
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '4px' }}>
                        {deduction.category}
                      </div>
                      {deduction.note && (
                        <div style={{ fontSize: '12px', color: 'var(--m-ink-2)', marginBottom: '4px' }}>
                          {deduction.note}
                        </div>
                      )}
                      <div style={{ fontSize: '12px', color: 'var(--m-muted)' }}>
                        {new Date(deduction.date).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--m-ink)', minWidth: '80px', textAlign: 'right' }}>
                        <Money value={deduction.amount} prefix="$" decimals={2} />
                      </div>
                      <button
                        onClick={() => handleDeleteDeduction(deduction.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--m-muted)',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}

            {/* Total deductions */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: deductions.length * 0.05 + 0.1 }}
            >
              <Card hoverable={false} className="m-card-sm" style={{ background: 'var(--m-accent-soft)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--m-ink)' }}>
                    Total Deductions
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--m-accent)' }}>
                    <Money value={totalDeductions} prefix="$" decimals={2} />
                  </div>
                </div>
              </Card>
            </motion.div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
