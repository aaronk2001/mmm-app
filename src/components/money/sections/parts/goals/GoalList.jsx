import { motion } from 'motion/react';
import { Calendar, CheckCircle2, Edit2, Trash2, Target, Plus } from 'lucide-react';
import Card from '../../../shared/Card';
import Money from '../../../shared/Money';
import EmptyState from '../../../shared/EmptyState';

export default function GoalList({
  goalsList,
  showAddForm,
  setShowAddForm,
  handleEditStart,
  handleDeleteGoal,
}) {
  if (goalsList.length === 0) {
    return (
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
    );
  }

  return (
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
  );
}
