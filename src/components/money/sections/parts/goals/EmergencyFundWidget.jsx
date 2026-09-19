import { motion } from 'motion/react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import Card from '../../../shared/Card';
import Money from '../../../shared/Money';
import Term from '../../../shared/Term';

export default function EmergencyFundWidget({ em }) {
  if (!em) return null;

  // No expenses on record (no spending transactions and no recurring bills) —
  // there's nothing to size a fund against. Show a prompt instead of $X / $0.
  if (!em.targetAmount) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ marginBottom: '24px' }}
      >
        <Card hoverable={false} className="m-card-sm">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <AlertCircle size={18} style={{ color: 'var(--m-muted)' }} />
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)' }}>
              <Term name="emergency fund">Emergency Fund</Term>
            </div>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', lineHeight: 1.5 }}>
            Add your monthly bills (as recurring in Cash Flow) or some spending transactions, and we'll size your emergency-fund target automatically.
          </div>
        </Card>
      </motion.div>
    );
  }

  const pct = Math.min((em.currentSaved / em.targetAmount) * 100, 100);

  const statusColor =
    em.adequacy === 'good'
      ? 'var(--m-green)'
      : em.adequacy === 'ok'
        ? 'var(--m-amber)'
        : 'var(--m-red)';

  const statusBg =
    em.adequacy === 'good'
      ? 'var(--m-green-bg)'
      : em.adequacy === 'ok'
        ? 'var(--m-amber-bg)'
        : 'var(--m-red-bg)';

  const statusLabel =
    em.adequacy === 'good'
      ? 'Protected'
      : em.adequacy === 'ok'
        ? 'Moderate'
        : 'At Risk';

  return (
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
              <AlertCircle size={18} style={{ color: statusColor }} />
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)' }}>
                <Term name="emergency fund">Emergency Fund</Term>
              </div>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', lineHeight: 1.5, marginBottom: '12px' }}>
              You have <strong>{em.monthsCovered}</strong> months covered. Target is{' '}
              <strong>{em.targetMonths}</strong> months.
            </div>

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
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                style={{
                  height: '100%',
                  background: statusColor,
                  borderRadius: '4px',
                }}
              />
            </div>

            <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', marginTop: '8px' }}>
              <Money value={em.currentSaved} prefix="$" decimals={0} /> of{' '}
              <Money value={em.targetAmount} prefix="$" decimals={0} />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              borderRadius: '8px',
              background: statusBg,
              whiteSpace: 'nowrap',
            }}
          >
            {em.adequacy === 'good' ? (
              <CheckCircle2 size={16} style={{ color: statusColor }} />
            ) : (
              <AlertCircle size={16} style={{ color: statusColor }} />
            )}
            <div
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: statusColor,
              }}
            >
              {statusLabel}
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
