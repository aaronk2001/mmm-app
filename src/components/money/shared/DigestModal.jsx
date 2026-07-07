import { useNavigate } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';

const TONE = { good: 'var(--m-green)', bad: 'var(--m-red)', neutral: 'var(--m-ink)' };
const SEV = { critical: 'var(--m-red)', warn: 'var(--m-amber)', info: 'var(--m-accent)' };

// Once-a-week "here's how your week went" summary. Deterministic content from
// GET /api/money/digest; shown on launch at most once per calendar week.
export default function DigestModal({ digest, onClose }) {
  const navigate = useNavigate();
  if (!digest) return null;
  const stats = digest.stats || [];
  const findings = digest.topFindings || [];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460, background: 'var(--m-surface)',
          border: '1px solid var(--m-border)', borderRadius: 14, padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <Sparkles size={18} style={{ color: 'var(--m-accent)' }} />
          <span style={{ fontSize: 12, color: 'var(--m-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Your week</span>
          <button onClick={onClose} title="Close" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--m-muted)', display: 'flex', padding: 2 }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--m-ink)', marginBottom: 16, lineHeight: 1.35 }}>
          {digest.headline}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: findings.length ? 18 : 4 }}>
          {stats.map((s, i) => (
            <div key={i} style={{ background: 'var(--m-surface-2)', border: '1px solid var(--m-border)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--m-muted)' }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: TONE[s.tone] || 'var(--m-ink)', fontVariantNumeric: 'tabular-nums' }}>
                {s.value}
                {s.delta && <span style={{ fontSize: 12, fontWeight: 600, marginLeft: 6, color: 'var(--m-muted)' }}>{s.delta}</span>}
              </div>
            </div>
          ))}
        </div>

        {findings.length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: 'var(--m-muted)' }}>What to do about it</div>
            {findings.map((f) => (
              <div key={f.id} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--m-ink-2)', lineHeight: 1.5 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: SEV[f.severity] || 'var(--m-accent)', flexShrink: 0, marginTop: 6 }} />
                <span><strong style={{ color: 'var(--m-ink)' }}>{f.title}.</strong> {f.detail}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="m-btn m-btn-secondary m-btn-sm" onClick={onClose}>Dismiss</button>
          <button className="m-btn m-btn-primary m-btn-sm" onClick={() => { onClose(); navigate('/overview'); }}>See the dashboard</button>
        </div>
      </div>
    </div>
  );
}
