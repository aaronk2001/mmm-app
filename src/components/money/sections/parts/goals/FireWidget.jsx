import { motion } from 'motion/react';
import { Zap } from 'lucide-react';
import Card from '../../../shared/Card';
import Money from '../../../shared/Money';
import Term from '../../../shared/Term';

export default function FireWidget({ fr }) {
  if (!fr) return null;

  return (
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
  );
}
