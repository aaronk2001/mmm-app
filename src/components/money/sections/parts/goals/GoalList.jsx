import { motion } from 'motion/react';
import { Calendar, CheckCircle2, Edit2, Trash2, Target, Plus, AlertCircle } from 'lucide-react';
import Card from '../../../shared/Card';
import Money from '../../../shared/Money';
import EmptyState from '../../../shared/EmptyState';

// Parse YYYY-MM-DD string to {year, month, day}
const parseDate = (str) => {
  const [y, m, d] = str.split('-').map(Number);
  return { year: y, month: m, day: d };
};

// Calculate months between two YYYY-MM-DD dates (no UTC issues)
const monthsBetween = (fromStr, toStr) => {
  const from = parseDate(fromStr);
  const to = parseDate(toStr);
  return (to.year - from.year) * 12 + (to.month - from.month);
};

// Format date to YYYY-MM-DD by adding months
const addMonths = (dateStr, months) => {
  const d = parseDate(dateStr);
  let m = d.month + months;
  let y = d.year;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
};

// Get today as YYYY-MM-DD
const today = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export default function GoalList({
  goalsList,
  accounts,
  showAddForm,
  setShowAddForm,
  handleEditStart,
  handleDeleteGoal,
}) {
  // Build account lookup
  const accountMap = {};
  if (accounts?.accounts) {
    accounts.accounts.forEach(acc => {
      accountMap[acc.id] = acc;
    });
  }
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
        // Get current value: use linked account balance if set, else static current
        const linkedAccount = goal.linked_account_id ? accountMap[goal.linked_account_id] : null;
        // Fall back to the goal's stored current if the linked account or its
        // balance is missing, so progress never renders as NaN.
        const current = Number.isFinite(linkedAccount?.balance) ? linkedAccount.balance : (goal.current || 0);

        const remaining = Math.max(0, goal.target - current);
        const pct = goal.target > 0 ? (current / goal.target) * 100 : 0;

        // Projected completion date
        const monthsToTarget =
          goal.monthly_contribution && goal.monthly_contribution > 0
            ? Math.ceil(remaining / goal.monthly_contribution)
            : null;
        const projectedDate = monthsToTarget ? addMonths(today(), monthsToTarget) : null;

        // Pace indicator
        let paceStatus = null;
        if (goal.target_date && goal.monthly_contribution) {
          const monthsUntilTarget = monthsBetween(today(), goal.target_date);
          if (monthsUntilTarget > 0) {
            const neededMonthly = remaining / monthsUntilTarget;
            if (neededMonthly <= goal.monthly_contribution) {
              paceStatus = { type: 'on-pace', color: 'var(--m-green)' };
            } else {
              const behind = neededMonthly - goal.monthly_contribution;
              paceStatus = { type: 'behind', amount: behind, color: 'var(--m-amber)' };
            }
          }
        }

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

                  {/* Tracking hint */}
                  {linkedAccount && (
                    <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginBottom: '6px' }}>
                      tracking {linkedAccount.name}
                    </div>
                  )}

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
                      <Money value={current} prefix="$" decimals={2} /> of{' '}
                      <Money value={goal.target} prefix="$" decimals={2} />
                    </div>
                    {pct >= 100 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--m-green)' }}>
                        <CheckCircle2 size={13} />
                        <span>Complete</span>
                      </div>
                    )}
                  </div>

                  {/* Monthly contribution and projected date */}
                  {goal.monthly_contribution ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '12px', marginTop: '6px' }}>
                      <div>
                        <div style={{ color: 'var(--m-muted)' }}>
                          <Money value={goal.monthly_contribution} prefix="$" decimals={2} /> / month
                        </div>
                        {projectedDate && remaining > 0 && (
                          <div style={{ color: 'var(--m-muted)', marginTop: '2px', fontSize: '11px' }}>
                            {monthsToTarget} months • {projectedDate}
                          </div>
                        )}
                      </div>
                      {paceStatus && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: paceStatus.color, fontWeight: 600 }}>
                          <AlertCircle size={12} />
                          <span>
                            {paceStatus.type === 'on-pace'
                              ? 'on pace'
                              : `behind $${paceStatus.amount.toFixed(0)}/mo`}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginTop: '6px' }}>
                      set a monthly contribution to project a date
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
