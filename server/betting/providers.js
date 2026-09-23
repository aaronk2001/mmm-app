'use strict';

// Betting data providers — prediction markets (keyless) and The Odds API
// (keyed). Same shape as server/market/providers.js: every outbound request
// goes through `online.fetch()`, so each one inherits the cache/TTL, the 8s
// timeout + retry, the 429 and error cooldowns, and the feature gate. Nothing
// here ever calls `fetch()` directly the way the NEXUS original did.
//
// Two features, deliberately separate (both already in server/online/features.js):
//   predictionMarkets — Polymarket / Kalshi / Manifold, all keyless.
//   sportsOdds        — api.the-odds-api.com, needs a key from safeStorage.
//
// THE KEY NEVER LEAVES THIS FILE'S URL STRING. It is not in any cacheKey, log
// line, error message or response body; online.fetch strips the query string
// before persisting the cached URL, which is what stops it reaching the export
// and the nightly backup (a FRED key escaped that way once).
//
// Informational only — this module reads prices and computes edges. It never
// places, records, or sizes a real wager, and writes nothing to the ledger.

const { db } = require('../db/connection');
const repo = require('../db/repo');
const online = require('../online');
const keys = require('../online/keys');
const odds = require('./odds');

const PM_TTL = 2 * 60 * 1000;          // prediction markets — 2 min
const ODDS_TTL = 60 * 1000;            // live lines — 1 min (paid quota)
const SPORTS_LIST_TTL = 6 * 60 * 60 * 1000;

const ODDS_HOST = 'https://api.the-odds-api.com/v4';
const ARB_SPORTS = ['americanfootball_nfl', 'basketball_nba', 'baseball_mlb', 'icehockey_nhl', 'soccer_epl'];

// Shown when no key is stored (or the request failed and nothing is cached) so
// the Sports tab still has a sport picker instead of an empty select.
const DEFAULT_SPORTS = [
  { key: 'americanfootball_nfl', title: 'NFL', group: 'American Football' },
  { key: 'basketball_nba', title: 'NBA', group: 'Basketball' },
  { key: 'baseball_mlb', title: 'MLB', group: 'Baseball' },
  { key: 'icehockey_nhl', title: 'NHL', group: 'Ice Hockey' },
  { key: 'soccer_epl', title: 'Premier League', group: 'Soccer' },
  { key: 'soccer_usa_mls', title: 'MLS', group: 'Soccer' },
  { key: 'mma_mixed_martial_arts', title: 'MMA', group: 'MMA' },
];

// ── envelope helpers ────────────────────────────────────────────────────────

// Mirrors market/providers.js's offlineFromPriceCache: when we decline to even
// try the network (no key), still surface whatever the last good call cached.
function offlineFromHttpCache(cacheKey, extra = {}) {
  let row = null;
  try { row = repo.getHttpCacheEntry(db(), cacheKey); } catch { row = null; }
  return { data: row ? row.data : null, cached_at: row ? row.cached_at : null, stale: true, offline: true, ...extra };
}

// Fold several envelopes into one for a combined view: freshest cached_at
// wins, and the result only claims to be offline/stale if every leg is.
function mergeEnvelopes(envs) {
  const usable = envs.filter(Boolean);
  const times = usable.map((e) => e.cached_at).filter(Boolean).sort();
  return {
    cached_at: times.length ? times[times.length - 1] : null,
    stale: usable.length === 0 || usable.every((e) => e.stale),
    offline: usable.length === 0 || usable.every((e) => e.offline),
  };
}

// ── prediction markets (keyless) ────────────────────────────────────────────

function pmRow(m) {
  return {
    id: m.id,
    title: m.title || 'Unknown',
    source: m.source,
    probability: m.probability,
    volume24h: m.volume24h || 0,
    category: m.category || 'General',
    expiresAt: m.expiresAt || null,
    url: m.url,
  };
}

