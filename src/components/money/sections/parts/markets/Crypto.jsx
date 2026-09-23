import { useState } from 'react';
import { useApi } from '../../../../../lib/query';
import Card from '../../../shared/Card';
import Skeleton from '../../../shared/Skeleton';
import ErrorState from '../../../shared/ErrorState';
import { StatusChip, UpdatedAt, f$, fPct, fVol, changeColor, num, tileStyle, sortByPctDesc } from './common';

const DEFAULT_IDS = 'bitcoin,ethereum,solana,dogecoin';

export default function Crypto() {
  const [ids, setIds] = useState(DEFAULT_IDS);
  const [input, setInput] = useState(DEFAULT_IDS);
  const { data: env, isLoading, error } = useApi(`market/crypto?ids=${encodeURIComponent(ids)}`);

  function onSubmit(e) {
    e.preventDefault();
    const cleaned = input.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).join(',');
    if (cleaned) setIds(cleaned);
  }

  const coinIds = env?.data ? Object.keys(env.data) : [];
  const coins = sortByPctDesc(coinIds, (id) => env.data[id]?.usd_24h_change);

  return (
    <div style={{ marginTop: 16 }}>
      <Card>
        <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 14, flexWrap: 'wrap' }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="coingecko ids, comma-separated (e.g. bitcoin,ethereum)"
            className="m-input"
            style={{ flex: 1, minWidth: 260 }}
            aria-label="Coingecko IDs"
          />
          <button type="submit" className="m-btn m-btn-primary m-btn-sm">Load</button>
          {env && <StatusChip stale={env.stale} offline={env.offline} cached_at={env.cached_at} />}
        </form>
      </Card>

      {isLoading ? (
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={80} />)}
        </div>
      ) : error ? (
        <div style={{ marginTop: 16 }}><ErrorState message={error.message} /></div>
      ) : coins.length === 0 ? (
        <div style={{ marginTop: 16, color: 'var(--m-ink-2)', fontSize: 13 }}>No crypto data — enable Market data in Settings, or check your connection.</div>
      ) : (
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {coins.map((id) => {
            const c = env.data[id];
            return (
              <Card key={id} style={tileStyle} hoverable={false}>
                <div style={{ fontSize: 13, color: 'var(--m-ink-2)', textTransform: 'capitalize' }}>{id}</div>
                <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700, color: 'var(--m-ink)', ...num }}>{f$(c?.usd)}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: changeColor(c?.usd_24h_change), ...num }}>{fPct(c?.usd_24h_change)}</div>
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--m-muted)', ...num }}>24h vol {c?.usd_24h_vol != null ? '$' + fVol(Math.round(c.usd_24h_vol)) : '—'}</div>
                <div style={{ marginTop: 4 }}><UpdatedAt cached_at={c?.last_updated_at ? c.last_updated_at * 1000 : null} /></div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
