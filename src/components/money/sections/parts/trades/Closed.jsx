import Card from '../../../shared/Card';
import ErrorState from '../../../shared/ErrorState';
import Skeleton from '../../../shared/Skeleton';
import EmptyState from '../../../shared/EmptyState';
import { useApi } from '../../../../../lib/query';

const num = { fontVariantNumeric: 'tabular-nums' };
const f$ = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();
const fSigned = (n) => (Number(n) >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(Number(n) || 0)).toLocaleString();

// SVG equity curve over cumulative pnl of closed trades in chronological
// order — ported from nexus-app's PaperTrading.jsx EquityCurve, re-themed
// on --m-* tokens.
function EquityCurve({ trades }) {
  const sorted = [...trades].sort((a, b) => new Date(a.closed_at) - new Date(b.closed_at));
  const points = [0];
  let cum = 0;
  sorted.forEach((t) => { cum += t.pnl; points.push(cum); });

  const W = 600, H = 80, PAD = 8;
  const minY = Math.min(...points), maxY = Math.max(...points);
  const rangeY = maxY - minY || 1;
  const toX = (i) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const toY = (v) => PAD + (1 - (v - minY) / rangeY) * (H - PAD * 2);
  const polyPts = points.map((v, i) => `${toX(i).toFixed(2)},${toY(v).toFixed(2)}`).join(' ');
  const firstX = toX(0).toFixed(2);
  const lastX = toX(points.length - 1).toFixed(2);
  const baseY = (H - PAD).toFixed(2);
  const areaPoints = `${firstX},${baseY} ${polyPts} ${lastX},${baseY}`;
  const endPositive = cum >= 0;
  const lineColor = endPositive ? 'var(--m-green)' : 'var(--m-red)';
  const fillColor = endPositive ? 'var(--m-green-bg)' : 'var(--m-red-bg)';
  const zeroY = toY(0).toFixed(2);

  return (
    <Card className="m-card-no-hover" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)' }}>Equity curve — {sorted.length} closed trade{sorted.length !== 1 ? 's' : ''}</div>
        <div style={{ fontWeight: 700, fontSize: 14, color: lineColor, ...num }}>{fSigned(cum)}</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="80" preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="var(--m-border)" strokeWidth="1" strokeDasharray="3 3" />
        <polygon points={areaPoints} fill={fillColor} />
        <polyline points={polyPts} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={toX(points.length - 1)} cy={toY(cum)} r="3" fill={lineColor} />
      </svg>
    </Card>
  );
}

export default function Closed() {
  const { data: summary, isLoading, error, refetch } = useApi('trading/summary');

  if (isLoading) return <Skeleton height={220} />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  const trades = summary.closed_trades || [];
  if (trades.length === 0) {
    return <EmptyState title="No closed trades yet" message="Closed paper trades — and any imported from NEXUS — will show up here." />;
  }

  return (
    <div>
      <EquityCurve trades={trades} />
      <Card className="m-card-sm" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--m-border)', textAlign: 'left' }}>
              {['Ticker', 'Dir', 'Entry', 'Exit', 'P&L', '%', 'Closed'].map((h, i) => (
                <th key={i} style={{ padding: '10px 12px', color: 'var(--m-muted)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em', textAlign: i >= 2 && i <= 5 ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...trades].reverse().map((t) => {
              const up = t.pnl >= 0;
              return (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--m-border)' }}>
                  <td style={{ padding: '10px 12px', color: 'var(--m-ink)', fontWeight: 600 }}>
                    {t.ticker}
                    {t.source === 'nexus' && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--m-muted)' }}>(NEXUS)</span>}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, lineHeight: '16px', padding: '0 6px', borderRadius: 999, border: `1px solid ${t.direction === 'LONG' ? 'var(--m-green)' : 'var(--m-red)'}`, color: t.direction === 'LONG' ? 'var(--m-green)' : 'var(--m-red)' }}>{t.direction}</span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink-2)', ...num }}>{f$(t.entry_price)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--m-ink-2)', ...num }}>{f$(t.exit_price)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: up ? 'var(--m-green)' : 'var(--m-red)', ...num }}>{fSigned(t.pnl)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: up ? 'var(--m-green)' : 'var(--m-red)', ...num }}>{up ? '+' : ''}{t.pnl_pct?.toFixed(2)}%</td>
                  <td style={{ padding: '10px 12px', color: 'var(--m-muted)', fontSize: 12 }}>{new Date(t.closed_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
