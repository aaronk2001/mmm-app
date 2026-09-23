import { useState } from 'react';
import { useApi } from '../../../../../lib/query';
import Card from '../../../shared/Card';
import Skeleton from '../../../shared/Skeleton';
import ErrorState from '../../../shared/ErrorState';
import EmptyState from '../../../shared/EmptyState';
import { StatusChip, tileStyle, num, fProb, fVolumeShort, timeUntil, ProbBar, Pill, SafeLink, SOURCE_LABELS, InfoOnlyNote } from './common';

// GET /api/betting/prediction-markets — Polymarket + Kalshi + Manifold, all
// keyless, so this tab works with nothing but the Prediction markets toggle
// in Settings. The server does the normalising, de-junking, filtering and
// sorting; this file only renders.

const SOURCES = [{ id: 'all', label: 'All sources' }, ...Object.entries(SOURCE_LABELS).map(([id, label]) => ({ id, label }))];
const SORTS = [
  { id: 'volume', label: '24h volume' },
  { id: 'probability', label: 'Most decided' },
  { id: 'closing', label: 'Closing soonest' },
];

export default function PredictionMarkets() {
  const [source, setSource] = useState('all');
  const [sort, setSort] = useState('volume');
  const [category, setCategory] = useState('All');

  const path = `betting/prediction-markets?source=${source}&sort=${sort}&category=${encodeURIComponent(category)}&limit=50`;
  const { data: env, isLoading, error, refetch, isFetching } = useApi(path);

  const markets = env?.markets || [];
  const categories = env?.categories || [];

  return (
    <div style={{ marginTop: 16 }}>
      <Card hoverable={false}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 14, flexWrap: 'wrap' }}>
          <label htmlFor="pm-source" style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>Source</label>
          <select id="pm-source" className="m-input" value={source} onChange={(e) => setSource(e.target.value)} style={{ minWidth: 150 }}>
            {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>

          <label htmlFor="pm-category" style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>Category</label>
          <select id="pm-category" className="m-input" value={category} onChange={(e) => setCategory(e.target.value)} style={{ minWidth: 150 }}>
            <option value="All">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <label htmlFor="pm-sort" style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>Sort</label>
          <select id="pm-sort" className="m-input" value={sort} onChange={(e) => setSort(e.target.value)} style={{ minWidth: 160 }}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>

          <button type="button" className="m-btn m-btn-secondary m-btn-sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
          <span style={{ flex: 1 }} />
          {markets.length > 0 && <span style={{ fontSize: 12, color: 'var(--m-muted)', ...num }}>{markets.length} of {env?.total ?? markets.length}</span>}
          {env && <StatusChip stale={env.stale} offline={env.offline} cached_at={env.cached_at} />}
        </div>
      </Card>

      {isLoading ? (
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={150} />)}
        </div>
      ) : error ? (
        <div style={{ marginTop: 16 }}><ErrorState message={error.message} /></div>
      ) : markets.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState
            title="No prediction markets"
            message="Turn on Prediction markets in Settings → Online & Keys. These sources need no API key; without the toggle MMM stays offline and shows whatever it last cached."
          />
        </div>
      ) : (
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {markets.map((m) => (
            <Card key={`${m.source}:${m.id}`} style={tileStyle} hoverable={false}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Pill tone="accent">{SOURCE_LABELS[m.source] || m.source}</Pill>
                <Pill>{m.category}</Pill>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: 'var(--m-muted)', ...num }}>{timeUntil(m.expiresAt)}</span>
              </div>
              <div style={{ marginTop: 10, fontSize: 14, fontWeight: 600, color: 'var(--m-ink)', lineHeight: 1.35 }}>{m.title}</div>
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--m-ink)', ...num }}>{fProb(m.probability?.yes)}</span>
                <span style={{ fontSize: 12, color: 'var(--m-ink-2)', ...num }}>No {fProb(m.probability?.no)}</span>
              </div>
              <div style={{ marginTop: 6 }}><ProbBar yes={m.probability?.yes} /></div>
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--m-muted)', ...num }}>24h vol {fVolumeShort(m.volume24h)}</span>
                <SafeLink url={m.url}>View market</SafeLink>
              </div>
            </Card>
          ))}
        </div>
      )}

      <InfoOnlyNote>Prices are the market&apos;s own consensus, not a forecast by MMM.</InfoOnlyNote>
    </div>
  );
}
