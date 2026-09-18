import { useState } from 'react';
import { useApi } from '../../../../../lib/query';
import Card from '../../../shared/Card';
import Skeleton from '../../../shared/Skeleton';
import ErrorState from '../../../shared/ErrorState';
import { StatusChip, num } from './common';

const DEFAULT_SYMBOLS = 'EUR,GBP,JPY,CAD,AUD,CHF';

export default function Forex() {
  const [base, setBase] = useState('USD');
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);
  const [baseInput, setBaseInput] = useState('USD');
  const [symbolsInput, setSymbolsInput] = useState(DEFAULT_SYMBOLS);

  const { data: env, isLoading, error } = useApi(`market/forex?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(symbols)}`);

  function onSubmit(e) {
    e.preventDefault();
    const b = baseInput.trim().toUpperCase();
    const s = symbolsInput.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean).join(',');
    if (b) setBase(b);
    if (s) setSymbols(s);
  }

  const rates = env?.data?.rates || {};
  const pairs = Object.entries(rates);

  return (
    <div style={{ marginTop: 16 }}>
      <Card>
        <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 14, flexWrap: 'wrap' }}>
          <input value={baseInput} onChange={(e) => setBaseInput(e.target.value)} placeholder="Base (e.g. USD)" className="m-input" style={{ width: 120, textTransform: 'uppercase' }} aria-label="Base currency" />
          <input value={symbolsInput} onChange={(e) => setSymbolsInput(e.target.value)} placeholder="Symbols, comma-separated" className="m-input" style={{ flex: 1, minWidth: 220, textTransform: 'uppercase' }} aria-label="Target currencies" />
          <button type="submit" className="m-btn m-btn-primary m-btn-sm">Load</button>
          {env && <StatusChip stale={env.stale} offline={env.offline} cached_at={env.cached_at} />}
        </form>
      </Card>

      {isLoading ? (
        <div style={{ marginTop: 16 }}><Skeleton height={200} /></div>
      ) : error ? (
        <div style={{ marginTop: 16 }}><ErrorState message={error.message} /></div>
      ) : pairs.length === 0 ? (
        <div style={{ marginTop: 16, color: 'var(--m-ink-2)', fontSize: 13 }}>No FX data — enable Market data in Settings, or check your connection.</div>
      ) : (
        <Card className="m-card-sm" style={{ marginTop: 16, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--m-border)' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--m-muted)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>Pair</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-muted)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>Rate</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map(([sym, rate]) => (
                <tr key={sym} style={{ borderBottom: '1px solid var(--m-border)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--m-ink)' }}>{env.data.base}/{sym}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink)', ...num }}>{Number(rate).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {env.data?.date && <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--m-muted)' }}>As of {env.data.date}</div>}
        </Card>
      )}
    </div>
  );
}
