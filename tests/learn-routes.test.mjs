// Learn engine routes — mounts the real router on an ephemeral Express
// server against the temp MMM_DATA_DIR from tests/setup.mjs, same pattern as
// tests/plan-routes.test.mjs. Uses the real content/learn tree (read-only).
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';
import routes from '../server/learn/routes.js';
import store from '../server/money/store.js';
import repo from '../server/db/repo.js';
import { db } from '../server/db/connection.js';

let server; let base;

async function get(path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}
async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/learn', routes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/learn`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  store.reset();
});

const LESSON_ID = 'm0-evidence-grades'; // real lesson: 6 steps, check answer 'B', apply_action add_recurring

describe('GET /lessons', () => {
  it('lists all real lessons with not_started status by default', async () => {
    const { status, body } = await get('/lessons');
    expect(status).toBe(200);
    expect(body.lessons.length).toBeGreaterThanOrEqual(15);
    const target = body.lessons.find((l) => l.id === LESSON_ID);
    expect(target).toMatchObject({ status: 'not_started', apply_action: 'add_recurring' });
  });
});

describe('GET /lessons/:id', () => {
  it('404s for an unknown lesson', async () => {
    const { status } = await get('/lessons/does-not-exist');
    expect(status).toBe(404);
  });

  it('renders steps and never leaks the check answer key or rationale', async () => {
    const { status, body } = await get(`/lessons/${LESSON_ID}`);
    expect(status).toBe(200);
    expect(body.steps).toHaveLength(6);
    const check = body.steps.find((s) => s.type === 'check');
    expect(check.question).toContain('grade C');
    expect(check.options.map((o) => o.key)).toEqual(['A', 'B', 'C']);
    expect(check.correctAnswer).toBeUndefined();
    expect(check.rationale).toBeUndefined();
  });

  it('renders {{variable}} tags in read/worked steps against live data', async () => {
    const { body } = await get(`/lessons/${LESSON_ID}`);
    const readStep = body.steps.find((s) => s.type === 'read');
    expect(readStep.body).not.toContain('{{');
    expect(readStep.body).toMatch(/\d/); // runway_days.formatted rendered in
  });

  it('resolves a CC BY-SA Wikipedia source for m2-fixed-vs-variable', async () => {
    const { status, body } = await get('/lessons/m2-fixed-vs-variable');
    expect(status).toBe(200);
    expect(body.source_id).toBe('wikipedia-fixed-variable-costs');
    expect(body.source.license).toBe('CC BY-SA 4.0');
    expect(body.source.url.startsWith('https://')).toBe(true);
    expect(body.source.license_url).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
  });

  it('resolves the original-mmm source for an in-house lesson', async () => {
    const { body } = await get(`/lessons/${LESSON_ID}`);
    expect(body.source_id).toBe('original-mmm');
    expect(body.source.id).toBe('original-mmm');
  });
});

describe('full lesson-completion flow', () => {
  it('walks all 6 steps and marks the lesson completed with a score', async () => {
    await post(`/lessons/${LESSON_ID}/steps/0`, { status: 'skipped' });
    await post(`/lessons/${LESSON_ID}/steps/1`, { status: 'skipped' });
    await post(`/lessons/${LESSON_ID}/steps/2`, { status: 'skipped' });

    const wrong = await post(`/lessons/${LESSON_ID}/check`, { stepIndex: 3, selectedKey: 'A' });
    expect(wrong.status).toBe(200);
    expect(wrong.body.correct).toBe(false);
    expect(wrong.body.correctAnswer).toBe('B');
    expect(wrong.body.card).toBeTruthy(); // FSRS card created on a wrong answer

    const right = await post(`/lessons/${LESSON_ID}/check`, { stepIndex: 3, selectedKey: 'B' });
    expect(right.body.correct).toBe(true);

    const applied = await post(`/lessons/${LESSON_ID}/apply`, {
      params: { payee: 'Netflix', amount: 15.99, cadence: 'monthly', kind: 'bill' },
    });
    expect(applied.status).toBe(200);
    expect(applied.body.applied.action).toBe('add_recurring');
    expect(store.getDeclaredRecurring().some((r) => r.payee === 'Netflix')).toBe(true);

    const final = await post(`/lessons/${LESSON_ID}/steps/5`, { status: 'skipped' });
    expect(final.body.lessonProgress.status).toBe('completed');
    expect(final.body.lessonProgress.score_pct).toBe(100); // check step's final answer was correct

    const list = await get('/lessons');
    expect(list.body.lessons.find((l) => l.id === LESSON_ID)).toMatchObject({ status: 'completed', apply_action_done: true });
  });

  it('rejects a check post for a non-check stepIndex', async () => {
    const { status } = await post(`/lessons/${LESSON_ID}/check`, { stepIndex: 0, selectedKey: 'A' });
    expect(status).toBe(400);
  });

  // I4: the generic step endpoint records a step's status verbatim from the
  // client, with none of /check's server-side answer lookup — a client
  // could otherwise POST status:'correct' straight at a check step's index
  // and mark it correct without ever answering it.
  it('rejects a generic step post for a check-step stepIndex, and never records it', async () => {
    const { status, body } = await post(`/lessons/${LESSON_ID}/steps/3`, { status: 'correct' });
    expect(status).toBe(400);
    expect(body.error).toMatch(/check step/i);
    const rows = repo.getLearnStepProgress(db(), LESSON_ID);
    expect(rows.find((r) => r.step_index === 3)).toBeUndefined();
  });
});

