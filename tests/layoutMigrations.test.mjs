import { describe, it, expect } from 'vitest';
import { migrateLayout, LAYOUT_VERSION, inferLegacyVersion } from '../src/components/money/widgets/layoutMigrations.js';

const defs = { insights: { w: 8, h: 6 }, runway: { w: 4, h: 2 }, netWorth: { w: 4, h: 2 } };

describe('migrateLayout', () => {
  it('seeds insights, grows it, then seeds runway for a v0 layout', () => {
    const saved = [{ i: 'netWorth', x: 8, y: 0, w: 4, h: 2 }];
    const { layout, version } = migrateLayout(saved, 0, defs);
    expect(version).toBe(LAYOUT_VERSION);
    expect(layout.find(l => l.i === 'insights')).toMatchObject({ x: 0, y: 0, w: 8, h: 6 });
    expect(layout.find(l => l.i === 'runway')).toMatchObject({ x: 8, y: 0, w: 4, h: 2 });
    expect(layout.find(l => l.i === 'netWorth').y).toBeGreaterThanOrEqual(2);
  });

  it('is a no-op at the current version', () => {
    const saved = [{ i: 'runway', x: 8, y: 0, w: 4, h: 2 }];
    expect(migrateLayout(saved, LAYOUT_VERSION, defs).layout).toEqual(saved);
  });

  it('does not re-add a widget the user removed after its seeding version', () => {
    const saved = [{ i: 'netWorth', x: 8, y: 0, w: 4, h: 2 }];
    const { layout } = migrateLayout(saved, 2, defs); // v3 only
    expect(layout.some(l => l.i === 'insights')).toBe(false);
    expect(layout.some(l => l.i === 'runway')).toBe(true);
  });

  it('v5 appends Top News below an existing layout without reflowing it', () => {
    const withNews = { ...defs, topNews: { w: 4, h: 4 } };
    const saved = [{ i: 'runway', x: 8, y: 0, w: 4, h: 2 }, { i: 'netWorth', x: 0, y: 2, w: 4, h: 2 }];
    const { layout, version } = migrateLayout(saved, 4, withNews);
    expect(version).toBe(LAYOUT_VERSION);
    expect(layout.find(l => l.i === 'topNews')).toMatchObject({ i: 'topNews', x: 0, y: 4, w: 4, h: 4 });
    expect(layout.find(l => l.i === 'runway')).toEqual(saved[0]);   // untouched
    expect(layout.find(l => l.i === 'netWorth')).toEqual(saved[1]); // untouched
  });

  it('v5 does not resurrect Top News once the user removes it', () => {
    const withNews = { ...defs, topNews: { w: 4, h: 4 } };
    const saved = [{ i: 'runway', x: 8, y: 0, w: 4, h: 2 }];
    expect(migrateLayout(saved, 5, withNews).layout).toEqual(saved);
  });

  it('v3 pushes a widget that spans into the right column, not only ones starting there', () => {
    const saved = [{ i: 'netWorth', x: 6, y: 0, w: 6, h: 2 }, { i: 'insights', x: 0, y: 2, w: 6, h: 6 }];
    const { layout } = migrateLayout(saved, 2, defs);
    expect(layout.find(l => l.i === 'runway')).toMatchObject({ x: 8, y: 0 });
    expect(layout.find(l => l.i === 'netWorth').y).toBe(2);   // pushed by runway's h
    expect(layout.find(l => l.i === 'insights').y).toBe(2);   // untouched (x+w = 6, not into the right column)
  });
});

describe('inferLegacyVersion', () => {
  it('maps the old flags onto versions', () => {
    expect(inferLegacyVersion({})).toBe(0);
    expect(inferLegacyVersion({ insightsSeeded: true })).toBe(1);
    expect(inferLegacyVersion({ insightsSeeded: true, insightsGrown: true })).toBe(2);
    expect(inferLegacyVersion({ dashboards: { overview: { schemaVersion: 3 } } })).toBe(3);
  });
});
