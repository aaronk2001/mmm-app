// /api/news — the Marketaux port. Two properties are non-negotiable here and
// both are asserted with a stubbed global.fetch (no live network anywhere in
// this file):
//   1. `news` off, or no key stored → empty list + a reason, never a throw,
//      never a socket.
//   2. The API key never escapes into a cacheKey, a persisted cache row, or a
//      response body.
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createRequire } from 'node:module';
import { db } from '../server/db/connection.js';
import repo from '../server/db/repo.js';
import online from '../server/online/index.js';

const require = createRequire(import.meta.url);
const providers = require('../server/news/providers.js');
const newsRoutes = require('../server/news/routes.js');
const keys = require('../server/online/keys.js');

const KEY = 'sk-marketaux-secret-do-not-leak';
const originalFetch = global.fetch.bind(globalThis);

function setNews(on) {
  repo.setSettings(db(), { online: { news: on } });
}

function marketauxBody(rows) {
  return { meta: { found: rows.length }, data: rows };
}

function okResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const SAMPLE = [
  {
    uuid: 'uuid-1',
    title: 'Chips rally on strong guidance',
    description: 'Semis led the tape after an upbeat forecast.',
    url: 'https://example.com/chips',
    source: 'example.com',
    published_at: '2026-03-04T14:05:00.000000Z',
    entities: [{ symbol: 'nvda', name: 'NVIDIA' }, { symbol: 'AMD' }, { symbol: 'nvda' }],
  },
  {
    uuid: 'uuid-2',
    title: 'Older story',
    snippet: 'Snippet stands in for a missing description.',
    url: 'https://example.com/older',
    source: 'example.com',
    published_at: '2026-03-01T09:00:00.000000Z',
    entities: [],
  },
];

beforeEach(() => {
  online._resetForTests();
  keys.setKeys({});
  repo.setSettings(db(), { online: Object.fromEntries(online.FEATURES.map((f) => [f, false])) });
});
afterEach(() => {
  vi.restoreAllMocks();
  keys.setKeys({});
});

describe('normalizer', () => {
  it('maps Marketaux rows to the stable shape', () => {
    const [a, b] = providers.normalize(marketauxBody(SAMPLE));
    expect(a).toEqual({
      id: 'uuid-1',
      title: 'Chips rally on strong guidance',
      url: 'https://example.com/chips',
      source: 'example.com',
      published_at: '2026-03-04T14:05:00.000Z',
      summary: 'Semis led the tape after an upbeat forecast.',
      symbols: ['NVDA', 'AMD'],
    });
    expect(b.summary).toBe('Snippet stands in for a missing description.');
    expect(b.symbols).toEqual([]);
  });

  it('keeps published_at an ISO instant, not a day key', () => {
    const [a] = providers.normalize(marketauxBody([SAMPLE[0]]));
    expect(a.published_at).toBe('2026-03-04T14:05:00.000Z');
    expect(a.published_at).toMatch(/T\d{2}:\d{2}:\d{2}/);
  });

  it('sorts newest first and drops duplicate ids', () => {
    const rows = [SAMPLE[1], SAMPLE[0], { ...SAMPLE[0], title: 'dupe of uuid-1' }];
    const out = providers.normalize(marketauxBody(rows));
    expect(out.map((r) => r.id)).toEqual(['uuid-1', 'uuid-2']);
  });

  it('rejects non-http(s) urls and untitled rows', () => {
    const out = providers.normalize(marketauxBody([
      { uuid: 'x', title: 'Script kiddie', url: 'javascript:alert(1)' },
      { uuid: 'y', title: 'Data uri', url: 'data:text/html,<script>' },
      { uuid: 'z', title: '   ', url: 'https://example.com/ok' },
    ]));
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.url === null)).toBe(true);
  });

  it('never throws on garbage payloads', () => {
    for (const bad of [null, undefined, {}, { data: null }, { data: 'nope' }, { data: [null, 7, 'x'] }]) {
      expect(providers.normalize(bad)).toEqual([]);
    }
  });

  it('falls back to the url, then a title key, when uuid is missing', () => {
    const [a, b] = providers.normalize(marketauxBody([
      { title: 'No uuid', url: 'https://example.com/a' },
      { title: 'No uuid no url' },
    ]));
    expect(a.id).toBe('https://example.com/a');
    expect(b.id).toBe('No uuid no url:1');
  });
});

describe('providers — disabled / no-key paths never open a socket', () => {
  it('returns an empty list and a reason when news is off', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    keys.setKeys({ news: KEY });
    const env = await providers.marketaux.market();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(env.articles).toEqual([]);
    expect(env.reason).toBe(providers.OFF_REASON);
    expect(env.offline).toBe(true);
  });

  it('returns an empty list and a reason when the key is missing', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    setNews(true);
    const env = await providers.marketaux.forSymbol('AAPL');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(env.articles).toEqual([]);
    expect(env.reason).toBe(providers.NO_KEY_REASON);
  });

  it('never leaks the key into a reason or an article', async () => {
    setNews(false);
    keys.setKeys({ news: KEY });
    const env = await providers.marketaux.market();
    expect(JSON.stringify(env)).not.toContain(KEY);
  });
});

