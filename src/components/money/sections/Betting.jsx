import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { Dices } from 'lucide-react';
import SectionHeader from '../shared/SectionHeader';
import Skeleton from '../shared/Skeleton';

// Same shape as sections/Markets.jsx and sections/Intelligence.jsx: lazy
// sub-tabs behind NavLinks and a nested <Routes>, so this section works the
// moment the hub mounts it at /betting/*. Nothing here touches MoneyHub.jsx —
// the controller owns the nav entry and the route.
//
// Informational only: this section reads public prices and computes edges.
// There is no wager, no bankroll, no ledger write, and no write endpoint to
// call — the same posture as MMM's paper-only trading.
const TABS = [
  { id: 'prediction-markets', label: 'Prediction Markets', Comp: lazy(() => import('./parts/betting/PredictionMarkets')) },
  { id: 'sports-odds', label: 'Sports Odds', Comp: lazy(() => import('./parts/betting/SportsOdds')) },
  { id: 'value', label: 'Value / Arbitrage', Comp: lazy(() => import('./parts/betting/ValueBetting')) },
];

export default function Betting() {
  return (
    <div>
      <SectionHeader icon={Dices} title="Betting" subtitle="Prediction markets and sportsbook lines — informational only, off by default, cached when it's on" />
      <div className="m-tabs" role="tablist">
        {TABS.map((t) => (
          <NavLink key={t.id} to={`/betting/${t.id}`} role="tab" className={({ isActive }) => `m-tab ${isActive ? 'active' : ''}`}>
            {t.label}
          </NavLink>
        ))}
      </div>
      <Suspense fallback={<Skeleton height={280} style={{ marginTop: 16 }} />}>
        <Routes>
          <Route path="/" element={<Navigate to="prediction-markets" replace />} />
          {TABS.map(({ id, Comp }) => <Route key={id} path={id} element={<Comp />} />)}
          <Route path="*" element={<Navigate to="prediction-markets" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}
