// Coach proposal routes — real Express router against the temp DB from
// tests/setup.mjs, same pattern as tests/learn-routes.test.mjs.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';
import routes from '../server/money/routes.js';
import store from '../server/money/store.js';

let server; let base;

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const get = (path) => call('GET', path);
const post = (path, body) => call('POST', path, body);

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/money', routes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/money`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

let goalId;
beforeEach(() => {
  store.reset();
  store.createAccount('Checking', 'checking', 500);
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth() + 12, 1);
  const target_date = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-01`;
  goalId = store.createGoal('Car', 12000, 1000, null, target_date, null, 100).id;
});

const finding = async () => (await get('/advice')).body.findings.find((f) => f.id === `goal-behind-${goalId}`);
const contribution = async () => (await get('/goals')).body.goals.find((g) => g.id === goalId).monthly_contribution;

describe('coach proposals', () => {
  it('GET /advice carries the proposal', async () => {
    const f = await finding();
    expect(f.proposal).toMatchObject({ action: 'update_goal_contribution', verb: 'Raise contribution' });
    expect(f.proposal.params.goal_id).toBe(goalId);
    expect(f.proposal.params.monthly_contribution).toBeGreaterThan(100);
  });

  it('rejects malformed bodies with 400', async () => {
    expect((await post('/advice/confirm', {})).status).toBe(400);
    expect((await post('/advice/confirm', { finding_id: 'x', fingerprint: 5 })).status).toBe(400);
    expect((await post('/advice/dismiss', { finding_id: 'x' })).status).toBe(400);
    expect((await post('/advice/undo', { activity_log_id: 'x' })).status).toBe(400);
  });

  it('409s on a wrong fingerprint and on an unknown finding', async () => {
    const f = await finding();
    const wrong = await post('/advice/confirm', { finding_id: f.id, fingerprint: '0000000000000000' });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error).toBe('Your numbers changed since this was suggested. Refresh to see the current suggestion.');
    const gone = await post('/advice/confirm', { finding_id: 'nope', fingerprint: f.proposal.fingerprint });
    expect(gone.status).toBe(409);
    expect(gone.body.error).toBe('That suggestion no longer applies.');
    expect(await contribution()).toBe(100);
  });

  it('confirm applies, replays 409, and undo restores', async () => {
    const f = await finding();
    const ok = await post('/advice/confirm', { finding_id: f.id, fingerprint: f.proposal.fingerprint });
    expect(ok.status).toBe(200);
    expect(ok.body.applied).toMatchObject({
      action: 'update_goal_contribution', entity_type: 'goal', entity_id: goalId, title: f.proposal.title,
    });
    expect(await contribution()).toBe(f.proposal.params.monthly_contribution);

    const replay = await post('/advice/confirm', { finding_id: f.id, fingerprint: f.proposal.fingerprint });
    expect(replay.status).toBe(409);

    const undo = await post('/advice/undo', { activity_log_id: ok.body.applied.activity_log_id });
    expect(undo).toMatchObject({ status: 200, body: { ok: true } });
    expect(await contribution()).toBe(100);

    const again = await post('/advice/undo', { activity_log_id: ok.body.applied.activity_log_id });
    expect(again.status).toBe(409);
    expect((await post('/advice/undo', { activity_log_id: 99999 })).status).toBe(404);
  });

  it('dismiss hides the proposal but keeps the finding', async () => {
    const f = await finding();
    const res = await post('/advice/dismiss', { finding_id: f.id, fingerprint: f.proposal.fingerprint });
    expect(res).toMatchObject({ status: 200, body: { ok: true } });
    const after = await finding();
    expect(after).toBeTruthy();
    expect(after.proposal).toBeUndefined();
    const confirm = await post('/advice/confirm', { finding_id: f.id, fingerprint: f.proposal.fingerprint });
    expect(confirm.status).toBe(409);
  });
});
