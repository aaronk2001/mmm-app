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

// ── two tiny upstream servers standing in for "the internet" ───────────────
// Two because cooldowns are now scoped per HOST as well as per cacheKey: the
// second one (a different port, so a different URL host) is "some other
// provider" that one host's rate limit or outage must not touch.
let upstream; let upstreamBase; let upstreamMode = 'ok'; let hitCount = 0; let retryAfter = null;
let other; let otherBase; let otherMode = 'ok'; let otherHits = 0;
function respond(mode, res) {
  if (mode === 'ok') return res.json({ hello: 'world' });
  if (mode === '429') {
    if (retryAfter !== null) res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'slow down' });
  }
  if (mode === '500') return res.status(500).json({ error: 'oops' });
  if (mode === '404') return res.status(404).json({ error: 'no such symbol' });
  if (mode === 'big') return res.json({ blob: 'x'.repeat(20_000) });
  if (mode === 'stall') { // headers + half a body, then silence
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"partial":');
    return undefined;
  }
  return undefined; // 'hang': never responds -> triggers the client-side timeout
}
beforeAll(async () => {
  const app = express();
  app.get('/data', (req, res) => { hitCount += 1; respond(upstreamMode, res); });
  await new Promise((resolve) => { upstream = app.listen(0, '127.0.0.1', resolve); });
  upstreamBase = `http://127.0.0.1:${upstream.address().port}/data`;

  const app2 = express();
  app2.get('/data', (req, res) => { otherHits += 1; respond(otherMode, res); });
  await new Promise((resolve) => { other = app2.listen(0, '127.0.0.1', resolve); });
  otherBase = `http://127.0.0.1:${other.address().port}/data`;
});
afterAll(async () => {
  for (const s of [upstream, other]) {
    s.closeAllConnections?.(); // a 'stall'/'hang' socket would otherwise hold close() open
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => s.close(resolve));
  }
});

