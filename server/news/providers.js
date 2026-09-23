'use strict';

// /api/news providers — ported from NEXUS's server/routes/market.js news
// block. Same idiom as server/market/providers.js: one source, every
// outbound byte through `online.fetch()`, key from `online/keys` (never
// process.env), and a `{ data, cached_at, stale, offline }`-shaped envelope
// that never throws for an expected failure.
//
// Source: Marketaux (/v1/news/all). NEXUS's yahoo-finance2 `search()`
// fallback is deliberately NOT ported — it needs a transport seam
// online.fetch's single-shot GET-and-cache contract doesn't have, and the
// Marketaux key is already stored in safeStorage.
//
// KEY HYGIENE. `api_token` is appended last and appears in exactly one
// place: the URL handed to online.fetch. It is never part of a cacheKey
// (those are explicit and key-free), never logged, and never in a response
// body — server/online/index.js strips the query string before persisting
// the cache row's `url` column, so the key can't leak into http_cache,
// GET /api/money/export, or a nightly backup. A FRED key leaked this way
// once; don't reintroduce it by folding the URL into the cacheKey.
//
// Every article is normalized to { id, title, url, source, published_at,
// summary, symbols[] } so no UI ever depends on a Marketaux field name.
// `published_at` is an ISO *instant* (not a local day key) — callers render
// it with toLocaleString(), never slice it into a YYYY-MM-DD.

const online = require('../online');
const keys = require('../online/keys');

const HOST = 'https://api.marketaux.com/v1/news/all';
const DEFAULT_TTL = 15 * 60 * 1000; // headlines — 15 min

const OFF_REASON = 'Market news is off. Turn it on in Settings → Online & Keys.';
const NO_KEY_REASON = 'No Marketaux API key. Add one in Settings → Online & Keys.';
const NO_DATA_REASON = 'No headlines available right now.';

const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

function clampLimit(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 20;
  return Math.max(1, Math.min(50, Math.trunc(v)));
}

// Untrusted remote text: anything that isn't an http(s) URL becomes null so
// the client never renders a javascript:/data: href.
function httpUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function str(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// ISO instant, never a day key.
function toInstant(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeArticle(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const title = str(raw.title);
  if (!title) return null;
  const url = httpUrl(raw.url);
  const entities = Array.isArray(raw.entities) ? raw.entities : [];
  const symbols = [...new Set(
    entities.map((e) => (e && typeof e.symbol === 'string' ? e.symbol.trim().toUpperCase() : null)).filter(Boolean),
  )];
  return {
    id: String(str(raw.uuid) || url || `${title}:${index}`),
    title,
    url,
    source: str(raw.source),
    published_at: toInstant(raw.published_at),
    summary: str(raw.description) || str(raw.snippet),
    symbols,
  };
}

// Marketaux returns { meta, data: [...] }. Anything else (a cached row from a
// different shape, null, an error body) normalizes to an empty list rather
// than throwing.
function normalize(payload) {
  const rows = Array.isArray(payload && payload.data) ? payload.data : [];
  const seen = new Set();
  const out = [];
  rows.forEach((row, i) => {
    const article = normalizeArticle(row, i);
    if (!article || seen.has(article.id)) return;
    seen.add(article.id);
    out.push(article);
  });
  // Newest first; undated articles sort last.
  out.sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
  return out;
}

function emptyEnvelope(reason) {
  return { articles: [], reason, cached_at: null, stale: true, offline: true };
}

async function fetchFeed({ cacheKey, query, ttl = DEFAULT_TTL }) {
  if (!online.enabled('news')) return emptyEnvelope(OFF_REASON);
  const key = keys.getKey('news');
  if (!key) return emptyEnvelope(NO_KEY_REASON);
  const url = `${HOST}?${query}&api_token=${encodeURIComponent(key)}`;
  const env = await online.fetch(url, { feature: 'news', cacheKey, ttl });
  const articles = normalize(env.data);
  return {
    articles,
    reason: articles.length ? null : NO_DATA_REASON,
    cached_at: env.cached_at,
    stale: env.stale,
    offline: env.offline,
  };
}

// General market headlines — no symbol filter.
async function market({ limit, ttl } = {}) {
  const n = clampLimit(limit);
  return fetchFeed({
    cacheKey: `marketaux:market:${n}`,
    query: `language=en&countries=us&filter_entities=true&limit=${n}`,
    ttl,
  });
}

// Per-symbol headlines.
async function forSymbol(symbol, { limit, ttl } = {}) {
  const sym = String(symbol || '').toUpperCase();
  const n = clampLimit(limit);
  return fetchFeed({
    cacheKey: `marketaux:symbol:${sym}:${n}`,
    query: `symbols=${encodeURIComponent(sym)}&language=en&filter_entities=true&limit=${n}`,
    ttl,
  });
}

module.exports = {
  SYMBOL_RE,
  OFF_REASON,
  NO_KEY_REASON,
  NO_DATA_REASON,
  normalize,
  normalizeArticle,
  marketaux: { market, forSymbol },
};
