import { useState } from 'react';
import { useApi } from '../../../../../lib/query';
import Card from '../../../shared/Card';
import Skeleton from '../../../shared/Skeleton';
import ErrorState from '../../../shared/ErrorState';
import { StatusChip, UpdatedAt, num, tileStyle } from './common';

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
      {/* At-a-glance dashboard — one small request per common series against
          the same /market/macro/:seriesId endpoint used below, just with
          limit=1 so each tile shows only the latest observation. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        {COMMON_SERIES.map((s) => (
          <MacroSeriesTile key={s.id} id={s.id} label={s.label} selected={s.id === seriesId} onSelect={() => { setSeriesId(s.id); setInput(s.id); }} />
        ))}
      </div>

      <Card>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)' }}>
            {COMMON_SERIES.find((s) => s.id === seriesId)?.label || seriesId} — full history
          </div>
          <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="FRED series id (e.g. FEDFUNDS)" className="m-input" style={{ width: 260, textTransform: 'uppercase' }} aria-label="FRED series id" />
            <button type="submit" className="m-btn m-btn-primary m-btn-sm">Load</button>
            {env && <StatusChip stale={env.stale} offline={env.offline} cached_at={env.cached_at} />}
            <UpdatedAt cached_at={env?.cached_at} />
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

// Informational tile, not a click target itself (cards never get
// cursor:pointer per the styling rule) — the "View full history" button
// below it is the actual control that switches the detail table.
function MacroSeriesTile({ id, label, selected, onSelect }) {
  const { data: env, isLoading } = useApi(`market/macro/${encodeURIComponent(id)}?limit=1`);
  const latest = env?.data?.observations?.[0];
  return (
    <Card hoverable={false} style={{ ...tileStyle, borderColor: selected ? 'var(--m-accent)' : 'var(--m-border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--m-ink-2)' }}>{label}</div>
        {env && <StatusChip stale={env.stale} offline={env.offline} cached_at={env.cached_at} />}
      </div>
      {isLoading ? (
        <div style={{ marginTop: 8, fontSize: 20, color: 'var(--m-muted)' }}>…</div>
      ) : latest ? (
        <>
          <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700, color: 'var(--m-ink)', ...num }}>{latest.value}</div>
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--m-muted)' }}>as of {latest.date}</div>
        </>
      ) : (
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--m-muted)' }}>No data</div>
      )}
      <button
        type="button"
        className="m-btn m-btn-secondary m-btn-sm"
        style={{ marginTop: 8 }}
        onClick={onSelect}
        aria-pressed={selected}
      >
        {selected ? 'Viewing history' : 'View full history'}
      </button>
    </Card>
  );
}
