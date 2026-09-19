import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import Grade from './Grade';

export default function MetricCard({ label, value, sublabel, delta, grade, gradeLabel, icon: Icon }) {
  const up = Number(delta) > 0;
  const down = Number(delta) < 0;
  return (
    <div style={{ background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {Icon && <Icon size={14} style={{ color: 'var(--m-muted)' }} aria-hidden="true" />}
        <span style={{ fontSize: 12, color: 'var(--m-ink-2)' }}>{label}</span>
        {grade && <Grade grade={grade} label={gradeLabel} style={{ marginLeft: 'auto' }} />}
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--m-ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {(sublabel || delta !== undefined) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 12,
          color: up ? 'var(--m-green)' : down ? 'var(--m-red)' : 'var(--m-ink-2)' }}>
          {up && <ArrowUpRight size={13} aria-hidden="true" />}
          {down && <ArrowDownRight size={13} aria-hidden="true" />}
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{sublabel}</span>
        </div>
      )}
    </div>
  );
}
