'use strict';

// Runs engine.js inside a worker_thread so a heavy backtest never blocks the
// Express event loop. This file is BOTH the main-thread launcher (exports
// runBacktestInWorker) and the worker-thread entry point (the isMainThread
// guard below) — Node re-requires this same path with a fresh V8 context
// when a Worker is spawned against it.
//
// Strategy objects can't cross the worker boundary (structured clone drops
// functions), so the main thread never passes one. It passes a serializable
// {kind, params} spec instead; the worker side reconstructs the real
// strategy from server/backtest/strategies.js before calling runBacktest.

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Builds a concrete strategy object from a serializable spec.
 * @param {{kind: string, params?: object}} spec
 * @returns {{name: string, onBar: function}}
 */
function buildStrategy(spec) {
  const strategies = require('./strategies');
  const { kind, params = {} } = spec || {};
  switch (kind) {
    case 'buyAndHold': return strategies.buyAndHold(params.symbol);
    case 'dca': return strategies.dca(params);
    case 'fixedWeightRebalance': return strategies.fixedWeightRebalance(params);
    case 'smaCross': return strategies.smaCross(params);
    case 'emaCross': return strategies.emaCross(params);
    default: throw new Error(`Unknown strategy kind: "${kind}"`);
  }
}

// ── worker-thread side ──────────────────────────────────────────────────────
if (!isMainThread) {
  (function runInWorker() {
    try {
      const { runBacktest } = require('./engine');
      const { bars, strategySpec, initialCashCents, slippageBps, commissionCents, maxWeightPerAsset } = workerData;
      const strategy = buildStrategy(strategySpec);
      const result = runBacktest({ bars, strategy, initialCashCents, slippageBps, commissionCents, maxWeightPerAsset });
      parentPort.postMessage({ ok: true, result });
    } catch (err) {
      parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  })();
}

// ── main-thread side ────────────────────────────────────────────────────────

/**
 * Runs a backtest off the event loop in a worker_thread. Resolves with
 * engine.js's normal result shape or rejects with an Error carrying a
 * usable message — the caller never has to guess why a run failed, and a
 * throw inside the worker never hangs the request.
 * @param {{bars: object, strategySpec: {kind: string, params?: object}, initialCashCents: number, slippageBps?: number, commissionCents?: number, maxWeightPerAsset?: number}} config
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<object>}
 */
function runBacktestInWorker(config, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(__filename, { workerData: config });
    // Never keeps the host process alive by itself — a crash in the caller
    // (or process exit while a run is in flight) doesn't hang the app.
    worker.unref();

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error(`Backtest timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref();

    function finish(fn) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      fn();
    }

    worker.on('message', (msg) => {
      finish(() => {
        if (msg && msg.ok) resolve(msg.result);
        else reject(new Error((msg && msg.error) || 'Backtest worker failed with no message'));
      });
    });
    worker.on('error', (err) => {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    });
    worker.on('exit', (code) => {
      finish(() => {
        if (code !== 0) reject(new Error(`Backtest worker exited with code ${code}`));
        else reject(new Error('Backtest worker exited before reporting a result'));
      });
    });
  });
}

module.exports = { runBacktestInWorker, buildStrategy, DEFAULT_TIMEOUT_MS };
