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
});

describe('inferLegacyVersion', () => {
  it('maps the old flags onto versions', () => {
    expect(inferLegacyVersion({})).toBe(0);
    expect(inferLegacyVersion({ insightsSeeded: true })).toBe(1);
    expect(inferLegacyVersion({ insightsSeeded: true, insightsGrown: true })).toBe(2);
    expect(inferLegacyVersion({ dashboards: { overview: { schemaVersion: 3 } } })).toBe(3);
  });
});
