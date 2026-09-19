// Sprint A, Track 1 — the online fetch seam. Covers the envelope contract
// (never throws, always { data, cached_at, stale, offline }), TTL hit/miss,
// the two independent cooldowns, the feature-off-means-no-socket guarantee,
// keys.js's in-memory presence contract, and the route layer.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { createRequire } from 'node:module';
import { db } from '../server/db/connection.js';
import repo from '../server/db/repo.js';
import online from '../server/online/index.js';

// keys.js holds its state in a plain module-level JS variable (by design — it
// must never touch disk). routes.js reaches it via a bare `require('./keys')`;
// pulling it in here through `createRequire` (real Node `require`, not the
// test file's ESM `import`) guarantees this test and the mounted router share
// the exact same module instance instead of two independently-evaluated
// copies with their own state.
const require = createRequire(import.meta.url);
const onlineRoutes = require('../server/online/routes.js');
const keys = require('../server/online/keys.js');

// ── a tiny upstream server standing in for "the internet" ──────────────────
let upstream; let upstreamBase; let upstreamMode = 'ok'; let hitCount = 0;
beforeAll(async () => {
  const app = express();
  app.get('/data', (req, res) => {
    hitCount += 1;
    if (upstreamMode === 'ok') return res.json({ hello: 'world' });
    if (upstreamMode === '429') return res.status(429).json({ error: 'slow down' });
    if (upstreamMode === '500') return res.status(500).json({ error: 'oops' });
    if (upstreamMode === 'hang') return; // never responds -> triggers the client-side timeout
  });
  await new Promise((resolve) => { upstream = app.listen(0, '127.0.0.1', resolve); });
  upstreamBase = `http://127.0.0.1:${upstream.address().port}/data`;
});
afterAll(() => new Promise((resolve) => upstream.close(resolve)));

beforeEach(() => {
  upstreamMode = 'ok';
  hitCount = 0;
  online._resetForTests();
  repo.setSettings(db(), { online: Object.fromEntries(online.FEATURES.map((f) => [f, false])) });
});

function setFeature(feature, on) {
  repo.setSettings(db(), { online: { [feature]: on } });
}

describe('online.fetch envelope', () => {
  it('never opens a socket when the feature is off', async () => {
    const out = await online.fetch(upstreamBase, { feature: 'market', cacheKey: 'off-test' });
    expect(hitCount).toBe(0);
    expect(out).toEqual({ data: null, cached_at: null, stale: true, offline: true });
  });

  it('fetches live and populates cache when the feature is on', async () => {
    setFeature('market', true);
    const out = await online.fetch(upstreamBase, { feature: 'market', cacheKey: 'live-test' });
    expect(hitCount).toBe(1);
    expect(out.offline).toBe(false);
    expect(out.stale).toBe(false);
    expect(out.data).toEqual({ hello: 'world' });
    expect(typeof out.cached_at).toBe('string');
  });

  it('TTL hit: a second call within ttl serves cache with no network call', async () => {
    setFeature('market', true);
    await online.fetch(upstreamBase, { feature: 'market', cacheKey: 'ttl-hit', ttl: 60_000 });
    expect(hitCount).toBe(1);
    const out = await online.fetch(upstreamBase, { feature: 'market', cacheKey: 'ttl-hit', ttl: 60_000 });
    expect(hitCount).toBe(1); // no second network call
    expect(out.offline).toBe(false);
    expect(out.stale).toBe(false);
    expect(out.data).toEqual({ hello: 'world' });
  });

  it('TTL miss: an expired cache entry is marked stale in the offline envelope', async () => {
    repo.upsertHttpCache(db(), {
      cache_key: 'ttl-miss', feature: 'market', url: upstreamBase,
      data: { hello: 'old' }, cached_at: new Date(Date.now() - 10_000).toISOString(),
    });
    // Feature stays off -> never re-fetches, but the stale cache is still surfaced.
    const out = await online.fetch(upstreamBase, { feature: 'market', cacheKey: 'ttl-miss', ttl: 1 });
    expect(hitCount).toBe(0);
    expect(out.offline).toBe(true);
    expect(out.stale).toBe(true);
    expect(out.data).toEqual({ hello: 'old' });
  });

  it('a timeout resolves to the offline envelope instead of throwing', async () => {
    setFeature('market', true);
    upstreamMode = 'hang';
    const out = await online.fetch(upstreamBase, {
      feature: 'market', cacheKey: 'timeout-test', timeout: 50, retries: 0, backoffMs: 1,
    });
    expect(out).toEqual({ data: null, cached_at: null, stale: true, offline: true });
  });

  it('a non-2xx resolves to the offline envelope instead of throwing', async () => {
    setFeature('market', true);
    upstreamMode = '500';
    const out = await online.fetch(upstreamBase, {
      feature: 'market', cacheKey: 'error-test', retries: 0, backoffMs: 1,
    });
    expect(out).toEqual({ data: null, cached_at: null, stale: true, offline: true });
  });

  it('error cooldown: a subsequent call within the cooldown window makes no network call', async () => {
    setFeature('market', true);
    upstreamMode = '500';
    await online.fetch(upstreamBase, {
      feature: 'market', cacheKey: 'error-cooldown', retries: 0, backoffMs: 1, errorCooldownMs: 60_000,
    });
    expect(hitCount).toBe(1);
    upstreamMode = 'ok'; // even though upstream recovered...
    const out = await online.fetch(upstreamBase, {
      feature: 'market', cacheKey: 'error-cooldown', retries: 0, backoffMs: 1, errorCooldownMs: 60_000,
    });
    expect(hitCount).toBe(1); // ...the cooldown still skips the network entirely
    expect(out.offline).toBe(true);
  });

  it('rate-limit cooldown is independent from the error cooldown', async () => {
    setFeature('market', true);
    upstreamMode = '429';
    await online.fetch(upstreamBase, {
      feature: 'market', cacheKey: 'independence-test', retries: 3, backoffMs: 1,
      errorCooldownMs: 60_000, rateLimitCooldownMs: 60_000,
    });
    // A 429 must not burn retries as if it were a plain error.
    expect(hitCount).toBe(1);

    // Now make the upstream fail with 500 on a DIFFERENT cacheKey — its error
    // cooldown must not be affected by, or share state with, the 429 above.
    upstreamMode = '500';
    await online.fetch(upstreamBase, {
      feature: 'market', cacheKey: 'independence-test-2', retries: 0, backoffMs: 1, errorCooldownMs: 60_000,
    });
    expect(hitCount).toBe(2);

    // The original (429) cacheKey should still be cooling down on ITS OWN
    // rate-limit timer, unaffected by the second key's error cooldown.
    upstreamMode = 'ok';
    const out = await online.fetch(upstreamBase, {
      feature: 'market', cacheKey: 'independence-test', retries: 3, backoffMs: 1,
      errorCooldownMs: 60_000, rateLimitCooldownMs: 60_000,
    });
    expect(hitCount).toBe(2); // still cooling down -> no new hit
    expect(out.offline).toBe(true);
  });

  it('caps concurrency at 3 in-flight fetches', async () => {
    setFeature('market', true);
    upstreamMode = 'ok';
    const calls = Array.from({ length: 6 }, (_, i) =>
      online.fetch(upstreamBase, { feature: 'market', cacheKey: `concurrency-${i}`, retries: 0 }));
    const results = await Promise.all(calls);
    expect(results.every((r) => r.offline === false)).toBe(true);
    expect(hitCount).toBe(6);
  });
});

