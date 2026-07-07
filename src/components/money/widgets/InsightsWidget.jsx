import { useNavigate } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, Info, CheckCircle2, ArrowRight } from 'lucide-react';
import { useApi } from '../../../lib/query';

const SEVERITY = {
  critical: { color: 'var(--m-red)', Icon: AlertOctagon },
  warn: { color: 'var(--m-amber)', Icon: AlertTriangle },
  info: { color: 'var(--m-accent)', Icon: Info },
  good: { color: 'var(--m-green)', Icon: CheckCircle2 },
};

// Turn a finding.action into a HashRouter path (e.g. category deep-link into
// the Transactions filter built in Phase 5).
function toPath(action) {
  if (!action) return null;
  const p = action.params || {};
  const qs = new URLSearchParams();
  if (p.category) qs.set('category', p.category);
  if (p.q) qs.set('q', p.q);
  const s = qs.toString();
  return action.route + (s ? `?${s}` : '');
}

export default function InsightsWidget() {
  const { data, isLoading } = useApi('money/advice');
  const navigate = useNavigate();
  const findings = data?.findings || [];

  if (isLoading) {
    return <div style={{ color: 'var(--m-muted)', fontSize: 13, padding: '8px 0' }}>Reading your numbers…</div>;
  }

  const attention = findings.filter((f) => f.severity !== 'good').length;

  if (!findings.length) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--m-muted)', textAlign: 'center', padding: 12 }}>
        <CheckCircle2 size={28} style={{ color: 'var(--m-green)' }} />
        <div style={{ fontSize: 13 }}>Add some accounts and transactions and your coach will start weighing in.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--m-muted)' }}>
        {attention > 0
          ? `${attention} thing${attention === 1 ? '' : 's'} worth your attention`
          : "You're in good shape — keep it up."}
      </div>
      {findings.map((f) => {
        const s = SEVERITY[f.severity] || SEVERITY.info;
        const path = toPath(f.action);
        return (
          <div
            key={f.id}
            style={{
              display: 'flex',
              gap: 10,
              padding: '10px 12px',
              background: 'var(--m-surface-2)',
              border: '1px solid var(--m-border)',
              borderLeft: `3px solid ${s.color}`,
              borderRadius: 8,
            }}
          >
            <s.Icon size={16} style={{ color: s.color, flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)' }}>{f.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--m-ink-2)', lineHeight: 1.5, marginTop: 2 }}>{f.detail}</div>
              {f.action && path && (
                <button
                  className="m-no-drag"
                  onClick={() => navigate(path)}
                  style={{
                    marginTop: 8,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: s.color,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {f.action.label} <ArrowRight size={13} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
