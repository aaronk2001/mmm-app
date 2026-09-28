'use strict';

// Sprint A, Track 2 — writes the "last known" price data the Markets UI
// reads. This is the ONLY place that fetches on a timer; every other read
// (route handlers, the UI) reads price_cache and never triggers a fetch
// itself except an explicit Refresh. Called by server/jobs.js's 30-min
// interval, and directly by the /refresh route for the manual case.
//
// Honesty rules for every row written here:
//   - `price` (not `price_cents`) is what repo.upsertPriceCache stores; the
//     old `price_cents` key was silently dropped, so the Watchlist's Price
//     column was always empty.
//   - `fetched_at` is when the data actually came off the network (the
//     envelope's cached_at), never "now". When the upstream failed, the seam
//     hands back its last cached copy; stamping that "now" made a month-old
//     price read "updated just now".
//   - An older copy never overwrites a newer row.
//   - Prices are stored in the currency's major unit (pence -> pounds).

const { db } = require('../db/connection');
const repo = require('../db/repo');
const online = require('../online');
const providers = require('./providers');

function symbolsFromWatchlistAndHoldings(d) {
  const symbols = new Set();
  for (const w of repo.getWatchlist ? repo.getWatchlist(d) : []) {
    if (w?.symbol) symbols.add(String(w.symbol).toUpperCase());
  }
  for (const h of repo.getHoldings ? repo.getHoldings(d) : []) {
    if (h?.symbol) symbols.add(String(h.symbol).toUpperCase());
  }
  return [...symbols];
}

async function runRefresh({ includeIndices = true, includeFutures = true } = {}) {
  const d = db();
  if (!online.enabled('market')) {
    return { ok: false, reason: 'market feature is off', written: 0, skipped: [] };
  }

  let written = 0;
  const skipped = [];

  // `env` is a providers.yahoo.quote() result: the seam envelope plus `quote`.
  function put(id, kind, symbol, env, extra = null) {
    const quote = providers.toMajorUnits(env.quote);
    if (!quote || quote.price == null || !env.cached_at) {
      skipped.push({ symbol, reason: env.offline ? 'offline, nothing cached' : 'no quote' });
      return;
    }
    const existing = repo.getPriceCacheEntry(d, id);
    const newer = !existing || !existing.fetched_at || existing.fetched_at <= env.cached_at;
    if (newer) {
      repo.upsertPriceCache(d, {
        id, kind, symbol,
        price: quote.price,
        change_pct: quote.changePct,
        data: extra ? { ...quote, ...extra } : quote,
        source: 'yahoo',
        fetched_at: env.cached_at,
      });
    }
    // Only data fresh within its TTL counts as refreshed. A stale copy may
    // still fill an empty row (with its true, old timestamp) but is reported.
    if (env.stale) skipped.push({ symbol, reason: env.offline ? 'offline, kept last known price' : 'stale' });
    else written += 1;
  }

  const symbols = symbolsFromWatchlistAndHoldings(d);
  for (const symbol of symbols) {
    // eslint-disable-next-line no-await-in-loop
    const q = await providers.yahoo.quote(symbol);
    put(`quote:${symbol}`, 'quote', symbol, q);
  }

  if (includeIndices) {
    const idx = await providers.yahoo.indices();
    for (const r of idx) put(`index:${r.symbol}`, 'index', r.symbol, r, { name: r.name });
  }

  if (includeFutures) {
    const fut = await providers.yahoo.futures();
    for (const r of fut) put(`future:${r.symbol}`, 'future', r.symbol, r, { name: r.name });
  }

  return { ok: true, written, skipped, at: new Date().toISOString() };
}

// One refresh at a time. When Yahoo is timing out a refresh of many symbols
// can outlast jobs.js's 30-minute interval, and the manual Refresh button can
// land mid-run; a second concurrent run would only double the requests
// against a struggling host. A caller arriving mid-run shares that run's
// result instead of starting another.
let inFlight = null;
function refreshSnapshots(opts = {}) {
  if (inFlight) return inFlight;
  inFlight = runRefresh(opts).finally(() => { inFlight = null; });
  return inFlight;
}

module.exports = { refreshSnapshots, symbolsFromWatchlistAndHoldings };
