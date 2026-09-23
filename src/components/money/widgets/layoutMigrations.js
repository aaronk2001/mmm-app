// Ordered, idempotent dashboard-layout migrations. Replaces the old
// insightsSeeded / insightsGrown / isCollapsedLayout flag pile.
export const LAYOUT_VERSION = 5;

const RIGHT_COL_X = 8;
function pushDown(layout, pred, by) { return layout.map(l => (pred(l) ? { ...l, y: l.y + by } : l)); }

const MIGRATIONS = [
  { v: 1, up: (layout, defs) => (!defs.insights || layout.some(l => l.i === 'insights') ? layout
      : [{ i: 'insights', x: 0, y: 0, w: defs.insights.w, h: defs.insights.h }, ...pushDown(layout, () => true, defs.insights.h)]) },
  { v: 2, up: (layout) => layout.map(l => (l.i === 'insights' && l.h < 6 ? { ...l, h: 6 } : l)) },
  { v: 3, up: (layout, defs) => (!defs.runway || layout.some(l => l.i === 'runway') ? layout
      : [{ i: 'runway', x: RIGHT_COL_X, y: 0, w: defs.runway.w, h: defs.runway.h }, ...pushDown(layout, l => l.x + l.w > RIGHT_COL_X, defs.runway.h)]) },
  // Sprint D, Wave 2: appends the new Today's Lesson widget below whatever
  // an existing user already has, rather than inserting into the middle of
  // their layout — avoids reflowing rows they've already arranged, unlike
  // the runway migration above (which had a specific column to slot into).
  { v: 4, up: (layout, defs) => (!defs.todaysLesson || layout.some(l => l.i === 'todaysLesson') ? layout
      : [...layout, { i: 'todaysLesson', x: 0, y: layout.reduce((max, l) => Math.max(max, l.y + l.h), 0), w: defs.todaysLesson.w, h: defs.todaysLesson.h }]) },
  // v5: Top News. Appends below the existing layout, exactly like v4 — an
  // existing user gets the widget without any of their rows reflowing, and
  // the `layout.some(...)` guard means removing it never resurrects it.
  { v: 5, up: (layout, defs) => (!defs.topNews || layout.some(l => l.i === 'topNews') ? layout
      : [...layout, { i: 'topNews', x: 0, y: layout.reduce((max, l) => Math.max(max, l.y + l.h), 0), w: defs.topNews.w, h: defs.topNews.h }]) },
];

export function migrateLayout(saved, fromVersion, defs) {
  let layout = saved;
  let version = Number(fromVersion) || 0;
  for (const m of MIGRATIONS) {
    if (m.v <= version) continue;
    layout = m.up(layout, defs);
    version = m.v;
  }
  return { layout, version };
}

export function inferLegacyVersion(settings = {}) {
  const v = settings?.dashboards?.overview?.schemaVersion;
  if (Number.isInteger(v)) return v;
  if (settings.insightsSeeded && settings.insightsGrown) return 2;
  if (settings.insightsSeeded) return 1;
  return 0;
}
