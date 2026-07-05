import { motion } from 'motion/react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import Card from '../../../shared/Card';
import Money from '../../../shared/Money';
import Term from '../../../shared/Term';

export default function EmergencyFundWidget({ em }) {
  if (!em) return null;

  const statusColor =
    em.adequacy === 'good'
      ? 'var(--m-green)'
      : em.adequacy === 'ok'
        ? 'var(--m-amber)'
        : 'var(--m-red)';

  const statusBg =
    em.adequacy === 'good'
      ? 'rgba(21, 163, 74, 0.1)'
      : em.adequacy === 'ok'
        ? 'rgba(217, 119, 6, 0.1)'
        : 'rgba(220, 38, 38, 0.1)';

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
                animate={{ width: `${Math.min((em.currentSaved / em.targetAmount) * 100, 100)}%` }}
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
