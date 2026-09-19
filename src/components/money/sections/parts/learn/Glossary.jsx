import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import Card from '../../../shared/Card';
import { useApi } from '../../../../../lib/query';

// Extracted unchanged from the pre-Wave-2 Learn.jsx stub — same glossary,
// same search behaviour, just relocated under /learn/glossary.
export default function Glossary() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('term') || '');
  const { data, isLoading } = useApi('money/glossary');
  const terms = data?.terms || [];
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return terms;
    return terms.filter((t) => t.term.toLowerCase().includes(s) || t.plain.toLowerCase().includes(s));
  }, [terms, q]);

  return (
    <div>
      <div style={{ position: 'relative', maxWidth: 420, marginBottom: 16 }}>
        <Search size={16} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--m-muted)' }} />
        <input className="m-input" style={{ paddingLeft: 32 }} placeholder="Search terms…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      {isLoading ? (
        <div style={{ color: 'var(--m-muted)' }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {filtered.map((t) => (
            <Card key={t.term} className="m-card-sm m-card-no-hover" style={{ padding: 16 }}>
              <div style={{ fontWeight: 600, color: 'var(--m-ink)', marginBottom: 4 }}>{t.term}</div>
              <div style={{ color: 'var(--m-ink-2)', fontSize: 14 }}>{t.plain}</div>
              {t.more && <div style={{ color: 'var(--m-muted)', fontSize: 13, marginTop: 6 }}>{t.more}</div>}
            </Card>
          ))}
          {!filtered.length && <div style={{ color: 'var(--m-muted)' }}>No terms match "{q}".</div>}
        </div>
      )}
    </div>
  );
}