beforeEach(() => {
  upstreamMode = 'ok';
  hitCount = 0;
  retryAfter = null;
  otherMode = 'ok';
  otherHits = 0;
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
    const keyOne = {
      feature: 'market', cacheKey: 'independence-test', retries: 3, backoffMs: 1,
      errorCooldownMs: 60_000, rateLimitCooldownMs: 60_000,
    };
    upstreamMode = '429';
    retryAfter = 1; // this host asks for exactly one second
    await online.fetch(upstreamBase, keyOne);
    // A 429 must not burn retries as if it were a plain error.
    expect(hitCount).toBe(1);

    // Another upstream fails with 500 — its error cooldown must not be
    // affected by, or share state with, the 429 above. (A second key on the
    // SAME host is now held back by that host's rate limit by design; see
    // "429 cools down the whole host" below.)
    otherMode = '500';
    await online.fetch(otherBase, {
      feature: 'market', cacheKey: 'independence-test-2', retries: 0, backoffMs: 1, errorCooldownMs: 60_000,
    });
    expect(otherHits).toBe(1);

    // The original (429) cacheKey is still cooling down on ITS OWN
    // rate-limit timer, unaffected by the other host's error cooldown...
    upstreamMode = 'ok';
    const out = await online.fetch(upstreamBase, keyOne);
    expect(hitCount).toBe(1); // still cooling down -> no new hit
    expect(out.offline).toBe(true);

    // ...and that timer runs out on its own schedule (Retry-After: 1) while
    // the other host's 60s error cooldown keeps running.
    await new Promise((resolve) => { setTimeout(resolve, 1100); });
    const back = await online.fetch(upstreamBase, keyOne);
    expect(hitCount).toBe(2);
    expect(back.offline).toBe(false);
    otherMode = 'ok';
    const stillSick = await online.fetch(otherBase, {
      feature: 'market', cacheKey: 'independence-test-2', retries: 0, backoffMs: 1, errorCooldownMs: 60_000,
    });
    expect(otherHits).toBe(1);
    expect(stillSick.offline).toBe(true);
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

describe('online.fetch — failure scoping, deadlines and limits', () => {
  const opts = (cacheKey, extra = {}) => ({ feature: 'market', cacheKey, backoffMs: 1, ...extra });

  it('429 cools down the whole host (every cacheKey on it); another host is unaffected', async () => {
    setFeature('market', true);
    upstreamMode = '429';
    await online.fetch(upstreamBase, opts('host-a-1', { rateLimitCooldownMs: 60_000 }));
    expect(hitCount).toBe(1);

    upstreamMode = 'ok';
    const sameHost = await online.fetch(upstreamBase, opts('host-a-2'));
    expect(hitCount).toBe(1); // a different symbol on the rate-limited host stays off the wire
    expect(sameHost.offline).toBe(true);

    const otherHost = await online.fetch(otherBase, opts('host-b-1'));
    expect(otherHits).toBe(1);
    expect(otherHost.offline).toBe(false);
  });

  it('a Retry-After longer than rateLimitCooldownMs is honoured', async () => {
    setFeature('market', true);
    upstreamMode = '429';
    retryAfter = 3600;
    await online.fetch(upstreamBase, opts('ra-long', { rateLimitCooldownMs: 10 }));
    await new Promise((resolve) => { setTimeout(resolve, 60); });
    upstreamMode = 'ok';
    const out = await online.fetch(upstreamBase, opts('ra-long', { rateLimitCooldownMs: 10 }));
    expect(hitCount).toBe(1);
    expect(out.offline).toBe(true);
  });

  it('parses Retry-After as delta-seconds or an HTTP-date', () => {
    const now = Date.parse('2026-09-28T12:00:00Z');
    expect(online.parseRetryAfter('120', now)).toBe(120_000);
    expect(online.parseRetryAfter('Mon, 28 Sep 2026 12:00:30 GMT', now)).toBe(30_000);
    expect(online.parseRetryAfter('Mon, 28 Sep 2026 11:00:00 GMT', now)).toBe(0);
    expect(online.parseRetryAfter('soon', now)).toBeNull();
    expect(online.parseRetryAfter(null, now)).toBeNull();
  });

  it('a non-429 4xx is not retried and cools down only its own cacheKey', async () => {
    setFeature('market', true);
    upstreamMode = '404';
    const out = await online.fetch(upstreamBase, opts('unknown-symbol', { retries: 3 }));
    expect(hitCount).toBe(1); // retrying a 404 can't change the answer
    expect(out.offline).toBe(true);

    upstreamMode = 'ok';
    await online.fetch(upstreamBase, opts('unknown-symbol', { retries: 3 }));
    expect(hitCount).toBe(1); // that key cools down...
    const sibling = await online.fetch(upstreamBase, opts('real-symbol'));
    expect(hitCount).toBe(2); // ...but one bad symbol doesn't take the host down
    expect(sibling.offline).toBe(false);
  });

  it('5xx is retried, and a host still failing after retries cools down for every key', async () => {
    setFeature('market', true);
    upstreamMode = '500';
    await online.fetch(upstreamBase, opts('sick-1', { retries: 2 }));
    expect(hitCount).toBe(3); // first try + 2 retries

    upstreamMode = 'ok';
    await online.fetch(upstreamBase, opts('sick-2'));
    expect(hitCount).toBe(3); // the rest of this host's symbols skip the timeout bill
    const otherHost = await online.fetch(otherBase, opts('healthy'));
    expect(otherHost.offline).toBe(false);
  });

  it('the deadline covers the body: stalled bodies time out and free their slots', async () => {
    setFeature('market', true);
    upstreamMode = 'stall'; // headers + half a JSON body, then nothing
    const started = Date.now();
    const stalled = [1, 2, 3].map((i) => online.fetch(upstreamBase, opts(`stall-${i}`, { timeout: 200, retries: 0 })));
    // Queued behind the three stalled calls for a slot, on a healthy host.
    const healthy = online.fetch(otherBase, opts('after-stall', { timeout: 200, retries: 0 }));
    const results = await Promise.all([...stalled, healthy]);
    expect(Date.now() - started).toBeLessThan(2000);
    for (const r of results.slice(0, 3)) expect(r.offline).toBe(true);
    expect(results[3].offline).toBe(false);
    expect(results[3].data).toEqual({ hello: 'world' });
  });

  it('a body over maxBytes is a failed call, and is not retried', async () => {
    setFeature('market', true);
    upstreamMode = 'big'; // ~20 KB
    const out = await online.fetch(upstreamBase, opts('too-big', { maxBytes: 1024, retries: 2 }));
    expect(hitCount).toBe(1);
    expect(out).toEqual({ data: null, cached_at: null, stale: true, offline: true });
  });

  it('fails closed: no feature, or an unknown one, never opens a socket', async () => {
    for (const f of online.FEATURES) setFeature(f, true);
    await online.fetch(upstreamBase, { cacheKey: 'no-feature', retries: 0 });
    await online.fetch(upstreamBase, { feature: 'bogus', cacheKey: 'bogus-feature', retries: 0 });
    await online.fetch(upstreamBase, { feature: 'constructor', cacheKey: 'proto-feature', retries: 0 });
    expect(hitCount).toBe(0);
    expect(online.enabled('constructor')).toBe(false);
    expect(online.enabled('toString')).toBe(false);
  });

  it('the default cacheKey keeps the query string (and any key in it) out of http_cache', async () => {
    setFeature('market', true);
    await online.fetch(`${upstreamBase}?series=A&api_key=SECRET123`, { feature: 'market', retries: 0 });
    await online.fetch(`${upstreamBase}?series=B&api_key=SECRET123`, { feature: 'market', retries: 0 });
    expect(hitCount).toBe(2); // two queries, two rows — the hash keeps them apart
    // Earlier tests cached this URL under explicit keys; only defaulted keys start with the URL.
    const rows = repo.getAllHttpCache(db()).filter((r) => r.cache_key.startsWith(upstreamBase));
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.cache_key).not.toContain('?');
    expect(new Set(rows.map((r) => r.cache_key)).size).toBe(2);
    expect(JSON.stringify(rows)).not.toContain('SECRET123');
    expect(JSON.stringify(repo.readAll(db()).http_cache)).not.toContain('SECRET123');
  });

  it('prunes rows older than 30 days, on demand and from the write path', async () => {
    const put = (key, daysAgo) => repo.upsertHttpCache(db(), {
      cache_key: key, feature: 'market', url: 'x', data: { v: 1 },
      cached_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    });
    put('prune-old', 31);
    put('prune-recent', 29);
    online.pruneCache();
    expect(repo.getHttpCacheEntry(db(), 'prune-old')).toBeNull();
    expect(repo.getHttpCacheEntry(db(), 'prune-recent')).not.toBeNull();

    put('prune-old-2', 45);
    online._resetForTests(); // forget the hourly throttle
    setFeature('market', true);
    await online.fetch(upstreamBase, { feature: 'market', cacheKey: 'prune-trigger', retries: 0 });
    expect(repo.getHttpCacheEntry(db(), 'prune-old-2')).toBeNull();
    expect(repo.getHttpCacheEntry(db(), 'prune-trigger')).not.toBeNull();
  });

  it('server/jobs.js tick() prunes on schedule too — with the market feature off, no network', () => {
    // jobs.js loads the seam through Node's require: reset THAT instance's
    // hourly throttle, not just this file's ESM import.
    require('../server/online/index.js')._resetForTests();
    const { tick } = require('../server/jobs.js');
    repo.upsertHttpCache(db(), {
      cache_key: 'jobs-prune-old', feature: 'market', url: 'x', data: {},
      cached_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    });
    expect(tick()).toBeNull(); // market is off: no refresh was started
    expect(repo.getHttpCacheEntry(db(), 'jobs-prune-old')).toBeNull();
    expect(hitCount + otherHits).toBe(0);
  });
});

describe('online.guard — SDK transports get the same seam', () => {
  it('never runs the transport while the feature is off', async () => {
    let calls = 0;
    const out = await online.guard(async () => { calls += 1; return { x: 1 }; }, { feature: 'market', cacheKey: 'g-off' });
    expect(calls).toBe(0);
    expect(out.offline).toBe(true);
  });

  it('caches the result and serves it within ttl without calling the transport again', async () => {
    setFeature('market', true);
    let calls = 0;
    const transport = async () => { calls += 1; return { earnings: 42 }; };
    const first = await online.guard(transport, { feature: 'market', cacheKey: 'g-cache', ttl: 60_000 });
    const second = await online.guard(transport, { feature: 'market', cacheKey: 'g-cache', ttl: 60_000 });
    expect(calls).toBe(1);
    expect(first).toMatchObject({ data: { earnings: 42 }, offline: false, stale: false });
    expect(second).toMatchObject({ data: { earnings: 42 }, offline: false });
  });

  it('a 429 from the transport rate-limits the named host for fetch() too', async () => {
    setFeature('market', true);
    const host = new URL(upstreamBase).host;
    await online.guard(async () => { const e = new Error('Too Many Requests'); e.status = 429; throw e; },
      { feature: 'market', cacheKey: 'g-429', host });
    await online.fetch(upstreamBase, { feature: 'market', cacheKey: 'g-429-chart', retries: 0 });
    expect(hitCount).toBe(0);
  });

  it('an ordinary transport error cools down only that cacheKey', async () => {
    setFeature('market', true);
    let calls = 0;
    const failing = async () => { calls += 1; throw new Error('Not Found'); };
    await online.guard(failing, { feature: 'market', cacheKey: 'g-err', host: 'example.test' });
    await online.guard(failing, { feature: 'market', cacheKey: 'g-err', host: 'example.test' });
    expect(calls).toBe(1);
    await online.guard(failing, { feature: 'market', cacheKey: 'g-err-2', host: 'example.test' });
    expect(calls).toBe(2);
  });

  it('the deadline aborts the transport signal and resolves offline', async () => {
    setFeature('market', true);
    let seen = null;
    const started = Date.now();
    const out = await online.guard((signal) => { seen = signal; return new Promise(() => {}); },
      { feature: 'market', cacheKey: 'g-slow', timeout: 100 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(seen.aborted).toBe(true);
    expect(out.offline).toBe(true);
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
