import { useEffect, useRef, useState } from 'react';
import { LineChart as LineChartIcon } from 'lucide-react';
import { api } from '../../../../../lib/query';
import Card from '../../../shared/Card';
import Skeleton from '../../../shared/Skeleton';
import ErrorState from '../../../shared/ErrorState';
import { StatusChip, f$, fPct, changeColor, num, cssVar } from './common';

const RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y'];
const INTERVALS = ['1d', '1wk', '1mo'];

export default function Chart() {
  const [symbol, setSymbol] = useState('SPY');
  const [input, setInput] = useState('SPY');
  const [range, setRange] = useState('3mo');
  const [interval, setInterval_] = useState('1d');
  const [env, setEnv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api(`market/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`)
      .then((data) => { if (!cancelled) setEnv(data); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, range, interval]);

  // lightweight-charts paints on a <canvas>, so it needs the panel's actual
  // resolved colors, not `var(--m-*)` references — read them off the
  // container, which is always inside .money-hub.
  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;
    let disposed = false;
    import('lightweight-charts').then(({ createChart, AreaSeries }) => {
      if (disposed || !containerRef.current) return;
      const el = containerRef.current;
      const chart = createChart(el, {
        width: el.clientWidth,
        height: 320,
        layout: {
          background: { color: 'transparent' },
          textColor: cssVar(el, '--m-ink-2', '#888'),
        },
        grid: {
          vertLines: { color: cssVar(el, '--m-border', '#333') },
          horzLines: { color: cssVar(el, '--m-border', '#333') },
        },
        rightPriceScale: { borderColor: cssVar(el, '--m-border', '#333') },
        timeScale: { borderColor: cssVar(el, '--m-border', '#333') },
      });
      const series = chart.addSeries(AreaSeries, {
        lineColor: cssVar(el, '--m-chart-1', '#4f8cff'),
        topColor: cssVar(el, '--m-chart-1', '#4f8cff'),
        bottomColor: 'transparent',
        lineWidth: 2,
      });
      chartRef.current = chart;
      seriesRef.current = series;
      if (env?.series?.length) series.setData(env.series.map((r) => ({ time: r.time, value: r.close })));
      const onResize = () => chart.applyOptions({ width: el.clientWidth });
      window.addEventListener('resize', onResize);
      chart._mmmOnResize = onResize;
    });
    return () => {
      disposed = true;
      if (chartRef.current) {
        window.removeEventListener('resize', chartRef.current._mmmOnResize);
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (seriesRef.current && env?.series?.length) {
      seriesRef.current.setData(env.series.map((r) => ({ time: r.time, value: r.close })));
    }
  }, [env]);

  function onSubmit(e) {
    e.preventDefault();
    const s = input.trim().toUpperCase();
    if (s) setSymbol(s);
  }

  const q = env?.quote;

  return (
    <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
      <Card>
        <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 14 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Symbol (e.g. SPY)"
            className="m-input"
            style={{ width: 140, textTransform: 'uppercase' }}
            aria-label="Symbol"
          />
          <button type="submit" className="m-btn m-btn-primary m-btn-sm">Load</button>
          <select value={range} onChange={(e) => setRange(e.target.value)} className="m-input" aria-label="Range" style={{ width: 100 }}>
            {RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={interval} onChange={(e) => setInterval_(e.target.value)} className="m-input" aria-label="Interval" style={{ width: 100 }}>
            {INTERVALS.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          {env && <StatusChip stale={env.stale} offline={env.offline} cached_at={env.cached_at} />}
        </form>
      </Card>

      {loading && <Skeleton height={320} />}
      {!loading && error && <ErrorState message={error} />}
      {!loading && !error && env && (
        <>
          <Card>
            <div style={{ padding: 14, display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--m-ink)' }}>{symbol}</div>
              <div style={{ fontSize: 20, fontWeight: 600, ...num, color: 'var(--m-ink)' }}>{f$(q?.price)}</div>
              <div style={{ fontSize: 14, fontWeight: 600, ...num, color: changeColor(q?.changePct) }}>
                {fPct(q?.changePct)} ({q?.change != null ? (q.change >= 0 ? '+' : '') + q.change.toFixed(2) : '—'})
              </div>
            </div>
            {!env.series?.length ? (
              <div style={{ padding: 14 }}>
                <EmptyChart />
              </div>
            ) : (
              <div ref={containerRef} style={{ width: '100%', height: 320 }} />
            )}
          </Card>

          {/* Accessible, canvas-independent fallback — same OHLC rows as the chart above. */}
          {env.series?.length > 0 && (
            <Card>
              <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: 'var(--m-ink-2)' }}>
                Price history (table view)
              </div>
              <div style={{ maxHeight: 260, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--m-border)', textAlign: 'right' }}>
                      {['Date', 'Open', 'High', 'Low', 'Close', 'Volume'].map((h, i) => (
                        <th key={h} style={{ padding: '8px 12px', color: 'var(--m-muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...env.series].reverse().map((row) => (
                      <tr key={row.time} style={{ borderBottom: '1px solid var(--m-border)' }}>
                        <td style={{ padding: '8px 12px', color: 'var(--m-ink-2)' }}>{row.time}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--m-ink-2)', ...num }}>{f$(row.open)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--m-ink-2)', ...num }}>{f$(row.high)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--m-ink-2)', ...num }}>{f$(row.low)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--m-ink)', fontWeight: 600, ...num }}>{f$(row.close)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--m-muted)', ...num }}>{row.volume != null ? row.volume.toLocaleString('en-US') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function EmptyChart() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--m-ink-2)', fontSize: 13 }}>
      <LineChartIcon size={18} aria-hidden="true" />
      No price history yet — enable Market data in Settings, or check the symbol.
    </div>
  );
}
