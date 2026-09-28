'use strict';

// The online seam — Track 1 of Sprint A. Ships no providers; Track 2 builds
// market/news/etc. fetchers on top of `fetch()` below. Everything here is
// opt-in and off by default: `settings.online = { market, news, youtube,
// predictionMarkets, sportsOdds, telegram, cloudLlm }`, all false unless the
// user turns a feature on in Settings → Online & Keys.
//
// `fetch(url, opts)` never throws for an expected failure. A disabled
// feature, a timeout, a non-2xx, a 429, or an active cooldown all resolve to
// `{ data, cached_at, stale, offline }` built from whatever is cached — so a
// UI tile can always render something instead of an error boundary.
//
// `guard(transport, opts)` is the same contract for a transport this module
// can't drive itself (the yahoo-finance2 SDK owns a cookie/crumb handshake):
// the caller's function does the I/O, and the seam still owns the feature
// gate, the cache, the cooldowns, the concurrency slots and the deadline.
//
// Fail closed: a call without a known `feature` never opens a socket.

const crypto = require('crypto');
const { db } = require('../db/connection');
const repo = require('../db/repo');

const FEATURES = require('./features');

function defaultOnlineSettings() {
  return Object.fromEntries(FEATURES.map((f) => [f, false]));
}

// Always returns the full shape (all seven keys) so the Settings panel and
// `enabled()` never have to guess about a feature the user hasn't touched yet.
function getOnlineSettings(d = db()) {
  const settings = repo.getSettings(d);
  return { ...defaultOnlineSettings(), ...(settings.online || {}) };
}

// Only the seven known feature names can ever be "on" — a lookup like
// enabled('constructor') must not find Object.prototype's function.
function enabled(feature, d = db()) {
  if (!FEATURES.includes(feature)) return false;
  return getOnlineSettings(d)[feature] === true;
}

// ── concurrency — max 3 in-flight online calls at once ──────────────────────
const MAX_PARALLEL = 3;
let active = 0;
const waiters = [];
function acquireSlot() {
  if (active < MAX_PARALLEL) { active += 1; return Promise.resolve(); }
  return new Promise((resolve) => waiters.push(resolve));
}
function releaseSlot() {
  active -= 1;
  const next = waiters.shift();
  if (next) { active += 1; next(); }
}

// ── cooldowns ───────────────────────────────────────────────────────────────
// Two scopes, and within each an error timer and a rate-limit timer that
// never reset each other:
//   per cacheKey — this one request failed on its own terms (a 404 for an
//     unknown symbol, a body that isn't JSON, a response over the size cap):
//     skip it, but don't punish other requests to the same host.
//   per host — a 429 means "this host wants every request from us to slow
//     down" (so it honours Retry-After), and a host still timing out or
//     5xx-ing after retries is unwell for everyone. Either way every cacheKey
//     on that host skips the network until the timer runs out, instead of each
//     symbol separately paying the full timeout/retry bill.
const keyCooldowns = new Map();
const hostCooldowns = new Map();
function stateFor(map, key) {
  if (!map.has(key)) map.set(key, {});
  return map.get(key);
}
function coolingDown(cacheKey, host, now = Date.now()) {
  const k = keyCooldowns.get(cacheKey);
  if (k && k.errorUntil > now) return true;
  const h = host ? hostCooldowns.get(host) : null;
  return !!(h && (h.rateLimitUntil > now || h.errorUntil > now));
}

function hostOf(url) {
  try { return new URL(String(url)).host.toLowerCase(); } catch { return null; }
}

// Retry-After is either delta-seconds or an HTTP-date (RFC 9110 §10.2.3).
function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  const at = Date.parse(s);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}
const MIN_RATE_LIMIT_MS = 1000;
const MAX_RATE_LIMIT_MS = 60 * 60 * 1000; // a bogus Retry-After must not lock a feature for days