function parsePolymarket(data) {
  const markets = Array.isArray(data) ? data : (data?.markets || []);
  return markets.map((m) => {
    // outcomePrices arrives as a JSON *string* like '["0.65","0.35"]'.
    let raw = m.outcomePrices;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
    const prices = Array.isArray(raw) ? raw.map(Number) : [];
    const yes = Number.isFinite(prices[0]) ? prices[0] : null;
    if (yes === null) return null;
    return pmRow({
      id: m.conditionId || m.id,
      title: m.question || m.title,
      source: 'polymarket',
      probability: { yes, no: Number.isFinite(prices[1]) ? prices[1] : 1 - yes },
      volume24h: Number(m.volume24hr ?? m.volumeNum ?? 0) || 0,
      category: m.tags?.[0]?.label,
      expiresAt: m.endDate,
      url: m.slug ? `https://polymarket.com/event/${m.slug}` : 'https://polymarket.com',
    });
  }).filter(Boolean);
}

// Kalshi quotes yes_bid/yes_ask in CENTS (1-99), not the 0-1 decimals NEXUS's
// comment claimed — its cards therefore rendered a 51c market as 5100%.
function kalshiProb(v) {
  const x = Number(v);
  if (!Number.isFinite(x) || x <= 0) return null;
  return x > 1 ? x / 100 : x;
}

function parseKalshi(data) {
  return (data?.markets || []).map((m) => {
    const bid = kalshiProb(m.yes_bid);
    const ask = kalshiProb(m.yes_ask);
    const mid = bid != null && ask != null ? (bid + ask) / 2 : (bid ?? ask);
    if (mid == null) return null;
    return pmRow({
      id: m.ticker,
      title: m.title || m.subtitle,
      source: 'kalshi',
      probability: { yes: mid, no: 1 - mid },
      volume24h: Number(m.volume_24h ?? m.volume ?? 0) || 0,
      category: m.category,
      expiresAt: m.close_time,
      url: `https://kalshi.com/markets/${m.ticker}`,
    });
  }).filter(Boolean);
}

function parseManifold(data) {
  const markets = Array.isArray(data) ? data : [];
  return markets
    .filter((m) => m.outcomeType === 'BINARY' && !m.isResolved && Number.isFinite(m.probability))
    .map((m) => pmRow({
      id: m.id,
      title: m.question,
      source: 'manifold',
      probability: { yes: m.probability, no: 1 - m.probability },
      volume24h: Number(m.volume24Hours ?? 0) || 0,
      category: m.groupSlugs?.[0],
      expiresAt: m.closeTime ? new Date(m.closeTime).toISOString() : null,
      url: m.url || 'https://manifold.markets',
    }));
}

// Kalshi's open feed carries multi-leg parlay rows whose title is a comma dump
// ("yes France,yes Senegal,...") and which have no real price. They render as
// broken cards, so drop them and tidy the surviving single-question titles.
function isJunk(m) {
  const legs = String(m.title || '').split(',').filter((s) => /^\s*(yes|no)\s+/i.test(s));
  if (legs.length >= 2) return true;
  return (m.volume24h || 0) <= 0 && Math.abs((m.probability?.yes ?? 0.5) - 0.5) < 0.001;
}

function clean(markets) {
  return markets
    .filter((m) => !isJunk(m))
    .map((m) => ({ ...m, title: String(m.title).replace(/^\s*(yes|no)\s+/i, '').replace(/\s+/g, ' ').trim() }));
}

async function polymarket({ limit = 50, ttl = PM_TTL } = {}) {
  const url = `https://gamma-api.polymarket.com/markets?limit=${limit}&active=true&closed=false&order=volume24hr&ascending=false`;
  const env = await online.fetch(url, { feature: 'predictionMarkets', cacheKey: `polymarket:markets:${limit}`, ttl });
  return { ...env, markets: parsePolymarket(env.data) };
}

async function kalshi({ limit = 100, ttl = PM_TTL } = {}) {
  const url = `https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=${limit}`;
  const env = await online.fetch(url, { feature: 'predictionMarkets', cacheKey: `kalshi:markets:${limit}`, ttl });
  return { ...env, markets: parseKalshi(env.data) };
}

