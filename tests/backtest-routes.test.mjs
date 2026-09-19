// Route-level test: mounts the backtest router on an ephemeral Express
// server against the temp MMM_DATA_DIR from tests/setup.mjs. No network —
// every case here drives the CSV-upload path, never bars/sync.
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import routes from '../server/backtest/routes.js';
import store from '../server/money/store.js';

let server; let base;

function csvFor(startPrice) {
  const dates = [
    '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05', '2024-01-08',
    '2024-01-09', '2024-01-10', '2024-01-11', '2024-01-12', '2024-01-16',
    '2024-01-17', '2024-01-18',
  ];
  const rows = dates.map((date, i) => {
    const close = startPrice + i;
    return `${date},${close - 0.5},${close + 0.5},${close - 1},${close},1000`;
  });
  return `date,open,high,low,close,volume\n${rows.join('\n')}`;
}

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
async function get(path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/backtest', routes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/backtest`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => { store.reset(); });

describe('POST /bars/csv', () => {
  it('loads bars fully offline (no network)', async () => {
    const { status, body } = await post('/bars/csv', { symbol: 'AAPL', csv: csvFor(100) });
    expect(status).toBe(200);
    expect(body.symbol).toBe('AAPL');
    expect(body.count).toBe(12);

    const list = await get('/bars');
    expect(list.body).toEqual(['AAPL']);

    const bars = await get('/bars/AAPL');
    expect(bars.body).toHaveLength(12);
    expect(bars.body[0].date).toBe('2024-01-02');
  });

  it('400s a CSV with a bad date', async () => {
    const { status, body } = await post('/bars/csv', { symbol: 'BAD', csv: 'date,open,high,low,close\nnot-a-date,1,1,1,1' });
    expect(status).toBe(400);
    expect(body.error).toMatch(/date/);
  });

  it('400s when csv is missing', async () => {
    const { status } = await post('/bars/csv', { symbol: 'AAPL' });
    expect(status).toBe(400);
  });
});

describe('POST /run', () => {
  it('runs a CSV-driven buyAndHold backtest end to end with no network', async () => {
    await post('/bars/csv', { symbol: 'AAPL', csv: csvFor(100) });
    const { status, body } = await post('/run', {
      symbols: ['AAPL'],
      strategy: { kind: 'buyAndHold', params: { symbol: 'AAPL' } },
      initialCashCents: 1_000_000,
    });
    expect(status).toBe(200);
    expect(body.outcome).toBe('completed');
    expect(body.run.result.trades.length).toBeGreaterThan(0);
    expect(body.run.result.equityCurve.length).toBe(12);
    expect(body.run.metrics).toBeTruthy();
    expect(body.run.metrics.totalCostsCents).toBeGreaterThan(0);
    // Null-return contract preserved verbatim — no benchmark supplied.
    expect(body.run.metrics.beta).toBeNull();
  });

  it('reports outcome "no_data" for a valid config with no matching bars, and persists it', async () => {
    const { status, body } = await post('/run', {
      symbols: ['ZZZZ'],
      strategy: { kind: 'buyAndHold', params: { symbol: 'ZZZZ' } },
      initialCashCents: 1_000_000,
    });
    expect(status).toBe(200);
    expect(body.outcome).toBe('no_data');
    expect(body.run.outcome).toBe('no_data');

    const runs = await get('/runs');
    expect(runs.body.some((r) => r.id === body.run.id)).toBe(true);
  });

  it('reports outcome "invalid_config" for an unknown strategy kind, persisted, 400', async () => {
    await post('/bars/csv', { symbol: 'AAPL', csv: csvFor(100) });
    const { status, body } = await post('/run', {
      symbols: ['AAPL'],
      strategy: { kind: 'nope', params: {} },
      initialCashCents: 1_000_000,
    });
    expect(status).toBe(400);
    expect(body.outcome).toBe('invalid_config');
    expect(body.run.outcome).toBe('invalid_config');
  });

  it('400s a malformed request without persisting a run', async () => {
    const before = (await get('/runs')).body.length;
    const { status, body } = await post('/run', { symbols: [], strategy: { kind: 'buyAndHold' }, initialCashCents: 100 });
    expect(status).toBe(400);
    expect(body.outcome).toBeUndefined();
    const after = (await get('/runs')).body.length;
    expect(after).toBe(before);
  });

  it('round-trips an identical config via its hash — the second call is recognised, not recomputed', async () => {
    await post('/bars/csv', { symbol: 'AAPL', csv: csvFor(100) });
    const req = {
      symbols: ['AAPL'],
      strategy: { kind: 'buyAndHold', params: { symbol: 'AAPL' } },
      initialCashCents: 1_000_000,
    };
    const first = await post('/run', req);
    expect(first.body.outcome).toBe('completed');
    expect(first.body.reused).toBeFalsy();

    const second = await post('/run', req);
    expect(second.status).toBe(200);
    expect(second.body.reused).toBe(true);
    expect(second.body.run.config_hash).toBe(first.body.run.config_hash);
    expect(second.body.run.id).toBe(first.body.run.id);

    // A different config produces a different hash.
    const third = await post('/run', { ...req, initialCashCents: 2_000_000 });
    expect(third.body.run.config_hash).not.toBe(first.body.run.config_hash);
  });

  // I6: the config hash used to exclude bar CONTENT (only row shape/config
  // mattered), so re-uploading corrected bars under an identical config
  // returned the stale cached run instead of recomputing. The hash now folds
  // in a cheap per-symbol {count, maxDate} fingerprint of price_bars.
  it('recomputes (does not reuse) after bars are re-uploaded under an identical config (I6)', async () => {
    await post('/bars/csv', { symbol: 'AAPL', csv: csvFor(100) });
    const req = {
      symbols: ['AAPL'],
      strategy: { kind: 'buyAndHold', params: { symbol: 'AAPL' } },
      initialCashCents: 1_000_000,
    };
    const first = await post('/run', req);
    expect(first.body.outcome).toBe('completed');

    // Re-upload one extra bar for the same symbol — same config, different
    // bar content.
    const extraCsv = `${csvFor(100)}\n2024-01-19,119.5,120.5,119,120,1000`;
    await post('/bars/csv', { symbol: 'AAPL', csv: extraCsv });

    const second = await post('/run', req);
    expect(second.status).toBe(200);
    expect(second.body.outcome).toBe('completed');
    expect(second.body.reused).toBeFalsy();
    expect(second.body.run.config_hash).not.toBe(first.body.run.config_hash);
    expect(second.body.run.id).not.toBe(first.body.run.id);
    expect(second.body.run.result.equityCurve.length).toBe(13);
  });

  // I7: a typo'd strategy symbol (not in the run's own symbol universe)
  // silently placed no orders and produced a "completed" 0% backtest. Now
  // rejected as invalid_config, matching the unknown-strategy-kind case.
  it('reports "invalid_config" when the strategy references a symbol outside the run\'s universe (I7)', async () => {
    await post('/bars/csv', { symbol: 'AAPL', csv: csvFor(100) });
    const { status, body } = await post('/run', {
      symbols: ['AAPL'],
      strategy: { kind: 'buyAndHold', params: { symbol: 'APPL' } }, // typo
      initialCashCents: 1_000_000,
    });
    expect(status).toBe(400);
    expect(body.outcome).toBe('invalid_config');
    expect(body.run.outcome).toBe('invalid_config');
    expect(body.error).toMatch(/APPL/);
  });

  it('reports "invalid_config" when a fixedWeightRebalance weight key is outside the universe (I7)', async () => {
    await post('/bars/csv', { symbol: 'AAPL', csv: csvFor(100) });
    const { status, body } = await post('/run', {
      symbols: ['AAPL'],
      strategy: { kind: 'fixedWeightRebalance', params: { weights: { AAPL: 0.5, MSFT: 0.5 }, everyNBars: 5 } },
      initialCashCents: 1_000_000,
    });
    expect(status).toBe(400);
    expect(body.outcome).toBe('invalid_config');
    expect(body.error).toMatch(/MSFT/);
  });

  it('force:true recomputes even when a completed run with the same hash exists', async () => {
    await post('/bars/csv', { symbol: 'AAPL', csv: csvFor(100) });
    const req = {
      symbols: ['AAPL'],
      strategy: { kind: 'buyAndHold', params: { symbol: 'AAPL' } },
      initialCashCents: 1_000_000,
    };
    const first = await post('/run', req);
    const second = await post('/run', { ...req, force: true });
    expect(second.body.reused).toBeFalsy();
    expect(second.body.run.id).not.toBe(first.body.run.id);
    // Deterministic engine: a fresh run of the identical config produces the
    // same resultHash as the first, even though it's a different DB row.
    expect(second.body.run.result.resultHash).toBe(first.body.run.result.resultHash);
  });
});

describe('strategy presets', () => {
  it('creates, lists, and deletes a preset', async () => {
    const created = await post('/strategies', { name: 'Buy AAPL', kind: 'buyAndHold', params: { symbol: 'AAPL' } });
    expect(created.status).toBe(200);
    const list = await get('/strategies');
    expect(list.body.some((s) => s.id === created.body.id)).toBe(true);
    const del = await fetch(`${base}/strategies/${created.body.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
  });

  it('400s an unknown kind', async () => {
    const { status } = await post('/strategies', { name: 'x', kind: 'nope', params: {} });
    expect(status).toBe(400);
  });
});