function header(res, name) {
  try {
    return res && res.headers && typeof res.headers.get === 'function' ? res.headers.get(name) : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── cache ───────────────────────────────────────────────────────────────────
// http_cache never grew a delete path, and it is part of repo.readAll — so
// every export and every daily JSON/.db backup carried every chart range and
// odds board ever viewed, forever. Rows older than 30 days are dropped at
// most once an hour, from the write path and from server/jobs.js's tick.
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
let lastPruneAt = 0;

function pruneCache({ maxAgeMs = CACHE_MAX_AGE_MS, now = Date.now() } = {}) {
  lastPruneAt = now;
  return repo.pruneHttpCache(db(), new Date(now - maxAgeMs).toISOString());
}
function maybePruneCache(now = Date.now()) {
  if (now - lastPruneAt < PRUNE_EVERY_MS) return 0;
  try { return pruneCache({ now }); } catch { return 0; }
}

function readCache(cacheKey) {
  return repo.getHttpCacheEntry(db(), cacheKey);
}
// The query string is stripped before the URL is stored. Providers put API
// keys in query params (FRED does), and http_cache IS part of repo.readAll —
// so an unstripped URL would carry the key into GET /api/money/export and
// into every daily backup file. Nothing reads this column except a human
// debugging a cache entry, for which the path alone is enough.
function writeCache(cacheKey, data, feature, url) {
  const safeUrl = url ? String(url).split('?')[0] : null;
  const cachedAt = new Date().toISOString();
  repo.upsertHttpCache(db(), { cache_key: cacheKey, feature, url: safeUrl, data, cached_at: cachedAt });
  maybePruneCache();
  return cachedAt;
}

// A caller that doesn't name a cacheKey gets one WITHOUT the raw query
// string: the same reasoning as writeCache's url column, because cache_key
// is exported and backed up too. The query is folded in as a short hash so
// two different queries against one path still get two different rows.
function defaultCacheKey(url) {
  const s = String(url);
  const digest = (q) => crypto.createHash('sha256').update(q).digest('hex').slice(0, 16);
  try {
    const u = new URL(s);
    const base = `${u.origin}${u.pathname}`;
    return u.search ? `${base}#q=${digest(u.search)}` : base;
  } catch {
    const i = s.indexOf('?');
    return i < 0 ? s : `${s.slice(0, i)}#q=${digest(s.slice(i))}`;
  }
}

function envelopeFromCache(cacheKey, ttl, offline) {
  const row = readCache(cacheKey);
  const cached_at = row ? row.cached_at : null;
  const stale = !cached_at || (Date.now() - new Date(cached_at).getTime() > ttl);
  return { data: row ? row.data : null, cached_at, stale, offline };
}

function freshFromCache(cacheKey, ttl, now = Date.now()) {
  const cached = readCache(cacheKey);
  if (cached && now - new Date(cached.cached_at).getTime() < ttl) {
    return { data: cached.data, cached_at: cached.cached_at, stale: false, offline: false };
  }
  return null;
}

// ── one HTTP attempt ────────────────────────────────────────────────────────
// Outcome kinds:
//   ok          — 2xx with a JSON body inside the size cap
//   rateLimited — 429; the host cooldown takes Retry-After (or the default)
//   transient   — network error, timeout, 408 or 5xx: worth retrying
//   fatal       — any other 4xx, a non-JSON body, or a body over the cap:
//                 retrying the same request can't change the answer

class ResponseTooLarge extends Error {
  constructor(limit) {
    super(`response body exceeded ${limit} bytes`);
    this.name = 'ResponseTooLarge';
  }
}

function isRetryableStatus(status) {
  return status === 408 || status >= 500;
}

// Release the connection behind a response we won't read (non-2xx): an
// unconsumed undici body otherwise pins its socket until garbage collection.
function discardBody(res) {
  try {
    const body = res && res.body;
    if (body && typeof body.cancel === 'function' && !body.locked) {
      const p = body.cancel();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  } catch { /* nothing to release */ }
}

async function readJsonCapped(res, maxBytes) {
  const declared = Number(header(res, 'content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    discardBody(res);
    throw new ResponseTooLarge(maxBytes);
  }
  const body = res && res.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        reader.cancel().catch(() => {});
        throw new ResponseTooLarge(maxBytes);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  }
  // Minimal stand-ins with no stream (tests, polyfills): whole-body readers,
  // still inside the attempt's deadline.
  if (typeof res.text === 'function') {
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new ResponseTooLarge(maxBytes);
    return JSON.parse(text);
  }
  return res.json();
}

// One deadline for the WHOLE attempt — connect, headers AND body. The old
// timer was cleared as soon as headers arrived, so a body that stalled after
// them hung until undici's own 300s body timeout while holding one of the
// three slots; three of those wedged every online feature. The race also
// covers a transport that ignores the abort signal.
function withDeadline(ms, run, onTimeout) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(onTimeout()); }, ms);
  });
  return Promise.race([run(controller.signal), deadline]).finally(() => clearTimeout(timer));
}