async function manifold({ limit = 50, ttl = PM_TTL } = {}) {
  const url = `https://api.manifold.markets/v0/markets?limit=${limit}&sort=last-bet-time`;
  const env = await online.fetch(url, { feature: 'predictionMarkets', cacheKey: `manifold:markets:${limit}`, ttl });
  return { ...env, markets: parseManifold(env.data) };
}

const PM_SOURCES = { polymarket, kalshi, manifold };

function filterAndSort(markets, { category = 'All', sort = 'volume', limit = 50 } = {}) {
  const filtered = category === 'All'
    ? markets
    : markets.filter((m) => String(m.category).toLowerCase() === String(category).toLowerCase());
  const sorted = [...filtered];
  if (sort === 'probability') sorted.sort((a, b) => Math.abs(b.probability.yes - 0.5) - Math.abs(a.probability.yes - 0.5));
  else if (sort === 'closing') sorted.sort((a, b) => (a.expiresAt ? Date.parse(a.expiresAt) : Infinity) - (b.expiresAt ? Date.parse(b.expiresAt) : Infinity));
  else sorted.sort((a, b) => b.volume24h - a.volume24h);
  return sorted.slice(0, limit);
}

async function predictionMarkets({ source = 'all', category = 'All', sort = 'volume', limit = 50 } = {}) {
  const names = source === 'all' ? Object.keys(PM_SOURCES) : [source].filter((s) => PM_SOURCES[s]);
  if (names.length === 0) return { ...mergeEnvelopes([]), markets: [], sources: [] };
  const envs = await Promise.all(names.map((nme) => PM_SOURCES[nme]().catch(() => null)));
  const all = clean(envs.flatMap((e) => (e ? e.markets : [])));
  return {
    ...mergeEnvelopes(envs),
    markets: filterAndSort(all, { category, sort, limit }),
    total: all.length,
    categories: [...new Set(all.map((m) => m.category))].sort(),
    sources: names.map((nme, i) => ({
      source: nme,
      count: envs[i] ? envs[i].markets.length : 0,
      stale: envs[i] ? envs[i].stale : true,
      offline: envs[i] ? envs[i].offline : true,
      cached_at: envs[i] ? envs[i].cached_at : null,
    })),
  };
}

// ── The Odds API (keyed) ────────────────────────────────────────────────────

// The key goes into the URL (that is the only auth this API offers) and
// NOWHERE else — not the cacheKey, not the returned envelope.
function oddsUrl(path, params) {
  const apiKey = keys.getKey('sportsOdds');
  const qs = new URLSearchParams({ ...params, apiKey });
  return `${ODDS_HOST}${path}?${qs}`;
}

function hasOddsKey() {
  return !!keys.getKey('sportsOdds');
}

async function sportsList({ ttl = SPORTS_LIST_TTL } = {}) {
  const cacheKey = 'oddsapi:sports';
  const env = hasOddsKey()
    ? await online.fetch(oddsUrl('/sports', {}), { feature: 'sportsOdds', cacheKey, ttl })
    : offlineFromHttpCache(cacheKey, { needsKey: true });
  const live = Array.isArray(env.data)
    ? env.data.filter((s) => s.active).map((s) => ({ key: s.key, title: s.title, group: s.group }))
    : [];
  return { ...env, sports: live.length ? live : DEFAULT_SPORTS, fallback: live.length === 0 };
}

