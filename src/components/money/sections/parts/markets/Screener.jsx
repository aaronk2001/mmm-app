import { useState } from 'react';
import { useApi } from '../../../../../lib/query';
import Card from '../../../shared/Card';
import Skeleton from '../../../shared/Skeleton';
import ErrorState from '../../../shared/ErrorState';
import EmptyState from '../../../shared/EmptyState';
import { StatusChip, f$, fPct, changeColor, num } from './common';

export default function Screener() {
  const { data: screensRes } = useApi('market/screens');
  const screens = screensRes?.screens || [];
  const [screenId, setScreenId] = useState('day_gainers');

  const { data: env, isLoading, error } = useApi(`market/screener/${encodeURIComponent(screenId)}`, { enabled: !!screenId });
  const quotes = env?.data?.quotes || [];

  return (
    <div style={{ marginTop: 16 }}>
      <Card>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 14, flexWrap: 'wrap' }}>
          <select value={screenId} onChange={(e) => setScreenId(e.target.value)} className="m-input" style={{ width: 240 }} aria-label="Predefined screen">
            {screens.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          {env && <StatusChip stale={env.stale} offline={env.offline} cached_at={env.cached_at} />}
        </div>
      </Card>

      {isLoading ? (
        <div style={{ marginTop: 16 }}><Skeleton height={280} /></div>
      ) : error ? (
        <div style={{ marginTop: 16 }}><ErrorState message={error.message} /></div>
      ) : quotes.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState title="No results" message="Enable Market data in Settings to run predefined screens, or try again once the feature is on." />
        </div>
      ) : (
        <Card className="m-card-sm" style={{ marginTop: 16, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--m-border)' }}>
                {['Symbol', 'Name', 'Price', 'Change', 'Volume'].map((h, i) => (
                  <th key={h} style={{ padding: '10px 12px', color: 'var(--m-muted)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em', textAlign: i >= 2 ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.symbol} style={{ borderBottom: '1px solid var(--m-border)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--m-ink)' }}>{q.symbol}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--m-ink-2)' }}>{q.shortName || q.longName || '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink)', ...num }}>{f$(q.regularMarketPrice)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: changeColor(q.regularMarketChangePercent), ...num }}>{fPct(q.regularMarketChangePercent)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-muted)', ...num }}>{q.regularMarketVolume != null ? Number(q.regularMarketVolume).toLocaleString('en-US') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
