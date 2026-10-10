'use strict';

// Sprint A, Track 2 — /api/market. House style follows server/tools/routes.js:
// express.Router(), one try/catch per handler, 400 for bad input, 500 with
// err.message on throw. Reads here (snapshots, watchlist) never trigger a
// network fetch; only /refresh and /earnings, /screener do, and all of those
// go through the same online.enabled('market') gate as everything else.

const express = require('express');
const { db } = require('../db/connection');
const repo = require('../db/repo');
const online = require('../online');
const providers = require('./providers');
const { trailingTwelveMonths } = require('./dividends');
const { refreshSnapshots } = require('./snapshots');

const router = express.Router();

// ────────────────────────────────────────────────────────────────────────────
// Snapshots — reads price_cache only, never fetches
// ────────────────────────────────────────────────────────────────────────────

router.get('/snapshots', (req, res) => {
  try {
    const kind = req.query.kind || null;
    res.json({ price_cache: repo.getPriceCache(db(), kind) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Explicit Refresh — the one UI-triggered fetch path. Still gated on
// online.enabled('market'); if the feature is off this is a no-op that says
// so rather than silently doing nothing.
router.post('/refresh', async (req, res) => {
  try {
    if (!online.enabled('market')) return res.status(400).json({ error: 'Market data is off. Enable it in Settings first.' });
    const result = await refreshSnapshots();
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// Live-ish reads — go through online.fetch's cache/TTL seam
// ────────────────────────────────────────────────────────────────────────────

router.get('/quote/:symbol', async (req, res) => {
  try {
    const out = await providers.yahoo.quote(req.params.symbol.toUpperCase());
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/chart/:symbol', async (req, res) => {
  try {
    const { range, interval } = req.query;
    const out = await providers.yahoo.chart(req.params.symbol.toUpperCase(), {
      range: range || undefined, interval: interval || undefined,
    });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/indices', async (req, res) => {
  try { res.json({ indices: await providers.yahoo.indices() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/futures', async (req, res) => {
  try { res.json({ futures: await providers.yahoo.futures() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sectors', async (req, res) => {
  try { res.json({ sectors: await providers.yahoo.sectors() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/earnings/:symbol', async (req, res) => {
  try {
    const out = await providers.yahoo.earnings(req.params.symbol.toUpperCase());
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/screens', (req, res) => {
  res.json({ screens: Object.entries(providers.SCREENS).map(([id, label]) => ({ id, label })) });
});

router.get('/screener/:screenId', async (req, res) => {
  try {
    const out = await providers.yahoo.screener(req.params.screenId);
    res.json(out);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/macro/:seriesId', async (req, res) => {
  try {
    const out = await providers.fred.series(req.params.seriesId, { limit: req.query.limit ? Number(req.query.limit) : undefined });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/crypto', async (req, res) => {
  try {
    const ids = req.query.ids ? String(req.query.ids).split(',') : undefined;
    const out = await providers.coingecko.simplePrice(ids);
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/forex', async (req, res) => {
  try {
    const base = req.query.base || undefined;
    const symbols = req.query.symbols ? String(req.query.symbols).split(',') : undefined;
    const out = await providers.frankfurter.latest(base, symbols);
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// Investments "Refresh prices" — the explicit, UI-triggered action that sets
// holding.price_source='yahoo'. Manual entry (Investments.jsx's own price
// edit) stays the default; this only overwrites a holding once a live quote
// actually came back for its symbol.
// ────────────────────────────────────────────────────────────────────────────

router.post('/refresh-holdings', async (req, res) => {
  try {
    if (!online.enabled('market')) return res.status(400).json({ error: 'Market data is off. Enable it in Settings first.' });
    const d = db();
    const holdings = repo.getHoldings(d);
    const symbols = [...new Set(holdings.map((h) => String(h.symbol).toUpperCase()))];
    const prices = {};
    const dividends = {};
    for (const symbol of symbols) {
      // eslint-disable-next-line no-await-in-loop
      const q = await providers.yahoo.quote(symbol);
      if (q.quote?.price != null) prices[symbol] = q.quote.price;
      try {
        // eslint-disable-next-line no-await-in-loop
        const c = await providers.yahoo.chart(symbol, { range: '1y', interval: '1wk' });
        if (c.meta) dividends[symbol] = trailingTwelveMonths(c.dividends);
      } catch { /* a failed chart must not block the price update */ }
    }
    let updated = 0;
    for (const h of holdings) {
      const key = String(h.symbol).toUpperCase();
      const price = prices[key];
      if (price != null) {
        repo.updateHolding(d, h.id, { current_price: price, price_source: 'yahoo' });
        updated += 1;
      }
      if (dividends[key] != null) repo.updateHolding(d, h.id, { dividend_ttm: dividends[key] });
    }
    res.json({ ok: true, updated, total: holdings.length, holdings: repo.getHoldings(d) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// Watchlist CRUD — no other track claims this route surface
// ────────────────────────────────────────────────────────────────────────────

router.get('/watchlist', (req, res) => {
  try { res.json({ watchlist: repo.getWatchlist(db()) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/watchlist', (req, res) => {
  try {
    if (!req.body.symbol) return res.status(400).json({ error: 'symbol is required' });
    res.status(201).json(repo.createWatchlistItem(db(), req.body));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/watchlist/:id', (req, res) => {
  try {
    repo.deleteWatchlistItem(db(), req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(404).json({ error: err.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// Alert rules — storage only in this sprint (no evaluator/notifier yet)
// ────────────────────────────────────────────────────────────────────────────

router.get('/alerts', (req, res) => {
  try { res.json({ alert_rules: repo.getAlertRules(db()) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/alerts', (req, res) => {
  try {
    const { symbol, condition, target } = req.body;
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });
    if (!['above', 'below'].includes(condition)) return res.status(400).json({ error: 'condition must be "above" or "below"' });
    if (target === undefined || !Number.isFinite(Number(target))) return res.status(400).json({ error: 'target is required' });
    res.status(201).json(repo.createAlertRule(db(), req.body));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/alerts/:id', (req, res) => {
  try { res.json(repo.updateAlertRule(db(), req.params.id, req.body)); }
  catch (err) { res.status(404).json({ error: err.message }); }
});

router.delete('/alerts/:id', (req, res) => {
  try {
    repo.deleteAlertRule(db(), req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(404).json({ error: err.message }); }
});

module.exports = router;
