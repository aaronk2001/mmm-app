'use strict';

// Sprint A, Track 2 — writes the "last known" price data the Markets UI
// reads. This is the ONLY place that fetches on a timer; every other read
// (route handlers, the UI) reads price_cache and never triggers a fetch
// itself except an explicit Refresh. Called by server/jobs.js's 30-min
// interval, and directly by the /refresh route for the manual case.

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

async function refreshSnapshots({ includeIndices = true, includeFutures = true } = {}) {
  const d = db();
  if (!online.enabled('market')) {
    return { ok: false, reason: 'market feature is off', written: 0 };
  }

  let written = 0;
  const now = () => new Date().toISOString();

  const symbols = symbolsFromWatchlistAndHoldings(d);
  for (const symbol of symbols) {
    // eslint-disable-next-line no-await-in-loop
    const q = await providers.yahoo.quote(symbol);
    if (q.quote) {
      repo.upsertPriceCache(d, {
        id: `quote:${symbol}`, kind: 'quote', symbol,
        price_cents: q.quote.price != null ? Math.round(q.quote.price * 100) : null,
        change_pct: q.quote.changePct,
        data: q.quote, source: 'yahoo', fetched_at: now(),
      });
      written += 1;
    }
  }

  if (includeIndices) {
    const idx = await providers.yahoo.indices();
    for (const r of idx) {
      if (!r.quote) continue;
      repo.upsertPriceCache(d, {
        id: `index:${r.symbol}`, kind: 'index', symbol: r.symbol,
        price_cents: r.quote.price != null ? Math.round(r.quote.price * 100) : null,
        change_pct: r.quote.changePct,
        data: { ...r.quote, name: r.name }, source: 'yahoo', fetched_at: now(),
      });
      written += 1;
    }
  }

  if (includeFutures) {
    const fut = await providers.yahoo.futures();
    for (const r of fut) {
      if (!r.quote) continue;
      repo.upsertPriceCache(d, {
        id: `future:${r.symbol}`, kind: 'future', symbol: r.symbol,
        price_cents: r.quote.price != null ? Math.round(r.quote.price * 100) : null,
        change_pct: r.quote.changePct,
        data: { ...r.quote, name: r.name }, source: 'yahoo', fetched_at: now(),
      });
      written += 1;
    }
  }

  return { ok: true, written, at: now() };
}

module.exports = { refreshSnapshots, symbolsFromWatchlistAndHoldings };
