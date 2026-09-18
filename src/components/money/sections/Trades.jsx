import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { CandlestickChart } from 'lucide-react';
import SectionHeader from '../shared/SectionHeader';
import Skeleton from '../shared/Skeleton';
import ComingSoon from '../shared/ComingSoon';

const TABS = [
  { id: 'open', label: 'Open', Comp: lazy(() => import('./parts/trades/Open')) },
  { id: 'closed', label: 'Closed', Comp: lazy(() => import('./parts/trades/Closed')) },
  { id: 'journal', label: 'Journal', Comp: lazy(() => import('./parts/trades/Journal')) },
  { id: 'backtest', label: 'Backtest', Comp: BacktestComingSoon },
];

function BacktestComingSoon() {
  return <ComingSoon title="Backtest" description="Strategy backtesting lands in a later sprint." />;
}

export default function Trades() {
  return (
    <div>
      <SectionHeader icon={CandlestickChart} title="Trades" subtitle="Paper trading — practice positions against the strategy gate, zero real risk" />
      <div className="m-tabs" role="tablist">
        {TABS.map((t) => (
          <NavLink key={t.id} to={`/trades/${t.id}`} role="tab" className={({ isActive }) => `m-tab ${isActive ? 'active' : ''}`}>
            {t.label}
          </NavLink>
        ))}
      </div>
      <Suspense fallback={<Skeleton height={280} style={{ marginTop: 16 }} />}>
        <Routes>
          <Route path="/" element={<Navigate to="open" replace />} />
          {TABS.map(({ id, Comp }) => <Route key={id} path={id} element={<Comp />} />)}
          <Route path="*" element={<Navigate to="open" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}
