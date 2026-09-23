'use strict';

// /api/betting — house style follows server/market/routes.js: express.Router(),
// one try/catch per handler, 400 for bad input, 500 with err.message on throw.
// Every handler is a GET that reads through online.fetch, so the rate limiter
// in server/api-limiter.js already treats /betting/ as a network read.
//
// Informational only. There is no POST here on purpose: nothing about betting
// writes to the ledger, moves money, or records a wager — the same paper-only
// posture as the trading section.

const express = require('express');
const providers = require('./providers');

const router = express.Router();

const clamp = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : dflt;
};

// ── prediction markets — keyless, work whenever the feature is on ───────────

router.get('/prediction-markets', async (req, res) => {
  try {
    const out = await providers.predictionMarkets({
      source: req.query.source || 'all',
      category: req.query.category || 'All',
      sort: req.query.sort || 'volume',
      limit: clamp(req.query.limit, 1, 100, 50),
    });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── The Odds API — needs a key; degrades to cached/defaults without one ─────

router.get('/sports-list', async (req, res) => {
  try { res.json(await providers.sportsList()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sports-odds', async (req, res) => {
  try {
    if (!req.query.sport) return res.status(400).json({ error: 'sport is required' });
    const out = await providers.sportsOdds(String(req.query.sport), {
      markets: req.query.markets || undefined,
      bookmakers: req.query.bookmakers || undefined,
      regions: req.query.regions || undefined,
      limit: clamp(req.query.limit, 1, 50, 20),
    });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/arbitrage', async (req, res) => {
  try {
    const sports = req.query.sports ? String(req.query.sports).split(',').filter(Boolean) : undefined;
    const out = await providers.arbitrage({
      minProfitPct: clamp(req.query.minProfit, 0, 100, 0.5),
      limit: clamp(req.query.limit, 1, 50, 20),
      totalStake: clamp(req.query.stake, 1, 1_000_000, 1000),
      sports,
    });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
