import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { LineChart } from 'lucide-react';
import SectionHeader from '../shared/SectionHeader';
import Skeleton from '../shared/Skeleton';

const TABS = [
  { id: 'chart', label: 'Chart', Comp: lazy(() => import('./parts/markets/Chart')) },
  { id: 'watchlist', label: 'Watchlist', Comp: lazy(() => import('./parts/markets/Watchlist')) },
  { id: 'sectors', label: 'Sectors', Comp: lazy(() => import('./parts/markets/Sectors')) },
  { id: 'futures', label: 'Futures', Comp: lazy(() => import('./parts/markets/Futures')) },
  { id: 'crypto', label: 'Crypto', Comp: lazy(() => import('./parts/markets/Crypto')) },
  { id: 'forex', label: 'Forex', Comp: lazy(() => import('./parts/markets/Forex')) },
  { id: 'macro', label: 'Macro', Comp: lazy(() => import('./parts/markets/Macro')) },
  { id: 'screener', label: 'Screener', Comp: lazy(() => import('./parts/markets/Screener')) },
];

export default function Markets() {
  return (
    <div>
      <SectionHeader icon={LineChart} title="Markets" subtitle="Quotes, charts, and macro data — off by default, cached when it's on" />
      <div className="m-tabs" role="tablist">
        {TABS.map((t) => (
          <NavLink key={t.id} to={`/markets/${t.id}`} role="tab" className={({ isActive }) => `m-tab ${isActive ? 'active' : ''}`}>
            {t.label}
          </NavLink>
        ))}
      </div>
      <Suspense fallback={<Skeleton height={280} style={{ marginTop: 16 }} />}>
        <Routes>
          <Route path="/" element={<Navigate to="chart" replace />} />
          {TABS.map(({ id, Comp }) => <Route key={id} path={id} element={<Comp />} />)}
          <Route path="*" element={<Navigate to="chart" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}
