import { useState, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';

// Module-level cache for glossary definitions
const glossaryCache = new Map();
let glossaryFetched = false;

async function fetchGlossaryTerm(name) {
  if (glossaryCache.has(name)) {
    return glossaryCache.get(name);
  }

  try {
    const res = await fetch(`/api/money/glossary?term=${encodeURIComponent(name)}`);
    if (res.ok) {
      const data = await res.json();
      glossaryCache.set(name, data.definition || '');
      return data.definition || '';
    }
  } catch (err) {
    console.warn(`[Term] Failed to fetch glossary for "${name}":`, err.message);
  }
  return '';
}

export default function Term({ name, children, className = '' }) {
  const [definition, setDefinition] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open && !definition && !loading) {
      setLoading(true);
      fetchGlossaryTerm(name).then(def => {
        setDefinition(def);
        setLoading(false);
      });
    }
  }, [open, definition, loading, name]);

  return (
    <span
      className={`m-term ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {children}

      {/* Tooltip card */}
      {open && (
        <div className="m-term-tooltip">
          {loading ? (
            <div style={{ color: 'var(--m-muted)' }}>Loading...</div>
          ) : definition ? (
            <div>
              <div style={{ marginBottom: '8px' }}>{definition}</div>
              <a
                href={`#/money/glossary?term=${encodeURIComponent(name)}`}
                style={{
                  fontSize: '12px',
                  color: 'var(--m-accent)',
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
              >
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
