import { AlertTriangle } from 'lucide-react';

export default function ErrorState({ message = 'Something went wrong.', onRetry }) {
  return (
    <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 16,
      border: '1px solid var(--m-border)', borderRadius: 8, background: 'var(--m-surface-2)' }}>
      <AlertTriangle size={18} style={{ color: 'var(--m-red)', flexShrink: 0 }} aria-hidden="true" />
      <span style={{ fontSize: 13, color: 'var(--m-ink-2)', flex: 1 }}>{message}</span>
      {onRetry && <button className="m-btn m-btn-secondary" onClick={onRetry}>Retry</button>}
    </div>
  );
}
