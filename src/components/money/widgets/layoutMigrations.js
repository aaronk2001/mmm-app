// Ordered, idempotent dashboard-layout migrations. Replaces the old
// insightsSeeded / insightsGrown / isCollapsedLayout flag pile.
export const LAYOUT_VERSION = 3;

const RIGHT_COL_X = 8;
function pushDown(layout, pred, by) { return layout.map(l => (pred(l) ? { ...l, y: l.y + by } : l)); }

const MIGRATIONS = [
  { v: 1, up: (layout, defs) => (!defs.insights || layout.some(l => l.i === 'insights') ? layout
      : [{ i: 'insights', x: 0, y: 0, w: defs.insights.w, h: defs.insights.h }, ...pushDown(layout, () => true, defs.insights.h)]) },
  { v: 2, up: (layout) => layout.map(l => (l.i === 'insights' && l.h < 6 ? { ...l, h: 6 } : l)) },
  { v: 3, up: (layout, defs) => (!defs.runway || layout.some(l => l.i === 'runway') ? layout
      : [{ i: 'runway', x: RIGHT_COL_X, y: 0, w: defs.runway.w, h: defs.runway.h }, ...pushDown(layout, l => l.x >= RIGHT_COL_X, defs.runway.h)]) },
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
