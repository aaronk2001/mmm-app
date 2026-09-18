import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import SectionHeader from '../shared/SectionHeader';
import Skeleton from '../shared/Skeleton';

const TABS = [
  { id: 'take-home',  label: 'Take-home',      Comp: lazy(() => import('./parts/plan/TakeHome')) },
  { id: 'offer',      label: 'Model an offer', Comp: lazy(() => import('./parts/plan/ModelOffer')) },
  { id: 'raise',      label: 'Raise',          Comp: lazy(() => import('./parts/plan/Raise')) },
  { id: 'retirement', label: 'Roth & FIRE',    Comp: lazy(() => import('./parts/plan/Retirement')) },
  { id: 'what-if',    label: 'What-if',        Comp: lazy(() => import('./parts/plan/WhatIf')) },
];

export default function Plan() {
  return (
    <div>
      <SectionHeader title="Plan" subtitle="Model the money decisions in front of you." />
      <div className="m-tabs" role="tablist">
        {TABS.map((t) => (
          <NavLink key={t.id} to={`/plan/${t.id}`} role="tab"
            className={({ isActive }) => `m-tab ${isActive ? 'active' : ''}`}>{t.label}</NavLink>
        ))}
      </div>
      <Suspense fallback={<Skeleton height={280} style={{ marginTop: 16 }} />}>
        <Routes>
          <Route path="/" element={<Navigate to="take-home" replace />} />
          {TABS.map(({ id, Comp }) => <Route key={id} path={id} element={<Comp />} />)}
          <Route path="*" element={<Navigate to="take-home" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}
