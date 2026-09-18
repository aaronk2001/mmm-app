import { useMemo, useState } from 'react';
import { Shield } from 'lucide-react';
import Card from '../../../shared/Card';

// Ported from nexus-app/src/components/nexus/RiskCalculator.jsx — pure
// client-side math, no backend dependency. Rebuilt on --m-* tokens (no
// GlassInput/tailwind/motion) and NEXUS's purple/cyan chart colors dropped
// in favor of --m-chart-N since no purple/cyan token exists in money-theme.css.
function kelly(winRate, avgWin, avgLoss) {
  if (avgLoss === 0) return 0;
  const r = avgWin / avgLoss;
  const w = winRate / 100;
  const k = w - (1 - w) / r;
  return Math.max(0, Math.min(k * 100, 25));
}

function simulate(account, riskPct, winRate, rMultiple, trades = 10) {
  const results = [account];
  let balance = account;
  for (let i = 0; i < trades; i++) {
    const risk = balance * (riskPct / 100);
    if (Math.random() * 100 < winRate) balance += risk * rMultiple;
    else balance -= risk;
    results.push(Math.round(balance));
  }
  return results;
}

const num = { fontVariantNumeric: 'tabular-nums' };
const COLORS = ['var(--m-chart-1)', 'var(--m-chart-2)', 'var(--m-chart-3)', 'var(--m-chart-4)', 'var(--m-chart-5)'];

