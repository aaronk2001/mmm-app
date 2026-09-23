'use strict';

// /api/news — mirrors server/market/routes.js: express.Router(), one
// try/catch per handler, 400 for bad input. The providers below never throw
// for a disabled feature, a missing key, or a dead endpoint; they resolve to
// an empty article list plus a `reason`, so these handlers effectively never
// reach their 500 branch. `/market` is declared before `/:ticker` so Express
// doesn't read "market" as a ticker.

const express = require('express');
const providers = require('./providers');

const router = express.Router();

router.get('/market', async (req, res) => {
  try {
    res.json(await providers.marketaux.market({ limit: req.query.limit }));
  } catch (err) { res.status(500).json({ error: err.message, articles: [] }); }
});

router.get('/:ticker', async (req, res) => {
  const ticker = String(req.params.ticker || '').toUpperCase();
  if (!providers.SYMBOL_RE.test(ticker)) return res.status(400).json({ error: 'Invalid ticker', articles: [] });
  try {
    res.json(await providers.marketaux.forSymbol(ticker, { limit: req.query.limit }));
  } catch (err) { res.status(500).json({ error: err.message, articles: [] }); }
});

module.exports = router;
