import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Target,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Plus,
  Edit2,
  Trash2,
  Calendar,
  Zap,
} from 'lucide-react';
import SectionHeader from '../shared/SectionHeader';
import Card from '../shared/Card';
import Money from '../shared/Money';
import Term from '../shared/Term';
import BigStat from '../shared/BigStat';
import EmptyState from '../shared/EmptyState';

/**
 * Goals & Savings section — goal tracking, emergency fund adequacy, FIRE progress.
 *
 * Contract:
 * - No required props
 * - Fetches data from GET /api/money/goals and GET /api/money/goals/insights
 * - Renders goal cards with progress, Emergency Fund widget, FIRE widget
 * - Supports add/edit/delete goal UI (POST/PUT/DELETE to /api/money/goals)
 */
export default function Goals() {
  const [goals, setGoals] = useState(null);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    target: '',
    current: '',
    monthly_contribution: '',
    target_date: '',
    template: '',
  });

  // Load goals and insights
  useEffect(() => {
    async function loadData() {
      try {
        const [goalsRes, insightsRes] = await Promise.all([
          fetch('/api/money/goals'),
          fetch('/api/money/goals/insights'),
        ]);
        if (goalsRes.ok) setGoals(await goalsRes.json());
        if (insightsRes.ok) setInsights(await insightsRes.json());
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Handle add/edit goal
  const handleSaveGoal = async () => {
    try {
      const payload = {
        name: formData.name || null,
        target: parseFloat(formData.target) || 0,
        current: parseFloat(formData.current) || 0,
        monthly_contribution: formData.monthly_contribution ? parseFloat(formData.monthly_contribution) : null,
        target_date: formData.target_date || null,
        template: formData.template || null,
      };

      let res;
      if (editingGoalId) {
        res = await fetch(`/api/money/goals/${editingGoalId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/money/goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (res.ok) {
        const goalsRes = await fetch('/api/money/goals');
        if (goalsRes.ok) setGoals(await goalsRes.json());
        setFormData({ name: '', target: '', current: '', monthly_contribution: '', target_date: '', template: '' });
        setShowAddForm(false);
        setEditingGoalId(null);
      }
    } catch (err) {
      console.error('Failed to save goal:', err);
    }
  };

  const handleDeleteGoal = async (goalId) => {
    try {
      const res = await fetch(`/api/money/goals/${goalId}`, { method: 'DELETE' });
      if (res.ok) {
        const goalsRes = await fetch('/api/money/goals');
        if (goalsRes.ok) setGoals(await goalsRes.json());
      }
    } catch (err) {
      console.error('Failed to delete goal:', err);
    }
  };

  const handleEditStart = (goal) => {
    setEditingGoalId(goal.id);
    setFormData({
      name: goal.name || '',
      target: String(goal.target || ''),
      current: String(goal.current || ''),
      monthly_contribution: String(goal.monthly_contribution || ''),
      target_date: goal.target_date || '',
      template: goal.template || '',
    });
    setShowAddForm(true);
  };

  const handleCancel = () => {
    setShowAddForm(false);
    setEditingGoalId(null);
    setFormData({ name: '', target: '', current: '', monthly_contribution: '', target_date: '', template: '' });
  };

  const applyTemplate = (templateName) => {
    const templates = {
      emergency_fund: { name: 'Emergency Fund', target: '15000', monthly_contribution: '300', template: 'emergency_fund' },
      roth_ira: { name: 'Roth IRA', target: '7000', monthly_contribution: '500', template: 'roth_ira' },
      fire: { name: 'FIRE Number', target: '1000000', monthly_contribution: '2000', template: 'fire' },
    };
    if (templates[templateName]) {
      setFormData({ ...formData, ...templates[templateName] });
    }
  };

  if (loading) {
    return (
      <div>
        <SectionHeader icon={Target} title="Goals & Savings" subtitle="Track goals and financial milestones" />
        <Card className="m-card-sm">
          <div style={{ color: 'var(--m-ink-2)' }}>Loading goals...</div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <SectionHeader icon={Target} title="Goals & Savings" subtitle="Track goals and financial milestones" />
        <Card className="m-card-sm" style={{ color: 'var(--m-red)' }}>
          Error: {error}
        </Card>
      </div>
    );
  }

  const goalsList = goals?.goals || [];
  const em = insights?.emergencyFund || null;
  const fr = insights?.fire || null;

  return (
    <div>
      <SectionHeader icon={Target} title="Goals & Savings" subtitle="Track goals and financial milestones" />

      {/* Emergency Fund Widget */}
      {em && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          style={{ marginBottom: '24px' }}
        >
          <Card hoverable={false} className="m-card-sm">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <AlertCircle
                    size={18}
                    style={{
                      color:
                        em.adequacy === 'good'
                          ? 'var(--m-green)'
                          : em.adequacy === 'ok'
                            ? 'var(--m-amber)'
                            : 'var(--m-red)',
                    }}
                  />
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)' }}>
                    <Term name="emergency fund">Emergency Fund</Term>
                  </div>
                </div>
                <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', lineHeight: 1.5, marginBottom: '12px' }}>
                  You have <strong>{em.monthsCovered}</strong> months covered. Target is{' '}
                  <strong>{em.targetMonths}</strong> months.
                </div>

                {/* Progress bar */}
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
                    animate={{ width: `${Math.min((em.currentSaved / em.targetAmount) * 100, 100)}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    style={{
                      height: '100%',
                      background:
                        em.adequacy === 'good'
                          ? 'var(--m-green)'
                          : em.adequacy === 'ok'
                            ? 'var(--m-amber)'
                            : 'var(--m-red)',
                      borderRadius: '4px',
                    }}
                  />
                </div>

                {/* Amount row */}
                <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', marginTop: '8px' }}>
                  <Money value={em.currentSaved} prefix="$" decimals={0} /> of{' '}
                  <Money value={em.targetAmount} prefix="$" decimals={0} />
                </div>
              </div>

              {/* Status badge */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background:
                    em.adequacy === 'good'
                      ? 'rgba(21, 163, 74, 0.1)'
                      : em.adequacy === 'ok'
                        ? 'rgba(217, 119, 6, 0.1)'
                        : 'rgba(220, 38, 38, 0.1)',
                  whiteSpace: 'nowrap',
                }}
              >
                {em.adequacy === 'good' ? (
                  <CheckCircle2 size={16} style={{ color: 'var(--m-green)' }} />
                ) : (
                  <AlertCircle
                    size={16}
                    style={{
                      color: em.adequacy === 'ok' ? 'var(--m-amber)' : 'var(--m-red)',
                    }}
                  />
                )}
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color:
                      em.adequacy === 'good'
                        ? 'var(--m-green)'
                        : em.adequacy === 'ok'
                          ? 'var(--m-amber)'
                          : 'var(--m-red)',
                  }}
                >
                  {em.adequacy === 'good' ? 'Protected' : em.adequacy === 'ok' ? 'Moderate' : 'At Risk'}
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      {/* FIRE Widget */}
      {fr && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          style={{ marginBottom: '24px' }}
        >
          <Card hoverable={false} className="m-card-sm">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <Zap size={18} style={{ color: 'var(--m-accent)' }} />
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)' }}>
                    <Term name="FIRE">FIRE Progress</Term>
                  </div>
                </div>
                <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', lineHeight: 1.5, marginBottom: '12px' }}>
                  Your <Term name="25x rule">FIRE number</Term> is{' '}
                  <strong>
                    <Money value={fr.fireNumber} prefix="$" decimals={0} />
                  </strong>
                  . {fr.yearsToFire ? `~${fr.yearsToFire} years at current pace.` : 'Increase savings to accelerate.'}
                </div>

                {/* Progress bar */}
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
                    animate={{ width: `${Math.min(fr.progressPct, 100)}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    style={{
                      height: '100%',
                      background: 'var(--m-accent)',
                      borderRadius: '4px',
                    }}
                  />
                </div>

                {/* Percentage row */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '13px',
                    color: 'var(--m-ink-2)',
                    marginTop: '8px',
                  }}
                >
                  <Money value={fr.currentNetWorth} prefix="$" decimals={0} />
                  <div style={{ fontWeight: 600, color: 'var(--m-accent)' }}>{fr.progressPct}%</div>
                </div>
              </div>

              {/* Progress badge */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '12px',
                  borderRadius: '8px',
                  background: 'var(--m-accent-soft)',
                  whiteSpace: 'nowrap',
                }}
              >
                <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--m-accent)' }}>
                  {fr.progressPct}%
                </div>
                <div style={{ fontSize: '12px', color: 'var(--m-ink-2)', marginTop: '2px' }}>to FIRE</div>
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Add goal button + form */}
      <div style={{ marginBottom: '24px' }}>
        {!showAddForm ? (
          <button
            className="m-btn m-btn-primary m-btn-sm"
            onClick={() => setShowAddForm(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Plus size={16} />
            Add goal
          </button>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="m-card-sm" style={{ marginBottom: '16px' }}>
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '8px' }}>
                  {editingGoalId ? 'Edit Goal' : 'New Goal'}
                </div>

                {/* Quick templates */}
                {!editingGoalId && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      marginBottom: '12px',
                    }}
                  >
                    <button
                      className="m-btn m-btn-secondary m-btn-sm"
                      onClick={() => applyTemplate('emergency_fund')}
                      style={{ fontSize: '12px' }}
                    >
                      Emergency Fund
                    </button>
                    <button
                      className="m-btn m-btn-secondary m-btn-sm"
                      onClick={() => applyTemplate('roth_ira')}
                      style={{ fontSize: '12px' }}
                    >
                      Roth IRA
                    </button>
                    <button
                      className="m-btn m-btn-secondary m-btn-sm"
                      onClick={() => applyTemplate('fire')}
                      style={{ fontSize: '12px' }}
                    >
                      FIRE
                    </button>
                  </div>
                )}

                {/* Form fields */}
                <div style={{ display: 'grid', gap: '12px' }}>
                  <input
                    type="text"
                    className="m-input"
                    placeholder="Goal name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    style={{ fontSize: '13px' }}
                  />
                  <input
                    type="number"
                    className="m-input"
                    placeholder="Target amount"
                    value={formData.target}
                    onChange={(e) => setFormData({ ...formData, target: e.target.value })}
                    style={{ fontSize: '13px' }}
                  />
                  <input
                    type="number"
                    className="m-input"
                    placeholder="Current saved"
                    value={formData.current}
                    onChange={(e) => setFormData({ ...formData, current: e.target.value })}
                    style={{ fontSize: '13px' }}
                  />
                  <input
                    type="number"
                    className="m-input"
                    placeholder="Monthly contribution"
                    value={formData.monthly_contribution}
                    onChange={(e) => setFormData({ ...formData, monthly_contribution: e.target.value })}
                    style={{ fontSize: '13px' }}
                  />
                  <input
                    type="date"
                    className="m-input"
                    value={formData.target_date}
                    onChange={(e) => setFormData({ ...formData, target_date: e.target.value })}
                    style={{ fontSize: '13px' }}
                  />
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button className="m-btn m-btn-primary m-btn-sm" onClick={handleSaveGoal} style={{ fontSize: '12px' }}>
                    Save
                  </button>
                  <button className="m-btn m-btn-secondary m-btn-sm" onClick={handleCancel} style={{ fontSize: '12px' }}>
                    Cancel
                  </button>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </div>

      {/* Goals list */}
      {goalsList.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No goals yet"
          message="Set a savings goal to track progress toward your financial milestones."
          action={
            !showAddForm && (
              <button
                className="m-btn m-btn-primary m-btn-sm"
                onClick={() => setShowAddForm(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Plus size={16} />
                Create your first goal
              </button>
            )
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {goalsList.map((goal, idx) => {
            const remaining = Math.max(0, goal.target - goal.current);
            const pct = goal.target > 0 ? (goal.current / goal.target) * 100 : 0;
            const monthsToTarget =
              goal.monthly_contribution && goal.monthly_contribution > 0
                ? Math.ceil(remaining / goal.monthly_contribution)
                : null;

            return (
              <motion.div
                key={goal.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: idx * 0.05 }}
              >
                <Card hoverable={false} className="m-card-sm">
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                    {/* Goal info */}
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: '8px',
                        }}
                      >
                        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)' }}>
                          {goal.name || 'Untitled Goal'}
                        </div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--m-accent)' }}>
                          {Math.round(pct)}%
                        </div>
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
                            background: pct >= 100 ? 'var(--m-green)' : 'var(--m-accent)',
                            borderRadius: '3px',
                          }}
                        />
                      </div>

                      {/* Amount and timeline */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: '13px',
                          color: 'var(--m-ink-2)',
                        }}
                      >
                        <div>
                          <Money value={goal.current} prefix="$" decimals={2} /> of{' '}
                          <Money value={goal.target} prefix="$" decimals={2} />
                        </div>
                        {monthsToTarget && remaining > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Calendar size={13} style={{ color: 'var(--m-muted)' }} />
                            <span>{monthsToTarget} months</span>
                          </div>
                        )}
                        {pct >= 100 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--m-green)' }}>
                            <CheckCircle2 size={13} />
                            <span>Complete</span>
                          </div>
                        )}
                      </div>

                      {/* Monthly contribution */}
                      {goal.monthly_contribution && (
                        <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginTop: '4px' }}>
                          <Money value={goal.monthly_contribution} prefix="$" decimals={2} /> / month
                        </div>
                      )}
                    </div>

                    {/* Edit/Delete buttons */}
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                      <button
                        onClick={() => handleEditStart(goal)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--m-accent)',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteGoal(goal.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--m-red)',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
