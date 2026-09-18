'use strict';

const express = require('express');
const { db } = require('../db/connection');
const repo = require('../db/repo');
const online = require('./index');
const keys = require('./keys');

const router = express.Router();

// GET /api/online/settings -> the seven feature toggles, defaults filled in.
router.get('/settings', (_req, res) => {
  try { res.json({ online: online.getOnlineSettings(db()) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/online/settings -> patch merged into settings.online (mirrors the
// generic /api/settings PUT, scoped to just this namespace).
router.put('/settings', (req, res) => {
  try {
    const d = db();
    repo.setSettings(d, { online: req.body || {} });
    res.json({ online: online.getOnlineSettings(d) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/online/keys -> presence booleans only, never values. This reflects
// this server process's actual in-memory state (populated over the Electron
// fork() IPC channel), not Electron's own copy of keys.enc — those two can
// briefly disagree (e.g. right after a key is saved, or in dev-fallback
// mode), and the presence check must answer for the process that would
// actually make the request.
router.get('/keys', (_req, res) => {
  res.json({ keys: keys.presence() });
});

// POST /api/online/test { feature } -> a real check against this server's
// state: is the feature enabled, and does this process actually hold a key
// for it? No network call — Track 1 ships no providers to call yet, and a
// "Test" button that only reflects client-side state (localStorage, or
// Electron's copy of keys.enc) is exactly the bug NEXUS shipped: it reported
// success while the server had nothing.
router.post('/test', (req, res) => {
  const feature = String(req.body?.feature || '');
  if (!online.FEATURES.includes(feature)) return res.status(400).json({ error: 'Unknown feature.' });
  const isEnabled = online.enabled(feature, db());
  const hasKey = keys.hasKey(feature);
  let message;
  if (!isEnabled) message = 'Feature is turned off.';
  else if (hasKey) message = 'Enabled — key saved on this device.';
  else message = 'Enabled — no key saved (fine for key-free providers).';
  res.json({ feature, enabled: isEnabled, hasKey, ok: isEnabled, message });
});

module.exports = router;
