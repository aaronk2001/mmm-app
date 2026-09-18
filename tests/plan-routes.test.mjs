// Route-level test: mounts the plan router on an ephemeral Express server
// against the temp MMM_DATA_DIR from tests/setup.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import routes from '../server/tools/routes.js';
import store from '../server/money/store.js';
import runwayModule from '../server/money/runway.js';

const { computeRunway } = runwayModule;

let server; let base;

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  store.reset();
  const data = store.readData();
  data.accounts = [
    { id: 'a1', name: 'Checking', type: 'checking', balance: 4000, opening_balance: 4000 },
    { id: 'a2', name: 'Savings',  type: 'savings',  balance: 6000, opening_balance: 6000 },
  ];
  data.recurring = [
    { id: 'r1', payee: 'Rent', amount: 3200, cadence: 'monthly', kind: 'bill', next_date: '2026-10-01' },
  ];
  store.writeData(data);

  const app = express();
  app.use(express.json());
  app.use('/api/plan', routes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/plan`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('profile round-trip', () => {
  it('starts incomplete', async () => {
    const res = await fetch(`${base}/profile`);
    expect((await res.json()).complete).toBe(false);
  });

  it('persists a valid profile and reports complete', async () => {
    const put = await fetch(`${base}/profile`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Aaron', state: 'AZ', gross_salary: 65000, age: 24 }),
    });
    expect(put.status).toBe(200);
    const res = await fetch(`${base}/profile`);
    const body = await res.json();
    expect(body.profile.gross_salary).toBe(65000);
    expect(body.complete).toBe(true);
  });

  it('400s an invalid profile with a real message', async () => {
    const res = await fetch(`${base}/profile`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ age: 300 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/age/i);
  });
});

describe('GET /snapshot', () => {
  it('fuses the declared salary with real balances', async () => {
    const body = await (await fetch(`${base}/snapshot`)).json();
    expect(body.assets.checking).toBe(4000);
    expect(body.expenses.total_monthly).toBe(3200);
    expect(body.income.current_gross).toBe(65000);
    expect(body.grade).toBe('A');
  });
});

describe('POST /offer', () => {
  it('returns the three deltas the Plan section shows', async () => {
    const { status, body } = await post('/offer', { new_salary: 85000, gap_weeks: 0 });
    expect(status).toBe(200);
    expect(body.delta_monthly_take_home).toBe(1131);
    expect(typeof body.delta_runway_months).toBe('number');
    expect(typeof body.delta_net_worth_18mo).toBe('number');
    expect(body.tax_year).toBe(2024);
  });

  it('400s without a new_salary', async () => {
    expect((await post('/offer', {})).status).toBe(400);
  });

  it('injects the take-home into exactly one liquid account, not every checking account', async () => {
    const data = store.readData();
    data.accounts = [
      { id: 'c1', name: 'Checking 1', type: 'checking', balance: 2000, opening_balance: 2000 },
      { id: 'c2', name: 'Checking 2', type: 'checking', balance: 2000, opening_balance: 2000 },
      { id: 's1', name: 'Savings',    type: 'savings',  balance: 6000, opening_balance: 6000 },
    ];
    store.writeData(data);

    const { body } = await post('/offer', { new_salary: 85000, gap_weeks: 0 });

    // A single injection into the first checking account (c1) is the only
    // correct answer — computeRunway sums liquid across accounts, so double-
    // injecting into c2 as well would inflate this delta.
    const base = computeRunway({ ...data });
    const singleInjection = computeRunway({
      ...data,
      accounts: data.accounts.map((a) => (a.id === 'c1'
        ? { ...a, balance: a.balance + body.offer.monthly_take_home }
        : a)),
    });
    const expectedDelta = Math.round((singleInjection.months - base.months) * 10) / 10;

    expect(body.delta_runway_months).toBe(expectedDelta);
  });

  it('applies the employment gap to the offer scenario only, not the baseline', async () => {
    const { body: noGap } = await post('/offer', { new_salary: 85000, gap_weeks: 0 });
    const { body: withGap } = await post('/offer', { new_salary: 85000, gap_weeks: 8 });
    expect(withGap.delta_net_worth_18mo).toBeLessThan(noGap.delta_net_worth_18mo);
  });
});

describe('loan endpoints', () => {
  it('computes a mortgage', async () => {
    const { body } = await post('/mortgage', { purchase_price: 400000, down_payment_pct: 0, annual_rate: 7, term_years: 30 });
    expect(body.monthly_pi).toBeCloseTo(2661.21, 2);
  });

  it('computes a refi breakeven', async () => {
    const { body } = await post('/refi', { current_rate: 7, new_rate: 5.5, balance: 300000, years_remaining: 25, closing_costs: 6000 });
    expect(body.breakeven_months).toBe(22);
  });

  it('defaults DTI inputs from real data when the body omits them', async () => {
    const { body } = await post('/dti', {});
    expect(body.gross_monthly_income).toBeGreaterThan(0);
  });

  it('400s a mortgage with a missing rate', async () => {
    expect((await post('/mortgage', { purchase_price: 400000 })).status).toBe(400);
  });
});

describe('POST /what-if', () => {
  it('returns an 18-row timeline with milestones', async () => {
    const { body } = await post('/what-if', { new_salary: 85000, savings_rate: 0.3 });
    expect(body.timeline).toHaveLength(18);
    expect(Array.isArray(body.milestones)).toBe(true);
  });
});
