// Pins parseYmd to LOCAL midnight. TZ is forced west of UTC so the naive
// new Date('YYYY-MM-DD') (UTC midnight = previous evening in Phoenix) fails here
// on any machine.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { parseYmd, todayYmd } from '../src/lib/localDate.js';

let prevTZ;
beforeAll(() => { prevTZ = process.env.TZ; process.env.TZ = 'America/Phoenix'; });
afterAll(() => { if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ; });

describe('parseYmd', () => {
  it('returns local midnight of the same calendar day', () => {
    const d = parseYmd('2026-09-23');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 8, 23, 0]);
  });

  it('does not roll back a day the way new Date(ymd) does west of UTC', () => {
    expect(new Date('2026-09-23').getDate()).toBe(22); // the bug this helper exists for
    expect(parseYmd('2026-09-23').getDate()).toBe(23);
  });

  it('keys on the first 10 chars, so a stray time suffix cannot shift the day', () => {
    expect(parseYmd('2026-01-31T23:59:59Z').getDate()).toBe(31);
  });

  it('orders and compares like the calendar', () => {
    expect(parseYmd('2026-03-01') - parseYmd('2026-02-28')).toBe(86400000);
  });
});

describe('todayYmd', () => {
  it('returns the LOCAL calendar day, not the UTC one, in the evening west of UTC', () => {
    // Sep 23, 8pm Phoenix local = Sep 24, 03:00 UTC — toISOString() would say the 24th.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 23, 20, 0));
    try {
      expect(new Date().toISOString().slice(0, 10)).toBe('2026-09-24'); // the bug this helper exists for
      expect(todayYmd()).toBe('2026-09-23');
    } finally {
      vi.useRealTimers();
    }
  });
});