describe('apply-action undo via routes', () => {
  it('undoes a create_rule-style apply action end to end', async () => {
    // m0-orientation's other gated lesson uses a different action; reuse add_recurring here for simplicity.
    const applied = await post(`/lessons/${LESSON_ID}/apply`, {
      params: { payee: 'Gym', amount: 40, cadence: 'monthly', kind: 'bill' },
    });
    const id = applied.body.applied.id;
    expect(store.getDeclaredRecurring().some((r) => r.payee === 'Gym')).toBe(true);

    const undone = await post(`/apply/${id}/undo`);
    expect(undone.status).toBe(200);
    expect(store.getDeclaredRecurring().some((r) => r.payee === 'Gym')).toBe(false);
  });

  it('404s undoing an unknown applied action', async () => {
    const { status } = await post('/apply/nope/undo');
    expect(status).toBe(404);
  });
});

describe('GET /review/session + grading', () => {
  it('surfaces a due card with its rendered question and grades it', async () => {
    await post(`/lessons/${LESSON_ID}/check`, { stepIndex: 3, selectedKey: 'A' }); // wrong -> creates a card
    const card = repo.getLearnCardByStep(db(), LESSON_ID, 3);
    // Force it due now (real scheduling would put it a few minutes out).
    repo.upsertLearnCard(db(), { id: card.id, lesson_id: card.lesson_id, step_index: card.step_index, due: new Date().toISOString() });

    const session = await get('/review/session');
    expect(session.status).toBe(200);
    const found = session.body.cards.find((c) => c.id === card.id);
    expect(found).toBeTruthy();
    expect(found.question).toContain('grade C');

    const graded = await post(`/review/${card.id}/grade`, { answer: 'good' });
    expect(graded.status).toBe(200);
    expect(graded.body.review.rating).toBe(3); // Rating.Good
  });

  it('400s grading without an answer, 404s an unknown card', async () => {
    const missing = await post('/review/whatever/grade', {});
    expect(missing.status).toBe(400);
    const unknown = await post('/review/nope/grade', { answer: 'good' });
    expect(unknown.status).toBe(404);
  });
});

describe('C1 — Learn variables agree with the app\'s own runway computation', () => {
  it('computes runway_days from detected (not just declared) recurring, matching store.getRunway()', async () => {
    const acc = store.createAccount('Checking', 'checking', 5000);
    const ymd = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    // Rent posted twice, ~monthly cadence, but BOTH postings are older than the
    // 90-day actual-spend window runway.js scores burn from — so there is zero
    // "actual" spend in-window, and the only way to see this bill at all is by
    // running store.detectRecurring() over full transaction history (as every
    // other money route does) rather than reading declared-only recurring
    // (store.readData().recurring, which is empty here — never manually
    // declared). Declared-only would score this 'unknown'/sample; detection
    // should score it a real (non-sample) recurring-driven runway.
    store.createTransaction(acc.id, ymd(170), -1800, 'Landlord LLC');
    store.createTransaction(acc.id, ymd(200), -1800, 'Landlord LLC');

    const appRunway = store.getRunway();
    expect(appRunway.burnSource).toBe('recurring'); // sanity: only visible via detection
    const { body } = await get(`/lessons/${LESSON_ID}`);

    expect(body.variables.runway_days.sample).toBe(false);
    expect(body.variables.runway_days.value).toBe(appRunway.daysLeft);
    expect(body.variables.runway_days.formatted).toBe(`${appRunway.daysLeft} days`);
    // Sanity: declared-only recurring is empty, so this genuinely exercises detection.
    expect(store.getDeclaredRecurring()).toHaveLength(0);
  });
});

describe('streak / settings / sync', () => {
  it('GET /streak returns the singleton row', async () => {
    const { status, body } = await get('/streak');
    expect(status).toBe(200);
    expect(body).toHaveProperty('current_streak');
  });

  it('GET and PUT /settings round-trip', async () => {
    const before = await get('/settings');
    expect(before.body.daily_card_cap).toBe(20);
    const res = await fetch(`${base}/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ daily_card_cap: 10 }),
    });
    expect((await res.json()).daily_card_cap).toBe(10);
  });

  it('POST /sync is idempotent against the real content tree', async () => {
    const first = await post('/sync');
    expect(first.body.synced).toBeGreaterThanOrEqual(15);
    expect(first.body.changed).toBe(first.body.synced);

    const second = await post('/sync');
    expect(second.body.changed).toBe(0);
  });
});