describe('providers — enabled path', () => {
  it('fetches, normalizes, and keeps the key out of the cacheKey and the cache row', async () => {
    setNews(true);
    keys.setKeys({ news: KEY });
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(okResponse(marketauxBody(SAMPLE)));

    const env = await providers.marketaux.market({ limit: 5 });
    expect(env.articles).toHaveLength(2);
    expect(env.offline).toBe(false);
    expect(JSON.stringify(env)).not.toContain(KEY);

    // The key IS in the outbound URL (it has to be) and nowhere else.
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain('api_token=');

    const row = repo.getHttpCacheEntry(db(), 'marketaux:market:5');
    expect(row).toBeTruthy();
    expect(row.url).toBe('https://api.marketaux.com/v1/news/all');
    expect(JSON.stringify(row)).not.toContain(KEY);
  });

  it('per-symbol uses a key-free, symbol-scoped cacheKey', async () => {
    setNews(true);
    keys.setKeys({ news: KEY });
    vi.spyOn(global, 'fetch').mockResolvedValue(okResponse(marketauxBody([SAMPLE[0]])));
    await providers.marketaux.forSymbol('nvda', { limit: 3 });
    const row = repo.getHttpCacheEntry(db(), 'marketaux:symbol:NVDA:3');
    expect(row).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(KEY);
  });

  it('a dead endpoint degrades to an empty list with a reason, never a throw', async () => {
    setNews(true);
    keys.setKeys({ news: KEY });
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const env = await providers.marketaux.market({ limit: 11 });
    expect(env.articles).toEqual([]);
    expect(env.reason).toBe(providers.NO_DATA_REASON);
    expect(env.offline).toBe(true);
  });
});

describe('routes: /api/news', () => {
  let server; let base;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/news', newsRoutes);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/news`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  function externalCalls(fetchSpy) {
    return fetchSpy.mock.calls.filter(([url]) => !String(url).startsWith(base));
  }

  it('GET /market 200s with an empty list and a reason when news is off', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const res = await fetch(`${base}/market`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.articles).toEqual([]);
    expect(body.reason).toBe(providers.OFF_REASON);
    expect(externalCalls(fetchSpy)).toHaveLength(0);
  });

  it('GET /:ticker 200s with an empty list when off, and 400s on a bad ticker', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const ok = await fetch(`${base}/AAPL`);
    expect(ok.status).toBe(200);
    expect((await ok.json()).articles).toEqual([]);

    const bad = await fetch(`${base}/not%20a%20ticker`);
    expect(bad.status).toBe(400);
    expect((await bad.json()).articles).toEqual([]);
    expect(externalCalls(fetchSpy)).toHaveLength(0);
  });

  // The harness talks to its own Express server with fetch(), so the stub has
  // to pass local calls through to the real implementation and only fake the
  // Marketaux host.
  it('"market" is the general feed, not a ticker lookup', async () => {
    setNews(true);
    keys.setKeys({ news: KEY });
    const spy = vi.spyOn(global, 'fetch').mockImplementation((url, opts) => (
      String(url).startsWith('https://api.marketaux.com')
        ? Promise.resolve(okResponse(marketauxBody(SAMPLE)))
        : originalFetch(url, opts)
    ));

    const res = await fetch(`${base}/market?limit=7`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.articles).toHaveLength(2);
    expect(body.articles[0].id).toBe('uuid-1');

    const marketauxUrls = spy.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('https://api.marketaux.com'));
    expect(marketauxUrls).toHaveLength(1);
    expect(marketauxUrls[0]).not.toContain('symbols=');
    expect(marketauxUrls[0]).toContain('limit=7');
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it('GET /:ticker reaches Marketaux with the symbol filter', async () => {
    setNews(true);
    keys.setKeys({ news: KEY });
    const spy = vi.spyOn(global, 'fetch').mockImplementation((url, opts) => (
      String(url).startsWith('https://api.marketaux.com')
        ? Promise.resolve(okResponse(marketauxBody([SAMPLE[0]])))
        : originalFetch(url, opts)
    ));

    const res = await fetch(`${base}/nvda`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.articles[0].symbols).toContain('NVDA');
    const url = spy.mock.calls.map(([u]) => String(u)).find((u) => u.startsWith('https://api.marketaux.com'));
    expect(url).toContain('symbols=NVDA');
    expect(JSON.stringify(body)).not.toContain(KEY);
  });
});
