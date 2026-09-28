const express = require('express');
const { db } = require('../db/connection');
const repo = require('../db/repo');
const { validateSettings } = require('../middleware/validators');
const { AVAILABLE_CURRENCIES } = require('../money/calc');

const router = express.Router();

// GET /api/settings → the full user settings object (theme, dashboards, etc.)
router.get('/', (_req, res) => {
  try { res.json(repo.getSettings(db())); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/settings → shallow-merge the body into settings, return the result.
router.put('/', (req, res) => {
  try {
    const check = validateSettings(req.body, { currencies: AVAILABLE_CURRENCIES });
    if (!check.valid) return res.status(400).json({ error: check.errors.join('; ') });
    res.json(repo.setSettings(db(), req.body));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
