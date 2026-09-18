'use strict';

// Trades HTTP surface — thin Express wrapper over paper-store.js + strategy-gate.js.
// House style matches server/tools/routes.js: one try/catch per handler,
// 400 on bad input, 500 on throw. Paper-only: nothing here ever touches a
// brokerage or auto-opens a position.
const express = require('express');
const repo = require('../db/repo');
const { db } = require('../db/connection');
const paperStore = require('./paper-store');
const { gateDecision } = require('./strategy-gate');

const router = express.Router();

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
function need(res, name, v) {
  if (v === null || !Number.isFinite(v)) { res.status(400).json({ error: `${name} is required` }); return false; }
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Account / positions / trades / summary
// ────────────────────────────────────────────────────────────────────────────

router.get('/account', (req, res) => {
  try {
    res.json(paperStore.getAccount());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/positions', (req, res) => {
  try {
    res.json(paperStore.listPositions());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/trades', (req, res) => {
  try {
    res.json(paperStore.listTrades());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/summary', (req, res) => {
  try {
    res.json(paperStore.getSummary());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// Gate check — dry-run the strategy gate without opening anything. Lets the
// UI show violations/sizing before Aaron commits to a paper BUY.
// ────────────────────────────────────────────────────────────────────────────

router.post('/gate-check', (req, res) => {
  try {
    const decision = req.body.decision;
    const lastPrice = num(req.body.lastPrice);
    if (!decision || typeof decision !== 'object') return res.status(400).json({ error: 'decision is required' });
    if (!need(res, 'lastPrice', lastPrice)) return;
    const ctx = paperStore.buildGateContext();
    res.json(gateDecision(decision, ctx, lastPrice));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// Open / close / reset
// ────────────────────────────────────────────────────────────────────────────

router.post('/open', (req, res) => {
  try {
    const decision = req.body.decision;
    const lastPrice = num(req.body.lastPrice);
    if (!decision || typeof decision !== 'object') return res.status(400).json({ error: 'decision is required' });
    if (!need(res, 'lastPrice', lastPrice)) return;
    const result = paperStore.open(decision, lastPrice);
    if (!result.ok) return res.status(400).json({ error: 'rejected by strategy gate', violations: result.violations });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// paper-store.close() returns { ok:false, status:404 } for BOTH an unknown
// position id and a second concurrent close on an already-closed position —
// it doesn't (and can't, post-delete) distinguish the two. The brief calls
// for a close on an already-closed position to surface as 409 Conflict (the
// position existed but its state no longer allows this action), so this
// route maps the store's 404 to a 409 here rather than passing it through
// verbatim. See track-3-report.md for the full writeup.
router.post('/close/:id', (req, res) => {
  try {
    const exitPrice = num(req.body.exitPrice);
    if (!need(res, 'exitPrice', exitPrice)) return;
    const what_happened = req.body.what_happened || '';
    const lesson = req.body.lesson || '';
    const result = paperStore.close(req.params.id, exitPrice, { what_happened, lesson });
    if (!result.ok) return res.status(409).json({ error: result.error || 'Position already closed or not found' });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reset', (req, res) => {
  try {
    res.json(paperStore.reset());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// Journal — free-form "lesson learned" notes, optionally tied to a closed trade
// ────────────────────────────────────────────────────────────────────────────

router.get('/journal', (req, res) => {
  try {
    res.json(repo.getPaperJournal(db(), req.query.trade_id || null));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/journal', (req, res) => {
  try {
    const note = req.body.note;
    if (typeof note !== 'string' || !note.trim()) return res.status(400).json({ error: 'note is required' });
    const entry = repo.createPaperJournalEntry(db(), {
      trade_id: req.body.trade_id || null,
      note: note.trim(),
      tag: req.body.tag || null,
    });
    res.json(entry);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
