import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import SectionHeader from '../shared/SectionHeader';
import AdviceTip from '../shared/AdviceTip';
import Card from '../shared/Card';
import Money from '../shared/Money';
import Term from '../shared/Term';
import EmptyState from '../shared/EmptyState';
import ErrorState from '../shared/ErrorState';
import { TrendingUp, AlertCircle, CheckCircle2, Plus } from 'lucide-react';
import { api } from '../../../lib/query';
import { toast } from '../../../lib/toast';

/**
 * Budget section — Envelope-style monthly budget tracking.
 *
 * Contract:
 * - No required props
 * - Fetches data from GET /api/money/overview (budgetStatus) and GET /api/money/budgets
 * - Renders total budget summary + per-category progress cards
 * - Supports edit/set budget UI (POST/PUT to /api/money/budgets)
 */
export default function Budget() {
  const navigate = useNavigate();
  const [overviewData, setOverviewData] = useState(null);
  const [budgets, setBudgets] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [isCreatingBudget, setIsCreatingBudget] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [limitValue, setLimitValue] = useState('');

  useEffect(() => {
    async function loadData() {
      try {
        const [overview, budgets, cats] = await Promise.all([
          api('money/overview'),
          api('money/budgets'),
          api('money/categories'),
        ]);
        setOverviewData(overview);
        setBudgets(budgets);
        setCategories(cats.categories || []);
      } catch (err) {
        setError(err.message);
        toast.error(`Failed to load budget data: ${err.message}`);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const budgetStatus = overviewData?.budgetStatus || [];
  const categoryName = (id) => categories.find((c) => c.id === id)?.name || 'Uncategorized';

  // Calculate totals
  const totalBudgeted = budgetStatus.reduce((sum, b) => sum + (b.limit || 0), 0);
  const totalSpent = budgetStatus.reduce((sum, b) => sum + (b.spent || 0), 0);
  const totalRemaining = totalBudgeted - totalSpent;
  const budgetPct = totalBudgeted > 0 ? Math.round((totalSpent / totalBudgeted) * 100) : 0;

  const handleEditStart = (categoryId, currentLimit) => {
    setEditingCategoryId(categoryId);
    setEditValue(String(currentLimit || ''));
  };

  const handleEditSave = async (categoryId) => {
    try {
      const newLimit = parseFloat(editValue);
      if (isNaN(newLimit) || newLimit < 0) return;

      await api(`money/budgets/${categoryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: newLimit }),
      });

      // Refetch overview to update budgetStatus
      const overview = await api('money/overview');
      setOverviewData(overview);
      setEditingCategoryId(null);
      setEditValue('');
    } catch (err) {
      toast.error(`Failed to update budget: ${err.message}`);
    }
  };

  const handleEditCancel = () => {
    setEditingCategoryId(null);
    setEditValue('');
  };

  const categoriesWithBudgets = new Set(budgetStatus.map((b) => b.category_id));
  const availableCategories = categories.filter((c) => !categoriesWithBudgets.has(c.id));

  const handleCreateBudget = async () => {
    try {
      const newLimit = parseFloat(limitValue);
      if (!selectedCategoryId || isNaN(newLimit) || newLimit < 0) {
        toast.error('Please select a category and enter a valid limit');
        return;
      }

      await api('money/budgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: selectedCategoryId, period: 'monthly', limit: newLimit }),
      });

      const overview = await api('money/overview');
      setOverviewData(overview);
      setIsCreatingBudget(false);
      setSelectedCategoryId('');
      setLimitValue('');
      toast.success('Budget created');
    } catch (err) {
      toast.error(`Failed to create budget: ${err.message}`);
    }
  };

  const handleToggleRollover = async (budgetId, currentRollover) => {
    try {
      await api(`money/budgets/${budgetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rollover: !currentRollover }),
      });

      const overview = await api('money/overview');
      setOverviewData(overview);
      toast.success(`Rollover ${!currentRollover ? 'enabled' : 'disabled'}`);
    } catch (err) {
      toast.error(`Failed to update rollover: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div>
        <SectionHeader icon={TrendingUp} title="Monthly Budget" subtitle="Envelope-style spending plan" />
        <Card className="m-card-sm">
          <div style={{ color: 'var(--m-ink-2)' }}>Loading budget data...</div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <SectionHeader icon={TrendingUp} title="Monthly Budget" subtitle="Envelope-style spending plan" />
        <ErrorState message={`Error: ${error}`} />
      </div>
    );
  }

  const isEmpty = !budgetStatus || budgetStatus.length === 0;

  return (
    <div>
      <SectionHeader icon={TrendingUp} title="Monthly Budget" subtitle="Envelope-style spending plan" />

      <AdviceTip categories={['budget']} />

      {/* Educational explainer */}
      <Card className="m-card-sm" style={{ marginBottom: '24px', background: 'var(--m-accent-soft)', border: 'none' }}>
        <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', lineHeight: 1.5 }}>
          <Term name="envelope budgeting">Envelope budgeting</Term> means assigning every dollar to a spending category ("envelope") before the month starts. Track <Term name="zero-based budget">zero-based</Term> spending to catch <Term name="variance">variances</Term> early and stay on track.
        </div>
      </Card>

      {isEmpty ? (
        <EmptyState
          icon={AlertCircle}
          title="No budgets yet"
          message="Set up a budget to track your spending categories and stay on target each month."
          action={
            <button className="m-btn m-btn-primary m-btn-sm" onClick={() => setIsCreatingBudget(true)}>
              <Plus size={16} />
              Set up budget
            </button>
          }
        />
      ) : (
        <>
          {/* Total summary */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            style={{ marginBottom: '24px' }}
          >
            <Card className="m-card-sm">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '12px', color: 'var(--m-muted)', fontWeight: 500, marginBottom: '4px' }}>
                    Total Budgeted
                  </div>
                  <div style={{ fontSize: 'clamp(16px, 4vw, 20px)', fontWeight: 700, color: 'var(--m-ink)' }}>
                    <Money value={totalBudgeted} prefix="$" decimals={0} />
                  </div>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '12px', color: 'var(--m-muted)', fontWeight: 500, marginBottom: '4px' }}>
                    Total Spent
                  </div>
                  <div style={{ fontSize: 'clamp(16px, 4vw, 20px)', fontWeight: 700, color: 'var(--m-ink)' }}>
                    <Money value={totalSpent} prefix="$" decimals={0} />
                  </div>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '12px', color: 'var(--m-muted)', fontWeight: 500, marginBottom: '4px' }}>
                    Remaining
                  </div>
                  <div
                    style={{
                      fontSize: 'clamp(16px, 4vw, 20px)',
                      fontWeight: 700,
                      color: totalRemaining >= 0 ? 'var(--m-green)' : 'var(--m-red)',
                    }}
                  >
                    <Money value={Math.abs(totalRemaining)} prefix={totalRemaining >= 0 ? '$' : '-$'} decimals={0} />
                  </div>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '12px', color: 'var(--m-muted)', fontWeight: 500, marginBottom: '4px' }}>
                    Used
                  </div>
                  <div
                    style={{
                      fontSize: 'clamp(16px, 4vw, 20px)',
                      fontWeight: 700,
                      color: budgetPct <= 80 ? 'var(--m-green)' : budgetPct <= 100 ? 'var(--m-amber)' : 'var(--m-red)',
                    }}
                  >
                    {budgetPct}%
                  </div>
                </div>
              </div>

              {/* Overall progress bar */}
              <div style={{ marginBottom: '16px' }}>
                <div
                  style={{
                    height: '8px',
                    background: 'var(--m-surface-2)',
                    borderRadius: '4px',
                    overflow: 'hidden',
                  }}
                >
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(budgetPct, 100)}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    style={{
                      height: '100%',
                      background:
                        budgetPct <= 80 ? 'var(--m-green)' : budgetPct <= 100 ? 'var(--m-amber)' : 'var(--m-red)',
                      borderRadius: '4px',
                    }}
                  />
                </div>
              </div>

              {availableCategories.length > 0 && (
                <button
                  className="m-btn m-btn-primary m-btn-sm"
                  onClick={() => setIsCreatingBudget(true)}
                  style={{ width: '100%' }}
                >
                  <Plus size={16} />
                  Add budget
                </button>
              )}
            </Card>
          </motion.div>

          {/* Per-category budget rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {budgetStatus.map((budget, idx) => {
              const isEditing = editingCategoryId === budget.category_id;
              const pct = budget.limit > 0 ? Math.round((budget.spent / budget.limit) * 100) : 0;
              const isOver = budget.spent > budget.limit;
              const isNear = pct >= 80 && pct < 100;

              let statusIcon = null;
              let statusColor = 'var(--m-green)';
              let statusLabel = 'On track';

              if (isOver) {
                statusIcon = <AlertCircle size={16} />;
                statusColor = 'var(--m-red)';
                statusLabel = `Over by $${(budget.spent - budget.limit).toFixed(2)}`;
              } else if (isNear) {
                statusIcon = <AlertCircle size={16} />;
                statusColor = 'var(--m-amber)';
                statusLabel = `Getting close`;
              } else {
                statusIcon = <CheckCircle2 size={16} />;
              }

              return (
                <motion.div
                  key={budget.category_id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: idx * 0.05 }}
                >
                  <Card hoverable={false} className="m-card-sm">
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                      {/* Category info */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>{categoryName(budget.category_id)}</span>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 400, color: 'var(--m-ink-2)' }}>
                            <input
                              type="checkbox"
                              checked={budget.rollover || false}
                              onChange={() => handleToggleRollover(budget.budget_id, budget.rollover)}
                              style={{ cursor: 'pointer' }}
                            />
                            Rollover
                          </label>
                        </div>

                        {/* Progress bar */}
                        <div
                          style={{
                            height: '6px',
                            background: 'var(--m-surface-2)',
                            borderRadius: '3px',
                            overflow: 'hidden',
                            marginBottom: '8px',
                          }}
                        >
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(pct, 100)}%` }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                            style={{
                              height: '100%',
                              background: isOver ? 'var(--m-red)' : isNear ? 'var(--m-amber)' : 'var(--m-green)',
                              borderRadius: '3px',
                            }}
                          />
                        </div>

                        {/* Amount row */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                          <div style={{ fontSize: '13px', color: 'var(--m-ink-2)' }}>
                            <Money value={budget.spent} prefix="$" decimals={2} /> of{' '}
                            {isEditing ? (
                              <input
                                type="number"
                                className="m-input"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                style={{ width: '80px', padding: '4px 8px', fontSize: '13px', marginLeft: '4px' }}
                                autoFocus
                              />
                            ) : (
                              <>
                                <Money value={budget.limit} prefix="$" decimals={2} />
                                {budget.limit > 0 && (
                                  <button
                                    onClick={() => handleEditStart(budget.category_id, budget.limit)}
                                    style={{
                                      marginLeft: '8px',
                                      background: 'none',
                                      border: 'none',
                                      color: 'var(--m-accent)',
                                      cursor: 'pointer',
                                      fontSize: '12px',
                                      fontWeight: 600,
                                      textDecoration: 'underline',
                                    }}
                                  >
                                    Edit
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '13px',
                              fontWeight: 600,
                              color: statusColor,
                            }}
                          >
                            {statusIcon}
                            {statusLabel}
                          </div>
                        </div>

                        {/* View spending link */}
                        <div style={{ marginBottom: isEditing ? '8px' : '0' }}>
                          <button
                            onClick={() => navigate(`/transactions?category=${encodeURIComponent(budget.category_id)}`)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--m-accent)',
                              cursor: 'pointer',
                              fontSize: '12px',
                              fontWeight: 600,
                              textDecoration: 'underline',
                              padding: 0,
                            }}
                          >
                            View spending
                          </button>
                        </div>

                        {/* Edit controls */}
                        {isEditing && (
                          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            <button
                              className="m-btn m-btn-primary m-btn-sm"
                              onClick={() => handleEditSave(budget.category_id)}
                              style={{ fontSize: '12px' }}
                            >
                              Save
                            </button>
                            <button
                              className="m-btn m-btn-secondary m-btn-sm"
                              onClick={handleEditCancel}
                              style={{ fontSize: '12px' }}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          {/* Celebration or heads-up message */}
          {totalRemaining > 0 && budgetPct < 100 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              style={{ marginTop: '24px' }}
            >
              <Card
                hoverable={false}
                className="m-card-sm"
                style={{ background: 'var(--m-accent-soft)', border: '1px solid var(--m-accent)' }}
              >
                <div style={{ fontSize: '14px', color: 'var(--m-accent)', fontWeight: 500 }}>
                  ✨ You're doing great! <Money value={totalRemaining} prefix="$" decimals={2} /> to go.
                </div>
              </Card>
            </motion.div>
          )}

          {totalRemaining <= 0 && totalBudgeted > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              style={{ marginTop: '24px' }}
            >
              <Card
                hoverable={false}
                className="m-card-sm"
                style={{ background: 'var(--m-red-bg)', border: '1px solid var(--m-red)' }}
              >
                <div style={{ fontSize: '14px', color: 'var(--m-red)', fontWeight: 500 }}>
                  Heads up — over by <Money value={Math.abs(totalRemaining)} prefix="$" decimals={2} />. No judgment—let's adjust next month.
                </div>
              </Card>
            </motion.div>
          )}

        </>
      )}

      {/* Create budget dialog — rendered in both empty and populated states */}
      {isCreatingBudget && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          style={{ marginTop: '24px' }}
        >
          <Card className="m-card-sm">
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '16px' }}>
              Create New Budget
            </div>

            {availableCategories.length === 0 ? (
              <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', marginBottom: '16px' }}>
                Every category already has a budget. Add a category first from Settings, or edit an existing budget above.
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--m-muted)', marginBottom: '4px' }}>
                    Category
                  </label>
                  <select
                    value={selectedCategoryId}
                    onChange={(e) => setSelectedCategoryId(e.target.value)}
                    className="m-input"
                    style={{ width: '100%', padding: '8px', fontSize: '13px' }}
                  >
                    <option value="">Select a category...</option>
                    {availableCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--m-muted)', marginBottom: '4px' }}>
                    Monthly Limit ($)
                  </label>
                  <input
                    type="number"
                    value={limitValue}
                    onChange={(e) => setLimitValue(e.target.value)}
                    placeholder="0.00"
                    className="m-input"
                    style={{ width: '100%', padding: '8px', fontSize: '13px' }}
                  />
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              {availableCategories.length > 0 && (
                <button
                  className="m-btn m-btn-primary m-btn-sm"
                  onClick={handleCreateBudget}
                  style={{ flex: 1 }}
                >
                  Create
                </button>
              )}
              <button
                className="m-btn m-btn-secondary m-btn-sm"
                onClick={() => {
                  setIsCreatingBudget(false);
                  setSelectedCategoryId('');
                  setLimitValue('');
                }}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
