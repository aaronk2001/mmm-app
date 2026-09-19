import { useState } from 'react';
import { useApi } from '../../../../../lib/query';
import Card from '../../../shared/Card';
import Skeleton from '../../../shared/Skeleton';
import ErrorState from '../../../shared/ErrorState';
import { StatusChip, num } from './common';

// A handful of well-known FRED series ids as a starting point — "series"
// here means a data key, not a hardcoded value, so any valid FRED id works
// via the free-text input too.
const COMMON_SERIES = [
  { id: 'FEDFUNDS', label: 'Fed Funds Rate' },
  { id: 'CPIAUCSL', label: 'CPI (All Urban Consumers)' },
  { id: 'UNRATE', label: 'Unemployment Rate' },
  { id: 'DGS10', label: '10-Year Treasury Yield' },
  { id: 'GDP', label: 'Gross Domestic Product' },
];

export default function Macro() {
  const [seriesId, setSeriesId] = useState('FEDFUNDS');
  const [input, setInput] = useState('FEDFUNDS');
  const { data: env, isLoading, error } = useApi(`market/macro/${encodeURIComponent(seriesId)}?limit=24`);

  function onSubmit(e) {
    e.preventDefault();
    const s = input.trim().toUpperCase();
    if (s) setSeriesId(s);
  }

  const observations = env?.data?.observations || [];

  return (
    <div style={{ marginTop: 16 }}>
      <Card>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {COMMON_SERIES.map((s) => (
              <button
                key={s.id}
                type="button"
                className="m-btn m-btn-secondary m-btn-sm"
                onClick={() => { setSeriesId(s.id); setInput(s.id); }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="FRED series id (e.g. FEDFUNDS)" className="m-input" style={{ width: 260, textTransform: 'uppercase' }} aria-label="FRED series id" />
            <button type="submit" className="m-btn m-btn-primary m-btn-sm">Load</button>
            {env && <StatusChip stale={env.stale} offline={env.offline} cached_at={env.cached_at} />}
          </form>
          <div style={{ fontSize: 12, color: 'var(--m-muted)' }}>
            Requires a free FRED API key (optional — set it in Settings under Market data). Without one this stays cached/offline.
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div style={{ marginTop: 16 }}><Skeleton height={240} /></div>
      ) : error ? (
        <div style={{ marginTop: 16 }}><ErrorState message={error.message} /></div>
      ) : observations.length === 0 ? (
        <div style={{ marginTop: 16, color: 'var(--m-ink-2)', fontSize: 13 }}>No macro data yet — add a FRED key in Settings, or check the series id.</div>
      ) : (
        <Card className="m-card-sm" style={{ marginTop: 16, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--m-border)' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--m-muted)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>Date</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-muted)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {observations.map((o) => (
                <tr key={o.date} style={{ borderBottom: '1px solid var(--m-border)' }}>
                  <td style={{ padding: '10px 12px', color: 'var(--m-ink-2)' }}>{o.date}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink)', ...num }}>{o.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
