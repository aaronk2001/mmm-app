import { useEffect, useRef, useState } from 'react';
import { registerConfirmHost } from '../../../lib/confirm';

export default function ConfirmHost() {
  const [req, setReq] = useState(null);
  const confirmRef = useRef(null);

  const done = (val) => {
    if (req) req.resolve(val);
    setReq(null);
  };

  useEffect(() => registerConfirmHost(setReq), []);

  useEffect(() => {
    if (!req) return;
    confirmRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter') done(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  if (!req) return null;

  const danger = req.danger !== false; // most confirms here guard deletions

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) done(false); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(9, 12, 18, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        style={{
          background: 'var(--m-surface)', color: 'var(--m-ink)',
          border: '1px solid var(--m-border)', borderRadius: 14,
          boxShadow: 'var(--m-shadow)', padding: 20, width: '100%', maxWidth: 400,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
          {req.title || 'Are you sure?'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--m-ink-2)', lineHeight: 1.5, marginBottom: 18 }}>
          {req.message}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="m-btn m-btn-secondary m-btn-sm" onClick={() => done(false)}>
            {req.cancelLabel || 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            className="m-btn m-btn-primary m-btn-sm"
            onClick={() => done(true)}
            style={danger ? { background: 'var(--m-red)', borderColor: 'var(--m-red)' } : undefined}
          >
            {req.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
