// Settings → Online & Keys rows stay in sync with the server's feature list,
// and every row carries a free-option tip with only https links.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { FEATURES } from '../src/components/money/sections/parts/settings/onlineFeatures.js';

const require = createRequire(import.meta.url);
const SERVER_FEATURES = require('../server/online/features.js');

describe('OnlinePanel FEATURES', () => {
  it('every row is a real server feature, listed once', () => {
    for (const f of FEATURES) expect(SERVER_FEATURES).toContain(f.key);
    expect(new Set(FEATURES.map((f) => f.key)).size).toBe(FEATURES.length);
  });

  it('every Research provider and cloud backend has a row', () => {
    for (const k of ['finnhub', 'exa', 'financialDatasets', 'cloudLlm', 'openaiCompat']) {
      expect(FEATURES.map((f) => f.key)).toContain(k);
    }
  });

  it('every row has a free-option tip, and every link is https', () => {
    for (const f of FEATURES) {
      expect(typeof f.free.text).toBe('string');
      expect(f.free.text.length).toBeGreaterThan(0);
      for (const l of f.free.links) expect(l.url).toMatch(/^https:\/\//);
    }
  });
});
