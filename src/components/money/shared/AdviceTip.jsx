import { AlertOctagon, AlertTriangle, Info } from 'lucide-react';
import { useApi } from '../../../lib/query';

const SEVERITY = {
  critical: { color: 'var(--m-red)', Icon: AlertOctagon },
  warn: { color: 'var(--m-amber)', Icon: AlertTriangle },
  info: { color: 'var(--m-accent)', Icon: Info },
};

// Compact one-liner surfacing the single most important coach finding for this
// section. `categories` filters findings to the ones this screen can act on.
export default function AdviceTip({ categories = [] }) {
  const { data } = useApi('money/advice');
  const findings = data?.findings || [];
  const top = findings.find((f) => f.severity !== 'good' && categories.includes(f.category));
  if (!top) return null;

  const s = SEVERITY[top.severity] || SEVERITY.info;
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '10px 14px',
        marginBottom: 16,
        background: 'var(--m-surface-2)',
        border: '1px solid var(--m-border)',
        borderLeft: `3px solid ${s.color}`,
        borderRadius: 8,
      }}
    >
      <s.Icon size={16} style={{ color: s.color, flexShrink: 0, marginTop: 1 }} />
      <div style={{ fontSize: 13, color: 'var(--m-ink-2)', lineHeight: 1.5 }}>
        <span style={{ fontWeight: 600, color: 'var(--m-ink)' }}>{top.title}.</span> {top.detail}
      </div>
    </div>
  );
}