function attemptHttp(url, reqOpts, cfg) {
  return withDeadline(cfg.timeout, async (signal) => {
    let res;
    try {
      res = await fetch(url, { ...reqOpts, signal });
    } catch {
      return { kind: 'transient', reason: signal.aborted ? 'timeout' : 'network' };
    }
    if (res.status === 429) {
      discardBody(res);
      return { kind: 'rateLimited', retryAfterMs: parseRetryAfter(header(res, 'retry-after')) };
    }
    if (!res.ok) {
      discardBody(res);
      return { kind: isRetryableStatus(res.status) ? 'transient' : 'fatal', reason: `http ${res.status}` };
    }
    try {
      return { kind: 'ok', data: await readJsonCapped(res, cfg.maxBytes) };
    } catch (e) {
      if (e instanceof ResponseTooLarge || e instanceof SyntaxError) return { kind: 'fatal', reason: e.name };
      return { kind: 'transient', reason: signal.aborted ? 'timeout' : 'network' };
    }
  }, () => ({ kind: 'transient', reason: 'timeout' }));
}

async function attemptWithRetries(url, reqOpts, cfg) {
  let outcome = null;
  for (let attempt = 0; attempt <= cfg.retries; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    outcome = await attemptHttp(url, reqOpts, cfg);
    // A 429 is respected immediately — never burn retries on it — and a
    // fatal answer won't change on a second ask.
    if (outcome.kind !== 'transient' || attempt === cfg.retries) return outcome;
    // eslint-disable-next-line no-await-in-loop
    await sleep(cfg.backoffMs * 2 ** attempt);
  }
  return outcome;
}

function settle(outcome, { cacheKey, host, cfg }) {
  const now = Date.now();
  if (outcome.kind === 'ok') {
    keyCooldowns.delete(cacheKey);
    const h = host ? hostCooldowns.get(host) : null;
    if (h) delete h.errorUntil;
    return;
  }
  if (outcome.kind === 'rateLimited') {
    const wanted = outcome.retryAfterMs == null ? cfg.rateLimitCooldownMs : outcome.retryAfterMs;
    const ms = Math.min(MAX_RATE_LIMIT_MS, Math.max(MIN_RATE_LIMIT_MS, wanted));
    stateFor(hostCooldowns, host || cacheKey).rateLimitUntil = now + ms;
    return;
  }
  stateFor(keyCooldowns, cacheKey).errorUntil = now + cfg.errorCooldownMs;
  if (outcome.kind === 'transient' && host) stateFor(hostCooldowns, host).errorUntil = now + cfg.errorCooldownMs;
}

const DEFAULTS = {
  ttl: 15 * 60 * 1000,             // how long a cache row is considered fresh
  timeout: 8000,                   // per-attempt deadline: connect + headers + body
  retries: 2,                      // additional attempts after the first (transient failures only)
  backoffMs: 400,                  // exponential: backoffMs * 2^attempt
  errorCooldownMs: 60 * 1000,      // "this endpoint is sick" — skip network entirely
  rateLimitCooldownMs: 5 * 60 * 1000, // 429 without a Retry-After — independent of errorCooldownMs
  maxBytes: 8 * 1024 * 1024,       // response body cap; a larger body is a failed call, not an OOM
};

