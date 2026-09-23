// The Intelligence section's untrusted-text helpers. @testing-library/react
// isn't a devDependency here, so this exercises the pure helpers directly —
// the same approach tests/animatedNumber.test.mjs takes.
import { describe, it, expect } from 'vitest';
import { isSafeHref, fmtWhen, relativeWhen, hostOf } from '../src/components/money/sections/parts/intelligence/common.jsx';

describe('isSafeHref — only http(s) ever becomes a link', () => {
  it('accepts http and https', () => {
    expect(isSafeHref('https://example.com/a')).toBe(true);
    expect(isSafeHref('http://example.com/a')).toBe(true);
  });

  it('rejects script-bearing and non-web schemes, and non-strings', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd',
      'vbscript:x', '  ', 'not a url', null, undefined, 42, {}]) {
      expect(isSafeHref(bad)).toBe(false);
    }
  });
});

describe('article timestamps stay instants', () => {
  it('fmtWhen renders a local date AND time, never a bare day key', () => {
    const out = fmtWhen('2026-03-04T14:05:00.000Z');
    expect(out).toBeTruthy();
    expect(out).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out).toMatch(/\d:\d{2}/); // a clock time survived
  });

  it('empty-ish and invalid instants render as an empty string, never "Invalid Date"', () => {
    for (const bad of [null, undefined, '', 'nonsense']) {
      expect(fmtWhen(bad)).toBe('');
      expect(relativeWhen(bad)).toBe('');
    }
  });

  it('relativeWhen buckets by minutes/hours/days', () => {
    const ago = (ms) => new Date(Date.now() - ms).toISOString();
    expect(relativeWhen(ago(10_000))).toBe('just now');
    expect(relativeWhen(ago(5 * 60_000))).toBe('5m ago');
    expect(relativeWhen(ago(3 * 3_600_000))).toBe('3h ago');
    expect(relativeWhen(ago(2 * 86_400_000))).toBe('2d ago');
  });
});

describe('hostOf', () => {
  it('strips www and survives garbage', () => {
    expect(hostOf('https://www.reuters.com/markets/x')).toBe('reuters.com');
    expect(hostOf('https://example.com')).toBe('example.com');
    expect(hostOf('nope')).toBe('');
    expect(hostOf(null)).toBe('');
  });
});
