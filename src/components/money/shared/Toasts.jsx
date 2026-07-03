import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { useToasts, dismissToast } from '../../../lib/toast';

const KIND = {
  success: { icon: CheckCircle2, color: 'var(--m-green)' },
  error:   { icon: AlertTriangle, color: 'var(--m-red)' },
  info:    { icon: Info, color: 'var(--m-accent)' },
};

export default function Toasts() {
  const items = useToasts();
  if (!items.length) return null;
  return (
    <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
      {items.map((t) => {
        const kind = KIND[t.type] || KIND.info;
        const Icon = kind.icon;
        return (
          <div
            key={t.id}
            role="status"
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              background: 'var(--m-surface)', color: 'var(--m-ink)',
              border: '1px solid var(--m-border)', borderLeft: `3px solid ${kind.color}`,
              borderRadius: 10, boxShadow: 'var(--m-shadow)', padding: '10px 12px',
            }}
          >
            <Icon size={16} style={{ color: kind.color, flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13, lineHeight: 1.45, flex: 1 }}>{t.message}</div>
            <button
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--m-muted)', display: 'flex', padding: 2 }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