export default function RiskCalculator() {
  const [account, setAccount] = useState(30000);
  const [riskPct, setRiskPct] = useState(1);
  const [entry, setEntry] = useState(100);
  const [stop, setStop] = useState(97);
  const [winRate, setWinRate] = useState(55);
  const [avgWin, setAvgWin] = useState(2);
  const [avgLoss, setAvgLoss] = useState(1);
  const [simRuns, setSimRuns] = useState(null);

  const riskAmount = (account * riskPct) / 100;
  const riskPerSh = Math.abs(entry - stop);
  const shares = riskPerSh > 0 ? Math.floor(riskAmount / riskPerSh) : 0;
  const positionVal = shares * entry;
  const positionPct = account > 0 ? (positionVal / account) * 100 : 0;
  const kellyPct = kelly(winRate, avgWin, avgLoss);
  const halfKelly = kellyPct / 2;

  const runSims = () => {
    const runs = Array.from({ length: 5 }, () => simulate(account, riskPct, winRate, avgWin / avgLoss));
    setSimRuns(runs);
  };

  const equityChart = useMemo(() => {
    if (!simRuns) return null;
    const allVals = simRuns.flat();
    const minV = Math.min(...allVals), maxV = Math.max(...allVals);
    const range = maxV - minV || 1;
    const W = 500, H = 120, PAD_L = 60, PAD_B = 20;
    const chartW = W - PAD_L, chartH = H - PAD_B, N = 11;
    const toX = (i) => PAD_L + (i / (N - 1)) * chartW;
    const toY = (v) => PAD_B / 2 + chartH - ((v - minV) / range) * chartH;

    return (
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        <line x1={PAD_L} y1={toY(account)} x2={W} y2={toY(account)} stroke="var(--m-border)" strokeWidth="1" strokeDasharray="4 3" />
        <text x={PAD_L - 4} y={toY(account) + 4} textAnchor="end" fill="var(--m-muted)" fontSize="9">$0 chg</text>
        {simRuns.map((run, ri) => {
          const pts = run.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
          const color = COLORS[ri % COLORS.length];
          const final = run[run.length - 1];
          return (
            <g key={ri}>
              <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeOpacity="0.85" />
              <text x={W - 2} y={toY(final) + 4} textAnchor="end" fill={color} fontSize="9" fontWeight="700">
                ${Math.round(final).toLocaleString()}
              </text>
            </g>
          );
        })}
        {Array.from({ length: N }).map((_, i) => (
          <text key={i} x={toX(i)} y={H - 2} textAnchor="middle" fill="var(--m-muted)" fontSize="9">T{i}</text>
        ))}
      </svg>
    );
  }, [simRuns, account]);

  return (
    <Card className="m-card-no-hover" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Shield size={16} style={{ color: 'var(--m-accent)' }} aria-hidden="true" />
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--m-ink)' }}>Risk calculator</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <div style={{ background: 'var(--m-surface-2)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)', marginBottom: 10 }}>Position sizing</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row label="Account size ($)"><input className="m-input" type="number" value={account} onChange={(e) => setAccount(Number(e.target.value))} min={0} /></Row>
            <Row label="Risk per trade (%)"><input className="m-input" type="number" value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))} min={0.1} max={10} step={0.1} /></Row>
            <Row label="Entry price ($)"><input className="m-input" type="number" value={entry} onChange={(e) => setEntry(Number(e.target.value))} min={0} step={0.01} /></Row>
            <Row label="Stop price ($)"><input className="m-input" type="number" value={stop} onChange={(e) => setStop(Number(e.target.value))} min={0} step={0.01} /></Row>
          </div>
          <div style={{ marginTop: 12, borderRadius: 10, padding: 10, background: 'var(--m-surface)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <ResultRow label="Risk amount" value={`$${Math.round(riskAmount).toLocaleString()}`} />
            <ResultRow label="Risk per share" value={`$${riskPerSh.toFixed(2)}`} />
            <ResultRow label="Shares" value={shares.toLocaleString()} accent />
            <ResultRow label="Position value" value={`$${Math.round(positionVal).toLocaleString()}`} />
            <ResultRow label="% of account" value={`${positionPct.toFixed(1)}%`} color={positionPct > 20 ? 'var(--m-red)' : positionPct > 10 ? 'var(--m-amber)' : 'var(--m-ink)'} />
          </div>
        </div>

        <div style={{ background: 'var(--m-surface-2)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)', marginBottom: 10 }}>Kelly criterion</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row label="Win rate (%)"><input className="m-input" type="number" value={winRate} onChange={(e) => setWinRate(Number(e.target.value))} min={1} max={99} /></Row>
            <Row label="Avg win (R)"><input className="m-input" type="number" value={avgWin} onChange={(e) => setAvgWin(Number(e.target.value))} min={0.1} step={0.1} /></Row>
            <Row label="Avg loss (R)"><input className="m-input" type="number" value={avgLoss} onChange={(e) => setAvgLoss(Number(e.target.value))} min={0.1} step={0.1} /></Row>
          </div>
          <div style={{ marginTop: 12, borderRadius: 10, padding: 10, background: 'var(--m-surface)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <ResultRow label="Kelly %" value={`${kellyPct.toFixed(1)}%`} color={kellyPct > 20 ? 'var(--m-red)' : 'var(--m-green)'} accent />
            <ResultRow label="Half-Kelly (recommended)" value={`${halfKelly.toFixed(1)}%`} color="var(--m-accent)" />
            <ResultRow label="Kelly $ amount" value={`$${Math.round(account * kellyPct / 100).toLocaleString()}`} />
            <ResultRow label="Half-Kelly $ amount" value={`$${Math.round(account * halfKelly / 100).toLocaleString()}`} />
            <div style={{ marginTop: 4, padding: 8, borderRadius: 8, background: 'var(--m-accent-soft)' }}>
              <div style={{ fontSize: 11, color: 'var(--m-ink-2)', lineHeight: 1.5 }}>
                Kelly formula: W − (1−W)/R. Always use half-Kelly to account for estimation error.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, background: 'var(--m-surface-2)', borderRadius: 12, padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)' }}>10-trade equity simulator</div>
            <div style={{ fontSize: 11, color: 'var(--m-muted)' }}>5 Monte Carlo runs using the parameters above</div>
          </div>
          <button type="button" className="m-btn m-btn-primary m-btn-sm" onClick={runSims}>Run simulation</button>
        </div>
        {simRuns ? equityChart : (
          <div style={{ height: 100, borderRadius: 8, background: 'var(--m-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--m-muted)' }}>Click "Run simulation" to generate equity curves</div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <label style={{ fontSize: 12, color: 'var(--m-ink-2)', flexShrink: 0, width: 140 }} title={label}>{label}</label>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function ResultRow({ label, value, accent, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 12, color: 'var(--m-muted)' }}>{label}</span>
      <span style={{ fontWeight: accent ? 700 : 600, fontSize: accent ? 15 : 13, color: color || 'var(--m-ink)', ...num }}>{value}</span>
    </div>
  );
}
