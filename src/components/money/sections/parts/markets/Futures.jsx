import { useApi } from '../../../../../lib/query';
import Card from '../../../shared/Card';
import Skeleton from '../../../shared/Skeleton';
import ErrorState from '../../../shared/ErrorState';
import { StatusChip, UpdatedAt, f$, fPct, changeColor, num, tileStyle, rangeStr, sortByPctDesc } from './common';
import EmptyState from '../../../shared/EmptyState';

export default function Futures() {
  const { data, isLoading, error } = useApi('market/futures');
  const futures = sortByPctDesc(data?.futures || [], (f) => f.quote?.changePct);

  if (isLoading) return <Grid count={7} />;
  if (error) return <div style={{ marginTop: 16 }}><ErrorState message={error.message} /></div>;
  if (futures.length === 0) {
    return <div style={{ marginTop: 16 }}><EmptyState title="No futures data" message="Enable Market data in Settings, or check your connection." /></div>;
  }

  return (
    <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
      {futures.map((f) => (
        <Card key={f.symbol} style={tileStyle} hoverable={false}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>{f.name}</div>
              <div style={{ fontSize: 12, color: 'var(--m-muted)' }}>{f.symbol}</div>
            </div>
            <StatusChip stale={f.stale} offline={f.offline} cached_at={f.cached_at} />
          </div>
          <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700, color: 'var(--m-ink)', ...num }}>{f$(f.quote?.price)}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: changeColor(f.quote?.changePct), ...num }}>{fPct(f.quote?.changePct)}</div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--m-muted)', ...num }}>Day range {rangeStr(f.quote?.dayLow, f.quote?.dayHigh)}</div>
          <div style={{ marginTop: 4 }}><UpdatedAt cached_at={f.cached_at} /></div>
        </Card>
      ))}
    </div>
  );
}

function Grid({ count }) {
  return (
    <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => <Skeleton key={i} height={92} />)}
    </div>
  );
}
