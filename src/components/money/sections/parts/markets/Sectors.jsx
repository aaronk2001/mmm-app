import { useApi } from '../../../../../lib/query';
import Card from '../../../shared/Card';
import Skeleton from '../../../shared/Skeleton';
import ErrorState from '../../../shared/ErrorState';
import { StatusChip, UpdatedAt, f$, fPct, changeColor, num, tileStyle, rangeStr, sortByPctDesc } from './common';
import EmptyState from '../../../shared/EmptyState';

export default function Sectors() {
  const { data, isLoading, error } = useApi('market/sectors');
  const sectors = sortByPctDesc(data?.sectors || [], (s) => s.quote?.changePct);

  if (isLoading) return <Grid count={11} />;
  if (error) return <div style={{ marginTop: 16 }}><ErrorState message={error.message} /></div>;
  if (sectors.length === 0) {
    return <div style={{ marginTop: 16 }}><EmptyState title="No sector data" message="Enable Market data in Settings, or check your connection." /></div>;
  }

  return (
    <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
      {sectors.map((s) => (
        <Card key={s.symbol} style={tileStyle} hoverable={false}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>{s.name}</div>
              <div style={{ fontSize: 12, color: 'var(--m-muted)' }}>{s.symbol}</div>
            </div>
            <StatusChip stale={s.stale} offline={s.offline} cached_at={s.cached_at} />
          </div>
          <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700, color: 'var(--m-ink)', ...num }}>{f$(s.quote?.price)}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: changeColor(s.quote?.changePct), ...num }}>{fPct(s.quote?.changePct)}</div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--m-muted)', ...num }}>Day range {rangeStr(s.quote?.dayLow, s.quote?.dayHigh)}</div>
          <div style={{ marginTop: 4 }}><UpdatedAt cached_at={s.cached_at} /></div>
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
