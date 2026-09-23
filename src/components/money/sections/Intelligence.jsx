import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { Newspaper } from 'lucide-react';
import SectionHeader from '../shared/SectionHeader';
import Skeleton from '../shared/Skeleton';

// Same shape as sections/Markets.jsx: lazy sub-tabs behind NavLinks and a
// nested <Routes>, so this section works the moment the hub mounts it at
// /intelligence/*. Nothing here touches MoneyHub.jsx — the controller owns
// the nav entry and the route.
const TABS = [
  { id: 'news', label: 'News', Comp: lazy(() => import('./parts/intelligence/News')) },
  { id: 'media', label: 'Media', Comp: lazy(() => import('./parts/intelligence/Media')) },
];

export default function Intelligence() {
  return (
    <div>
      <SectionHeader icon={Newspaper} title="Intelligence" subtitle="Market headlines and curated finance media — news is off by default, cached when it's on" />
      <div className="m-tabs" role="tablist">
        {TABS.map((t) => (
          <NavLink key={t.id} to={`/intelligence/${t.id}`} role="tab" className={({ isActive }) => `m-tab ${isActive ? 'active' : ''}`}>
            {t.label}
          </NavLink>
        ))}
      </div>
      <Suspense fallback={<Skeleton height={280} style={{ marginTop: 16 }} />}>
        <Routes>
          <Route path="/" element={<Navigate to="news" replace />} />
          {TABS.map(({ id, Comp }) => <Route key={id} path={id} element={<Comp />} />)}
          <Route path="*" element={<Navigate to="news" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}
