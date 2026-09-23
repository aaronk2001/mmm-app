// Markets tab enrichment — pure display-logic helpers pulled out of
// parts/markets/common.jsx so they're covered without a DOM harness (this
// project has none; see AnimatedNumber/stepTween for the same pattern).
import { describe, it, expect } from 'vitest';
import { rangeStr, sortByPctDesc, formatUpdatedAt, fVol } from '../src/components/money/sections/parts/markets/common.jsx';

describe('fVol', () => {
  it('formats a volume with thousands separators', () => {
    expect(fVol(45_000_000)).toBe('45,000,000');
  });
  it('renders an em dash for missing volume', () => {
    expect(fVol(null)).toBe('—');
    expect(fVol(undefined)).toBe('—');
  });
});

describe('rangeStr', () => {
  it('formats a low–high dollar range', () => {
    expect(rangeStr(148, 152)).toBe('$148.00 – $152.00');
  });
  it('renders an em dash when either side is missing', () => {
    expect(rangeStr(null, 152)).toBe('—');
    expect(rangeStr(148, null)).toBe('—');
    expect(rangeStr(null, null)).toBe('—');
  });
});

describe('sortByPctDesc', () => {
  it('sorts biggest gainer first', () => {
    const items = [{ id: 'a', pct: -1 }, { id: 'b', pct: 3 }, { id: 'c', pct: 0.5 }];
    const sorted = sortByPctDesc(items, (x) => x.pct).map((x) => x.id);
    expect(sorted).toEqual(['b', 'c', 'a']);
  });
  it('pushes null/missing pct values to the end without throwing', () => {
    const items = [{ id: 'a', pct: null }, { id: 'b', pct: 2 }, { id: 'c', pct: undefined }];
    const sorted = sortByPctDesc(items, (x) => x.pct).map((x) => x.id);
    expect(sorted).toEqual(['b', 'a', 'c']);
  });
  it('does not mutate the input array', () => {
    const items = [{ pct: 1 }, { pct: 2 }];
    const copy = [...items];
    sortByPctDesc(items, (x) => x.pct);
    expect(items).toEqual(copy);
  });
});

describe('formatUpdatedAt', () => {
  const now = new Date('2026-09-23T18:00:00Z').getTime();

  it('returns null when there is no cached_at yet', () => {
    expect(formatUpdatedAt(null, now)).toBeNull();
    expect(formatUpdatedAt(undefined, now)).toBeNull();
  });

  it('says "just now" within the first minute', () => {
    const cachedAt = new Date(now - 30_000).toISOString();
    expect(formatUpdatedAt(cachedAt, now)).toBe('Updated just now');
  });

  it('reports minutes ago within the first hour', () => {
    const cachedAt = new Date(now - 5 * 60_000).toISOString();
    expect(formatUpdatedAt(cachedAt, now)).toBe('Updated 5m ago');
  });

  it('falls back to a clock time for older-but-same-day timestamps', () => {
    const cachedAt = new Date(now - 3 * 3_600_000).toISOString(); // 3h earlier, same UTC day
    expect(formatUpdatedAt(cachedAt, now)).toMatch(/^Updated \d{1,2}:\d{2}/);
  });

  it('falls back to a month/day label once the timestamp is from a prior day', () => {
    const cachedAt = new Date(now - 3 * 24 * 3_600_000).toISOString();
    expect(formatUpdatedAt(cachedAt, now)).toMatch(/^Updated [A-Za-z]{3} \d{1,2}$/);
  });
});
