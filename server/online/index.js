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

function enabled(feature, d = db()) {
  return !!getOnlineSettings(d)[feature];
}

// ── concurrency — max 3 in-flight online.fetch calls at once ────────────────
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

// ── per-cacheKey cooldowns ────────────────────────────────────────────────
// Error cooldown (timeouts, network errors, non-2xx after retries) and the
// rate-limit cooldown (HTTP 429) are two independent knobs on purpose: a 429
// means "this endpoint is asking us to slow down" and should back off on its
// own schedule, while a 500/timeout means "this endpoint is unwell right now"
// and must not reset — or be reset by — the rate-limit timer.
const cooldowns = new Map();
function cooldownFor(key) {
  if (!cooldowns.has(key)) cooldowns.set(key, {});
  return cooldowns.get(key);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const safeUrl = String(url).split('?')[0];
  repo.upsertHttpCache(db(), { cache_key: cacheKey, feature, url: safeUrl, data, cached_at: new Date().toISOString() });
}

function envelopeFromCache(cacheKey, ttl, offline) {
  const row = readCache(cacheKey);
  const cached_at = row ? row.cached_at : null;
  const stale = !cached_at || (Date.now() - new Date(cached_at).getTime() > ttl);
  return { data: row ? row.data : null, cached_at, stale, offline };
}

async function attemptFetch(url, reqOpts, cacheKey, cfg) {
  const st = cooldownFor(cacheKey);
  for (let attempt = 0; attempt <= cfg.retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeout);
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(url, { ...reqOpts, signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 429) {
        // Rate-limited — respect it immediately, never burn retries on a 429.
        st.rateLimitUntil = Date.now() + cfg.rateLimitCooldownMs;
        return { ok: false };
      }
      if (!res.ok) {
        if (attempt < cfg.retries) { // eslint-disable-next-line no-await-in-loop
          await sleep(cfg.backoffMs * 2 ** attempt); continue;
        }
        st.errorUntil = Date.now() + cfg.errorCooldownMs;
        return { ok: false };
      }
      const data = await res.json();
      delete st.errorUntil;
      delete st.rateLimitUntil;
      return { ok: true, data };
    } catch (e) {
      clearTimeout(timer);
      if (attempt < cfg.retries) { // eslint-disable-next-line no-await-in-loop
        await sleep(cfg.backoffMs * 2 ** attempt); continue;
      }
      st.errorUntil = Date.now() + cfg.errorCooldownMs;
      return { ok: false };
    }
  }
  return { ok: false };
}

const DEFAULTS = {
  ttl: 15 * 60 * 1000,             // how long a cache row is considered fresh
  timeout: 8000,                   // per-attempt abort
  retries: 2,                      // additional attempts after the first
  backoffMs: 400,                  // exponential: backoffMs * 2^attempt
  errorCooldownMs: 60 * 1000,      // "this endpoint is sick" — skip network entirely
  rateLimitCooldownMs: 5 * 60 * 1000, // "back off hard" — independent of errorCooldownMs
};

async function fetchOnline(url, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const cacheKey = opts.cacheKey || url;
  const feature = opts.feature || null;

  // Feature off (or unspecified and defaulted off) → never open a socket.
  if (feature && !enabled(feature)) return envelopeFromCache(cacheKey, cfg.ttl, true);

  const st = cooldownFor(cacheKey);
  const now = Date.now();
  if (st.rateLimitUntil && now < st.rateLimitUntil) return envelopeFromCache(cacheKey, cfg.ttl, true);
  if (st.errorUntil && now < st.errorUntil) return envelopeFromCache(cacheKey, cfg.ttl, true);

  const cached = readCache(cacheKey);
  if (cached && now - new Date(cached.cached_at).getTime() < cfg.ttl) {
    return { data: cached.data, cached_at: cached.cached_at, stale: false, offline: false };
  }

  await acquireSlot();
  try {
    const result = await attemptFetch(url, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      body: opts.body,
    }, cacheKey, cfg);
    if (result.ok) {
      writeCache(cacheKey, result.data, feature, url);
      return { data: result.data, cached_at: new Date().toISOString(), stale: false, offline: false };
    }
    return envelopeFromCache(cacheKey, cfg.ttl, true);
  } finally {
    releaseSlot();
  }
}

// Cooldowns/concurrency are module-level state that would otherwise leak
// between test cases; tests call this in beforeEach/afterEach.
function _resetForTests() {
  cooldowns.clear();
  active = 0;
  waiters.length = 0;
}

module.exports = {
  FEATURES,
  getOnlineSettings,
  enabled,
  fetch: fetchOnline,
  _resetForTests,
};