describe('server/online/keys.js — in-memory presence only', () => {
  beforeEach(() => keys.setKeys({}));

  it('round-trips a key and reports presence without exposing the value', () => {
    expect(keys.hasKey('market')).toBe(false);
    keys.setKeys({ market: 'super-secret-value' });
    expect(keys.hasKey('market')).toBe(true);
    expect(keys.getKey('market')).toBe('super-secret-value');
    const presence = keys.presence();
    expect(presence).toEqual({ market: true });
    expect(JSON.stringify(presence)).not.toContain('super-secret-value');
  });

  it('presence reflects removal', () => {
    keys.setKeys({ news: 'abc' });
    expect(keys.hasKey('news')).toBe(true);
    keys.setKeys({});
    expect(keys.hasKey('news')).toBe(false);
  });
});

describe('routes: /api/online', () => {
  let server; let base;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/online', onlineRoutes);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/online`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));
  beforeEach(() => keys.setKeys({}));

  it('GET /settings returns all seven features defaulted false', async () => {
    const res = await fetch(`${base}/settings`);
    const body = await res.json();
    expect(res.status).toBe(200);
    for (const f of online.FEATURES) expect(body.online[f]).toBe(false);
  });

  it('PUT /settings toggles a single feature and returns the merged shape', async () => {
    const put = await fetch(`${base}/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ news: true }),
    });
    const body = await put.json();
    expect(put.status).toBe(200);
    expect(body.online.news).toBe(true);
    expect(body.online.market).toBe(false);
  });

  it('GET /keys returns presence booleans only, never values', async () => {
    keys.setKeys({ market: 'sekrit' });
    const res = await fetch(`${base}/keys`);
    const body = await res.json();
    expect(body.keys).toEqual({ market: true });
    expect(JSON.stringify(body)).not.toContain('sekrit');
  });

  it('POST /test reflects real server state: off, on-without-key, on-with-key', async () => {
    await fetch(`${base}/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sportsOdds: false }),
    });
    let out = await (await fetch(`${base}/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature: 'sportsOdds' }),
    })).json();
    expect(out).toMatchObject({ enabled: false, hasKey: false, ok: false });

    await fetch(`${base}/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sportsOdds: true }),
    });
    out = await (await fetch(`${base}/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature: 'sportsOdds' }),
    })).json();
    expect(out).toMatchObject({ enabled: true, hasKey: false, ok: true });

    keys.setKeys({ sportsOdds: 'abc123' });
    out = await (await fetch(`${base}/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature: 'sportsOdds' }),
    })).json();
    expect(out).toMatchObject({ enabled: true, hasKey: true, ok: true });
    expect(JSON.stringify(out)).not.toContain('abc123');
  });

  it('400s an unknown feature name', async () => {
    const res = await fetch(`${base}/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feature: 'bogus' }),
    });
    expect(res.status).toBe(400);
  });
});
