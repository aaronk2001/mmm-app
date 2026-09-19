'use strict';

// Backtest HTTP surface. House style matches server/tools/routes.js: one
// try/catch per handler, 400 {error} on bad input, 500 {error: err.message}
// on throw. Long runs go through worker.js, never the event loop directly.
//
// Bars come from two sources, both landing in the same price_bars table:
// an offline CSV upload (works with zero API keys — the binding
// constraint) or a Yahoo sync that reads Sprint A's online.fetch seam via
// market/providers.js's yahoo.chart() (never calls fetch() itself).
const crypto = require('crypto');
const express = require('express');
const Papa = require('papaparse');
const repo = require('../db/repo');
const { db } = require('../db/connection');
const providers = require('../market/providers');
const { runBacktestInWorker } = require('./worker');
const { metrics: computeMetrics } = require('./metrics');

const router = express.Router();

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const STRATEGY_KINDS = ['buyAndHold', 'dca', 'fixedWeightRebalance', 'smaCross', 'emaCross'];

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
function need(res, name, v) {
  if (v === null || !Number.isFinite(v)) { res.status(400).json({ error: `${name} is required` }); return false; }
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// Deterministic config hashing — recognises a repeat of the same request
// shape (symbols/dates/strategy/costs), independent of key order and
// independent of bar CONTENT (bar data lives in price_bars, not the hash).
// ────────────────────────────────────────────────────────────────────────────

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function configHash(coreConfig) {
  return crypto.createHash('sha256').update(stableStringify(coreConfig)).digest('hex');
}

// Cheap per-symbol {count, maxDate} snapshot of price_bars over the run's
// date range, folded into the hash so a re-upload of corrected bars under an
// otherwise-identical config produces a NEW hash instead of matching (and
// silently reusing) a stale prior run.
function barsFingerprint(symbols, from, to) {
  const out = {};
  for (const s of symbols) out[s] = repo.getPriceBarFingerprint(db(), s, { from, to });
  return out;
}

// Symbols a strategy spec actually references, given its kind/params — used
// to reject a typo'd strategy symbol (e.g. buyAndHold('APPL') over a universe
// of 'AAPL') instead of silently running a no-op backtest.
function strategyReferencedSymbols(kind, params) {
  const p = params || {};
  if (kind === 'fixedWeightRebalance') {
    return Object.keys(p.weights || {}).map((s) => String(s).toUpperCase());
  }
  if (typeof p.symbol === 'string' && p.symbol.trim()) return [String(p.symbol).trim().toUpperCase()];
  return [];
}

// ────────────────────────────────────────────────────────────────────────────
// Bars — CSV upload (offline) + Yahoo sync (opt-in, via online.fetch)
// ────────────────────────────────────────────────────────────────────────────

router.get('/bars', (req, res) => {
  try {
    res.json(repo.getPriceBarSymbols(db()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/bars/:symbol', (req, res) => {
  try {
    const { from, to } = req.query;
    res.json(repo.getPriceBars(db(), req.params.symbol, { from: from || null, to: to || null }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Body: { symbol, csv }. Fully offline — no network call anywhere in this
// path. Expects a header row with at least date,open,high,low,close;
// volume/dividend/split are optional.
router.post('/bars/csv', (req, res) => {
  try {
    const symbol = String(req.body.symbol || '').trim();
    const csv = req.body.csv;
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });
    if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'csv (text) is required' });

    const parsed = Papa.parse(csv.trim(), { header: true, dynamicTyping: true, skipEmptyLines: true });
    if (parsed.errors && parsed.errors.length) {
      return res.status(400).json({ error: `CSV parse error: ${parsed.errors[0].message}` });
    }
    const rows = [];
    for (const [i, r] of parsed.data.entries()) {
      const date = String(r.date ?? '').slice(0, 10);
      if (!YMD_RE.test(date)) return res.status(400).json({ error: `row ${i}: bad or missing date "${r.date}"` });
      const open = Number(r.open), high = Number(r.high), low = Number(r.low), close = Number(r.close);
      if (![open, high, low, close].every(Number.isFinite)) {
        return res.status(400).json({ error: `row ${i}: open/high/low/close must be numbers` });
      }
      rows.push({ date, open, high, low, close, volume: r.volume ?? null, split: r.split ?? 1, dividend: r.dividend ?? 0 });
    }
    if (!rows.length) return res.status(400).json({ error: 'csv contained no data rows' });
    const count = repo.upsertPriceBars(db(), symbol, rows, 'csv');
    res.json({ symbol: symbol.toUpperCase(), count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Body: { symbol, range='5y', interval='1d' }. Opt-in — providers.yahoo.chart
// itself no-ops (never throws) when online.market is disabled, returning
// whatever is cached (possibly nothing).
router.post('/bars/sync', async (req, res) => {
  try {
    const symbol = String(req.body.symbol || '').trim();
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });
    const range = req.body.range || '5y';
    const interval = req.body.interval || '1d';
    const result = await providers.yahoo.chart(symbol, { range, interval });
    if (!result.series || !result.series.length) {
      return res.json({ symbol: symbol.toUpperCase(), count: 0, offline: !!result.offline, stale: !!result.stale });
    }
    const rows = result.series.map((r) => ({ date: r.time, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume, split: 1, dividend: 0 }));
    const count = repo.upsertPriceBars(db(), symbol, rows, 'yahoo');
    res.json({ symbol: symbol.toUpperCase(), count, offline: !!result.offline, stale: !!result.stale });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/bars/:symbol', (req, res) => {
  try {
    res.json({ deleted: repo.deletePriceBars(db(), req.params.symbol) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// Strategy presets
// ────────────────────────────────────────────────────────────────────────────

router.get('/strategies', (req, res) => {
  try { res.json(repo.getStrategies(db())); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/strategies', (req, res) => {
  try {
    const { name, kind, params } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' });
    if (!STRATEGY_KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of: ${STRATEGY_KINDS.join(', ')}` });
    res.json(repo.createStrategy(db(), { name, kind, params: params || {} }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/strategies/:id', (req, res) => {
  try { repo.deleteStrategy(db(), req.params.id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// Runs
// ────────────────────────────────────────────────────────────────────────────

router.get('/runs', (req, res) => {
  try { res.json(repo.getBacktestRuns(db(), { limit: num(req.query.limit) || 50 })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/runs/:id', (req, res) => {
  try {
    const run = repo.getBacktestRun(db(), req.params.id);
    if (!run) return res.status(404).json({ error: 'run not found' });
    res.json(run);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Builds a "buy and hold $1 at t0" curve for beta/alpha/tracking-error
// against a benchmark symbol, scaled to the run's own starting cash so the
// two curves are comparable in level, not just in shape. Reads the
// benchmark symbol's own bars directly (independent of the run's symbol
// list/date intersection) — metrics.js's alignedReturns() matches curves
// by date and tolerates a benchmark whose calendar only partly overlaps.
function buildBenchmarkCurve(symbol, from, to, initialCashCents) {
  const rows = repo.getPriceBars(db(), symbol, { from, to });
  if (!rows.length || !rows[0].close) return null;
  const basePrice = rows[0].close;
  return rows.map((b) => ({ date: b.date, equity_cents: Math.round((b.close / basePrice) * initialCashCents) }));
}

function intersectDates(barsBySymbol, symbols) {
  let dates = null;
  for (const s of symbols) {
    const ds = new Set(barsBySymbol[s].map((b) => b.date));
    dates = dates ? new Set([...dates].filter((d) => ds.has(d))) : ds;
  }
  return [...(dates || [])].sort();
}

function alignBars(barsBySymbol, symbols, dates) {
  const out = {};
  for (const s of symbols) {
    const byDate = new Map(barsBySymbol[s].map((b) => [b.date, b]));
    out[s] = dates.map((d) => {
      const b = byDate.get(d);
      return { date: d, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, split: b.split ?? 1, dividend: b.dividend ?? 0 };
    });
  }
  return out;
}

// Body: { symbols: string[], from?, to?, strategy: {kind, params}, initialCashCents,
//         slippageBps?, commissionCents?, maxWeightPerAsset?, benchmarkSymbol?,
//         splitDate?, force? }
router.post('/run', async (req, res) => {
  let coreConfig;
  try {
    const body = req.body || {};
    const symbols = Array.isArray(body.symbols) ? [...new Set(body.symbols.map((s) => String(s).toUpperCase()))] : [];
    const strategy = body.strategy && typeof body.strategy === 'object' ? body.strategy : null;
    const initialCashCents = num(body.initialCashCents);
    const slippageBps = body.slippageBps !== undefined ? num(body.slippageBps) : undefined;
    const commissionCents = body.commissionCents !== undefined ? num(body.commissionCents) : undefined;
    const maxWeightPerAsset = body.maxWeightPerAsset !== undefined ? num(body.maxWeightPerAsset) : undefined;
    const from = body.from ? String(body.from).slice(0, 10) : null;
    const to = body.to ? String(body.to).slice(0, 10) : null;
    const benchmarkSymbol = body.benchmarkSymbol ? String(body.benchmarkSymbol).toUpperCase() : null;
    const splitDate = body.splitDate ? String(body.splitDate).slice(0, 10) : null;

    // ── malformed shape → 400, not persisted ──────────────────────────────
    if (!symbols.length) return res.status(400).json({ error: 'symbols must be a non-empty array' });
    if (!strategy || typeof strategy.kind !== 'string') return res.status(400).json({ error: 'strategy.kind (string) is required' });
    if (!need(res, 'initialCashCents', initialCashCents)) return;
    if (!Number.isInteger(initialCashCents) || initialCashCents < 0) {
      return res.status(400).json({ error: 'initialCashCents must be a non-negative integer' });
    }

    coreConfig = {
      symbols: [...symbols].sort(), from, to, strategy, initialCashCents,
      slippageBps, commissionCents, maxWeightPerAsset, benchmarkSymbol, splitDate,
      barsFingerprint: barsFingerprint(symbols, from, to),
    };
    const hash = configHash(coreConfig);

    if (!body.force) {
      const prior = repo.getBacktestRunsByHash(db(), hash).find((r) => r.outcome === 'completed');
      if (prior) return res.json({ run: prior, outcome: prior.outcome, reused: true });
    }

    // ── semantically invalid config → 400, persisted ──────────────────────
    if (!STRATEGY_KINDS.includes(strategy.kind)) {
      const errMsg = `Unknown strategy kind: "${strategy.kind}"`;
      const run = repo.createBacktestRun(db(), { config_hash: hash, config: coreConfig, outcome: 'invalid_config', error: errMsg });
      return res.status(400).json({ error: errMsg, outcome: 'invalid_config', run });
    }

    const missingSymbols = strategyReferencedSymbols(strategy.kind, strategy.params).filter((s) => !symbols.includes(s));
    if (missingSymbols.length) {
      const errMsg = `strategy references symbol(s) not in symbols: ${missingSymbols.join(', ')}`;
      const run = repo.createBacktestRun(db(), { config_hash: hash, config: coreConfig, outcome: 'invalid_config', error: errMsg });
      return res.status(400).json({ error: errMsg, outcome: 'invalid_config', run });
    }

    // ── gather + align bars ────────────────────────────────────────────────
    const barsBySymbol = {};
    for (const s of symbols) barsBySymbol[s] = repo.getPriceBars(db(), s, { from, to });
    const dates = intersectDates(barsBySymbol, symbols);

    if (dates.length < 2) {
      const run = repo.createBacktestRun(db(), { config_hash: hash, config: coreConfig, outcome: 'no_data' });
      return res.json({ run, outcome: 'no_data' });
    }

    const alignedBars = alignBars(barsBySymbol, symbols, dates);

    // ── run (off the event loop) ───────────────────────────────────────────
    let result;
    try {
      result = await runBacktestInWorker({
        bars: alignedBars,
        strategySpec: strategy,
        initialCashCents,
        slippageBps,
        commissionCents,
        maxWeightPerAsset,
      });
    } catch (err) {
      const run = repo.createBacktestRun(db(), { config_hash: hash, config: coreConfig, outcome: 'failed', error: err.message });
      return res.status(500).json({ error: err.message, outcome: 'failed', run });
    }

    const benchmarkCurve = benchmarkSymbol ? buildBenchmarkCurve(benchmarkSymbol, from, to, initialCashCents) : null;
    const runMetrics = computeMetrics(result.equityCurve, result.trades, benchmarkCurve, splitDate);

    const run = repo.createBacktestRun(db(), {
      config_hash: hash, config: coreConfig, outcome: 'completed', result, metrics: runMetrics,
    });
    res.json({ run, outcome: 'completed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