// The shared gate → cooldown → fresh-cache → slot → attempt → cache pipeline
// behind both fetch() and guard().
async function runCached({ feature, cacheKey, host, url, cfg }, attempt) {
  // Unknown/missing feature or feature off → never open a socket.
  if (!enabled(feature)) return envelopeFromCache(cacheKey, cfg.ttl, true);
  if (coolingDown(cacheKey, host)) return envelopeFromCache(cacheKey, cfg.ttl, true);
  const fresh = freshFromCache(cacheKey, cfg.ttl);
  if (fresh) return fresh;

  await acquireSlot();
  try {
    // Queued behind other calls: a cooldown set, or a fresh row written,
    // while this one waited for a slot must be honoured too.
    if (coolingDown(cacheKey, host)) return envelopeFromCache(cacheKey, cfg.ttl, true);
    const again = freshFromCache(cacheKey, cfg.ttl);
    if (again) return again;

    const outcome = await attempt();
    settle(outcome, { cacheKey, host, cfg });
    if (outcome.kind === 'ok') {
      const cached_at = writeCache(cacheKey, outcome.data, feature, url);
      return { data: outcome.data, cached_at, stale: false, offline: false };
    }
    return envelopeFromCache(cacheKey, cfg.ttl, true);
  } finally {
    releaseSlot();
  }
}

async function fetchOnline(url, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const cacheKey = opts.cacheKey || defaultCacheKey(url);
  const reqOpts = { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body };
  return runCached(
    { feature: opts.feature, cacheKey, host: hostOf(url), url, cfg },
    () => attemptWithRetries(url, reqOpts, cfg),
  );
}

// For an SDK that performs its own HTTP: `transport(signal)` resolves to the
// data to cache, or rejects. The signal fires at the deadline so a transport
// that forwards it (yahoo-finance2's fetchOptions) is actually cancelled;
// either way the slot is released on time. `host` names the upstream whose
// host cooldown this call shares (e.g. Yahoo's chart host), since a 429 from
// one path means the whole host is rate-limiting this client. No retries —
// the SDK decides for itself; an error cools down just this cacheKey unless
// it is a 429.
async function guard(transport, opts = {}) {
  if (!opts.cacheKey) throw new Error('online.guard requires a cacheKey');
  const cfg = { ...DEFAULTS, ...opts };
  const host = opts.host ? String(opts.host).toLowerCase() : null;
  return runCached(
    { feature: opts.feature, cacheKey: opts.cacheKey, host, url: opts.url || null, cfg },
    () => withDeadline(cfg.timeout, async (signal) => {
      try {
        return { kind: 'ok', data: await transport(signal) };
      } catch (e) {
        const status = e && (e.status ?? e.statusCode ?? e.code);
        if (status === 429 || /\b429\b|too many requests/i.test(String(e && e.message))) {
          return { kind: 'rateLimited', retryAfterMs: null };
        }
        return { kind: 'fatal', reason: 'sdk error' };
      }
    }, () => ({ kind: 'fatal', reason: 'timeout' })),
  );
}

// Cooldowns/concurrency are module-level state that would otherwise leak
// between test cases; tests call this in beforeEach/afterEach.
function _resetForTests() {
  keyCooldowns.clear();
  hostCooldowns.clear();
  active = 0;
  waiters.length = 0;
  lastPruneAt = 0;
}

module.exports = {
  FEATURES,
  getOnlineSettings,
  enabled,
  fetch: fetchOnline,
  guard,
  pruneCache,
  maybePruneCache,
  defaultCacheKey,
  parseRetryAfter,
  DEFAULTS,
  _resetForTests,
};