function normalizeEvent(event) {
  const bookmakers = (event.bookmakers || []).map((bk) => {
    const mk = {};
    for (const market of bk.markets || []) {
      if (market.key === 'h2h') {
        mk.h2h = {};
        for (const o of market.outcomes || []) {
          if (o.name === event.home_team) mk.h2h.homeOdds = o.price;
          else if (o.name === event.away_team) mk.h2h.awayOdds = o.price;
          else mk.h2h.drawOdds = o.price;
        }
      } else if (market.key === 'spreads') {
        mk.spread = {};
        for (const o of market.outcomes || []) {
          if (o.name === event.home_team) mk.spread.home = { odds: o.price, point: o.point };
          else mk.spread.away = { odds: o.price, point: o.point };
        }
      } else if (market.key === 'totals') {
        mk.total = {};
        for (const o of market.outcomes || []) {
          if (o.name === 'Over') mk.total.over = { odds: o.price, point: o.point };
          else mk.total.under = { odds: o.price, point: o.point };
        }
      }
    }
    return { key: bk.key, name: bk.title, lastUpdate: bk.last_update, markets: mk };
  });

  // Best available price per side. NEXUS seeded these with -Infinity and left
  // it in the payload when no book quoted the side, so the UI showed
  // "-Infinity" odds at a 0% implied probability; null is the honest answer.
  const best = (side) => bookmakers.reduce((acc, bk) => {
    const price = bk.markets.h2h?.[side];
    if (!Number.isFinite(price)) return acc;
    return acc && acc.odds >= price ? acc : { odds: price, book: bk.name, impliedProb: odds.impliedProb(price) };
  }, null);

  const board = bookmakers
    .filter((bk) => Number.isFinite(bk.markets.h2h?.homeOdds) && Number.isFinite(bk.markets.h2h?.awayOdds))
    .map((bk) => ({ name: bk.name, home: bk.markets.h2h.homeOdds, away: bk.markets.h2h.awayOdds }));

  return {
    id: event.id,
    sport: event.sport_key,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    commenceTime: event.commence_time,
    bookmakers,
    board,
    bestOdds: { home: best('homeOdds'), away: best('awayOdds') },
    consensus: odds.consensusProbs(board),
  };
}

async function sportsOdds(sport, { markets = 'h2h,spreads,totals', bookmakers = '', regions = 'us', limit = 20, ttl = ODDS_TTL } = {}) {
  if (!sport) throw new Error('sport is required');
  // Key material is excluded by construction — only the query shape is keyed.
  const cacheKey = `oddsapi:odds:${sport}:${regions}:${markets}:${bookmakers}`;
  const params = { regions, markets, oddsFormat: 'american' };
  if (bookmakers) params.bookmakers = bookmakers;
  const env = hasOddsKey()
    ? await online.fetch(oddsUrl(`/sports/${encodeURIComponent(sport)}/odds`, params), { feature: 'sportsOdds', cacheKey, ttl })
    : offlineFromHttpCache(cacheKey, { needsKey: true });
  const events = Array.isArray(env.data) ? env.data.slice(0, limit).map(normalizeEvent) : [];
  return { ...env, sport, events };
}

async function arbitrage({ minProfitPct = 0.5, limit = 20, sports = ARB_SPORTS, totalStake = 1000 } = {}) {
  const envs = await Promise.all(sports.map((s) => sportsOdds(s, { markets: 'h2h', limit: 50 }).catch(() => null)));
  const opportunities = [];
  for (const env of envs) {
    for (const event of env ? env.events : []) {
      for (const arb of odds.findArbitrage(event.board, { totalStake, minProfitPct })) {
        opportunities.push({
          id: `${event.id}:${arb.side}:${arb.a.book}:${arb.b.book}`,
          event: `${event.awayTeam} @ ${event.homeTeam}`,
          sport: event.sport,
          commenceTime: event.commenceTime,
          ...arb,
          a: { ...arb.a, team: arb.a.outcome === 'home' ? event.homeTeam : event.awayTeam },
          b: { ...arb.b, team: arb.b.outcome === 'home' ? event.homeTeam : event.awayTeam },
        });
      }
    }
  }
  opportunities.sort((x, y) => y.profitPct - x.profitPct);
  return {
    ...mergeEnvelopes(envs),
    needsKey: !hasOddsKey(),
    opportunities: opportunities.slice(0, limit),
    scanned: envs.reduce((a, e) => a + (e ? e.events.length : 0), 0),
    sports,
  };
}

module.exports = {
  DEFAULT_SPORTS,
  ARB_SPORTS,
  predictionMarkets,
  polymarket,
  kalshi,
  manifold,
  filterAndSort,
  sportsList,
  sportsOdds,
  arbitrage,
  normalizeEvent,
  hasOddsKey,
};
