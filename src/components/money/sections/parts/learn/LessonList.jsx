import { Link } from 'react-router-dom';
import { CheckCircle2, CircleDashed, Flame, PlayCircle, RotateCcw } from 'lucide-react';
import Card from '../../../shared/Card';
import Skeleton from '../../../shared/Skeleton';
import { useApi } from '../../../../../lib/query';

const STATUS_META = {
  not_started: { icon: CircleDashed, color: 'var(--m-muted)', label: 'Not started' },
  in_progress: { icon: PlayCircle, color: 'var(--m-accent)', label: 'In progress' },
  completed: { icon: CheckCircle2, color: 'var(--m-green)', label: 'Completed' },
  mastered: { icon: CheckCircle2, color: 'var(--m-green)', label: 'Mastered' },
};

function moduleLabel(id) {
  return String(id || '').replace(/^m\d+-/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Groups the flat lesson list by module while preserving the server's own
// ordering (content.js loads lessons in `order` already) — nothing is
// re-sorted client-side.
function groupByModule(lessons) {
  const groups = [];
  const byId = new Map();
  for (const lesson of lessons) {
    if (!byId.has(lesson.module)) {
      const g = { module: lesson.module, lessons: [] };
      byId.set(lesson.module, g);
      groups.push(g);
    }
    byId.get(lesson.module).lessons.push(lesson);
  }
  return groups;
}

export default function LessonList() {
  const { data, isLoading } = useApi('learn/lessons');
  const { data: streak } = useApi('learn/streak');
  const { data: due } = useApi('learn/review/session');
  const lessons = data?.lessons || [];
  const groups = groupByModule(lessons);
  const dueCount = due?.cards?.length || 0;

  if (isLoading) return <Skeleton height={280} />;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {!!streak?.current_streak && (
          <Card hoverable={false} className="m-card-sm" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Flame size={16} style={{ color: 'var(--m-amber)' }} aria-hidden="true" />
            <span style={{ fontSize: 13, color: 'var(--m-ink)' }}>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{streak.current_streak}</strong>-day streak
            </span>
          </Card>
        )}
        <Link to="/learn/review" className="m-card m-card-sm m-card-no-hover" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <RotateCcw size={16} style={{ color: 'var(--m-accent)' }} aria-hidden="true" />
          <span style={{ fontSize: 13, color: 'var(--m-ink)' }}>
            {dueCount > 0 ? <><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{dueCount}</strong> due for review</> : 'No reviews due'}
          </span>
        </Link>
      </div>

      {groups.map((g) => (
        <div key={g.module}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--m-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>
            {moduleLabel(g.module)}
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {g.lessons.map((lesson) => {
              const meta = STATUS_META[lesson.status] || STATUS_META.not_started;
              const Icon = meta.icon;
              return (
                <Link key={lesson.id} to={`/learn/lesson/${lesson.id}`} style={{ textDecoration: 'none' }}>
                  <Card className="m-card-sm" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Icon size={20} style={{ color: meta.color, flexShrink: 0 }} aria-hidden="true" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--m-ink)' }}>{lesson.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--m-ink-2)' }}>
                        {meta.label}{lesson.score_pct != null ? ` — ${lesson.score_pct}%` : ''} · {lesson.est_minutes} min
                        {lesson.gate ? ' · mastery-gated' : ''}
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      {!groups.length && <div style={{ color: 'var(--m-muted)' }}>No lessons available yet.</div>}
    </div>
  );
}
