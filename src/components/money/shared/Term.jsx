import { useState, useEffect } from 'react';

// One fetch per app session; every <Term> looks up client-side.
let mapPromise = null;
function glossaryMap() {
  if (!mapPromise) {
    mapPromise = fetch('/api/money/glossary')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then(data => new Map((data.terms || []).map(t => [String(t.term).toLowerCase(), t])))
      .catch(() => { mapPromise = null; return new Map(); });
  }
  return mapPromise;
}

export default function Term({ name, children, className = '' }) {
  const [entry, setEntry] = useState(undefined);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || entry !== undefined) return;
    glossaryMap().then(m => setEntry(m.get(String(name).toLowerCase()) || null));
  }, [open, entry, name]);

  return (
    <span className={`m-term ${className}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {children}
      {open && (
        <div className="m-term-tooltip">
          {entry === undefined ? (
            <div style={{ color: 'var(--m-muted)' }}>Loading…</div>
          ) : entry ? (
            <div>
              <div style={{ marginBottom: '6px' }}>{entry.plain}</div>
              {entry.more && <div style={{ marginBottom: '8px', color: 'var(--m-ink-2)', fontSize: '12px' }}>{entry.more}</div>}
              <a href={`#/learn?term=${encodeURIComponent(entry.term)}`} style={{ fontSize: '12px', color: 'var(--m-accent)', textDecoration: 'none', fontWeight: 600 }}>
                Learn more {String.fromCharCode(8594)}
              </a>
            </div>
          ) : (
            <div style={{ color: 'var(--m-muted)' }}>No definition available</div>
          )}
        </div>
      )}
    </span>
  );
}
