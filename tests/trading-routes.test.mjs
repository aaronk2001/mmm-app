// Route-level test: mounts the trading router on an ephemeral Express server
// against the temp MMM_DATA_DIR from tests/setup.mjs.
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import routes from '../server/trading/routes.js';
import store from '../server/money/store.js';

let server; let base;

function buy(overrides = {}) {
  return {
    action: 'BUY',
    symbol: 'AAPL',
    conviction: 8,
    thesis_id: 't1',
    thesis: 'Strong earnings momentum.',
    position_pct: 10,
    ...overrides,
  };
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
  app.use('/api/trading', routes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/trading`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => { store.reset(); });

describe('GET /account', () => {
  it('starts at $100,000', async () => {
    const { status, body } = await get('/account');
    expect(status).toBe(200);
    expect(body.capital).toBe(100000);
  });
});

describe('POST /gate-check', () => {
  it('reports a passing gate without opening anything', async () => {
    const { status, body } = await post('/gate-check', { decision: buy(), lastPrice: 100 });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect((await get('/positions')).body).toHaveLength(0);
  });

  it('400s when lastPrice is missing', async () => {
    const { status, body } = await post('/gate-check', { decision: buy() });
    expect(status).toBe(400);
    expect(body.error).toMatch(/lastPrice/);
  });
});

describe('POST /open', () => {
  it('opens a gated BUY', async () => {
    const { status, body } = await post('/open', { decision: buy(), lastPrice: 100 });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.position.shares).toBe(100);
  });

  it('400s a gate-rejected BUY with violations', async () => {
    const { status, body } = await post('/open', { decision: buy({ conviction: 1 }), lastPrice: 100 });
    expect(status).toBe(400);
    expect(body.violations.join(' ')).toMatch(/conviction/);
  });

  it('400s when decision is missing', async () => {
    const { status } = await post('/open', { lastPrice: 100 });
    expect(status).toBe(400);
  });
});

describe('POST /close/:id', () => {
  it('closes an open position and reconciles capital', async () => {
    const opened = (await post('/open', { decision: buy(), lastPrice: 100 })).body;
    const { status, body } = await post(`/close/${opened.position.id}`, { exitPrice: 110 });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.trade.pnl).toBeGreaterThan(0);
  });

  it('a second close on the same (now already-closed) position returns 409', async () => {
    const opened = (await post('/open', { decision: buy(), lastPrice: 100 })).body;
    const first = await post(`/close/${opened.position.id}`, { exitPrice: 105 });
    expect(first.status).toBe(200);
    const second = await post(`/close/${opened.position.id}`, { exitPrice: 105 });
    expect(second.status).toBe(409);
  });

  it('closing an unknown id returns 409, not a 500', async () => {
    const { status } = await post('/close/nope', { exitPrice: 100 });
    expect(status).toBe(409);
  });

  it('400s when exitPrice is missing', async () => {
    const opened = (await post('/open', { decision: buy(), lastPrice: 100 })).body;
    const { status } = await post(`/close/${opened.position.id}`, {});
    expect(status).toBe(400);
  });
});

describe('POST /reset', () => {
  it('restores starting capital', async () => {
    await post('/open', { decision: buy(), lastPrice: 100 });
    const { status, body } = await post('/reset', {});
    expect(status).toBe(200);
    expect(body.account.capital).toBe(100000);
  });
});

describe('journal', () => {
  it('round-trips a note', async () => {
    const created = await post('/journal', { note: 'Lesson learned: size down on earnings.' });
    expect(created.status).toBe(200);
    const { status, body } = await get('/journal');
    expect(status).toBe(200);
    expect(body.some((j) => j.id === created.body.id)).toBe(true);
  });

  it('400s an empty note', async () => {
    const { status } = await post('/journal', { note: '   ' });
    expect(status).toBe(400);
  });
});
