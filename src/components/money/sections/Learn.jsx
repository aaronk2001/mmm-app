import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import SectionHeader from '../shared/SectionHeader';
import Skeleton from '../shared/Skeleton';

const LessonList = lazy(() => import('./parts/learn/LessonList'));
const LessonRunner = lazy(() => import('./parts/learn/LessonRunner'));
const ReviewQueue = lazy(() => import('./parts/learn/ReviewQueue'));
const Glossary = lazy(() => import('./parts/learn/Glossary'));

const TABS = [
  { id: '', label: 'Lessons' },
  { id: 'review', label: 'Review' },
  { id: 'glossary', label: 'Glossary' },
];

export default function Learn() {
  const location = useLocation();
  // The lesson runner is an immersive, one-step-per-screen experience (see
  // LessonRunner.jsx) — the tab bar and section chrome step aside while a
  // lesson is in progress, same as the pattern gives it its own Esc-to-exit.
  const inRunner = /^\/learn\/lesson\//.test(location.pathname);

  return (
    <div>
      {!inRunner && (
        <>
          <SectionHeader icon={GraduationCap} title="Learn" subtitle="Short, personalized lessons on your own numbers, plus spaced review and a glossary." />
          <div className="m-tabs" role="tablist">
            {TABS.map((t) => (
              <NavLink key={t.id || 'index'} to={`/learn/${t.id}`} end={t.id === ''}
                className={({ isActive }) => `m-tab ${isActive ? 'active' : ''}`}>{t.label}</NavLink>
            ))}
          </div>
        </>
      )}
      <Suspense fallback={<Skeleton height={280} style={{ marginTop: inRunner ? 0 : 16 }} />}>
        <Routes>
          <Route path="/" element={<LessonList />} />
          <Route path="lesson/:id" element={<LessonRunner />} />
          <Route path="review" element={<ReviewQueue />} />
          <Route path="glossary" element={<Glossary />} />
          <Route path="*" element={<Navigate to="." replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}
