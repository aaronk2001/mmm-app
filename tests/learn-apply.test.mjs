// Learn engine apply-action registry — real SQLite (temp DB from
// tests/setup.mjs) + the real store/validators modules, so every write goes
// through the same code path production would use. `backup` is faked to
// avoid touching the real filesystem backup directory in a unit test.
import { describe, it, expect, beforeEach } from 'vitest';
import store from '../server/money/store.js';
import repo from '../server/db/repo.js';
import { db as getDb } from '../server/db/connection.js';
import validators from '../server/middleware/validators.js';
import { ACTION_NAMES, applyAction, undoAction, undoActivity } from '../server/learn/apply.js';

let db;
beforeEach(() => {
  store.reset();
  db = getDb();
});

function fakeBackup(overrides = {}) {
  return { runBackup: async () => ({ date: '2026-09-18', jsonPath: 'x.json', dbPath: 'x.db' }), ...overrides };
}

function ctx(extra = {}) {
  return { repo, d: db, store, validators, backup: fakeBackup(), ...extra };
}

describe('learn/apply — registry shape', () => {
  it('ships exactly the 6 non-cut actions plus the coach contribution action', () => {
    expect(ACTION_NAMES.sort()).toEqual([
      'add_recurring', 'create_goal', 'create_rule', 'enable_rollover', 'export_backup', 'set_category_budget',
      'update_goal_contribution',
    ]);
  });

  it('rejects an unknown action', async () => {
    await expect(applyAction(ctx({ action: 'set_target_allocation', params: {} }))).rejects.toThrow(/Unknown apply action/);
  });
});

describe('learn/apply — create_goal', () => {
  it('validates, writes a real goal, and records an applied action + activity log entry', async () => {
    const applied = await applyAction(ctx({
      lessonId: 'les1', action: 'create_goal',
      params: { name: 'Emergency fund', target: 5000, current: 100 },
    }));
    expect(applied.action).toBe('create_goal');
    expect(applied.lesson_id).toBe('les1');
    const goal = store.getGoals().find((g) => g.id === applied.entity_id);
    expect(goal).toMatchObject({ name: 'Emergency fund', target: 5000, current: 100 });

    const activity = repo.getActivityLogEntry(db, applied.activity_log_id);
    expect(activity.before).toBeNull();
    expect(activity.after).toMatchObject({ name: 'Emergency fund' });
  });

  it('rejects invalid params without writing anything', async () => {
    await expect(applyAction(ctx({ action: 'create_goal', params: { name: '' } }))).rejects.toThrow();
    expect(store.getGoals()).toHaveLength(0);
  });

  it('undo deletes the created goal', async () => {
    const applied = await applyAction(ctx({ action: 'create_goal', params: { name: 'Trip', target: 1000 } }));
    await undoAction(ctx({ appliedActionId: applied.id }));
    expect(store.getGoals()).toHaveLength(0);
    expect(repo.getLearnAppliedAction(db, applied.id).undone_at).not.toBeNull();
  });
});

describe('learn/apply — set_category_budget', () => {
  it('creates a new budget when none exists yet', async () => {
    const applied = await applyAction(ctx({
      action: 'set_category_budget',
      params: { category_id: 'fod', period: 'monthly', limit: 400 },
    }));
    const budget = store.getBudgets().find((b) => b.id === applied.entity_id);
    expect(budget).toMatchObject({ category_id: 'fod', period: 'monthly', limit: 400 });
  });

  it('updates an existing budget and captures its prior state for undo', async () => {
    const created = store.createBudget('fod', 'monthly', 400, false);
    const applied = await applyAction(ctx({
      action: 'set_category_budget',
      params: { id: created.id, category_id: 'fod', period: 'monthly', limit: 600 },
    }));
    expect(store.getBudgets().find((b) => b.id === created.id).limit).toBe(600);

    await undoAction(ctx({ appliedActionId: applied.id }));
    expect(store.getBudgets().find((b) => b.id === created.id).limit).toBe(400);
  });

  it('undo deletes a newly-created budget (no prior state)', async () => {
    const applied = await applyAction(ctx({ action: 'set_category_budget', params: { category_id: 'fod', period: 'monthly', limit: 400 } }));
    await undoAction(ctx({ appliedActionId: applied.id }));
    expect(store.getBudgets()).toHaveLength(0);
  });
});

describe('learn/apply — add_recurring', () => {
  it('writes a new recurring item and undo deletes it', async () => {
    const applied = await applyAction(ctx({
      action: 'add_recurring',
      params: { payee: 'Rent', amount: 1500, cadence: 'monthly', kind: 'bill' },
    }));
    expect(store.getDeclaredRecurring().find((r) => r.id === applied.entity_id)).toMatchObject({ payee: 'Rent', amount: 1500 });

    await undoAction(ctx({ appliedActionId: applied.id }));
    expect(store.getDeclaredRecurring()).toHaveLength(0);
  });

  it('rejects an invalid cadence', async () => {
    await expect(applyAction(ctx({ action: 'add_recurring', params: { payee: 'Rent', amount: 1500, cadence: 'daily', kind: 'bill' } }))).rejects.toThrow();
  });
});

describe('learn/apply — enable_rollover', () => {
  it('flips rollover on for an existing budget and undo reverts it', async () => {
    const created = store.createBudget('fod', 'monthly', 400, false);
    const applied = await applyAction(ctx({ action: 'enable_rollover', params: { budget_id: created.id } }));
    expect(store.getBudgets().find((b) => b.id === created.id).rollover).toBe(true);

    await undoAction(ctx({ appliedActionId: applied.id }));
    expect(store.getBudgets().find((b) => b.id === created.id).rollover).toBe(false);
  });

  it('fails for an unknown budget id', async () => {
    await expect(applyAction(ctx({ action: 'enable_rollover', params: { budget_id: 'nope' } }))).rejects.toThrow(/not found/);
  });
});

describe('learn/apply — create_rule', () => {
  it('writes a new rule and undo deletes it', async () => {
    const applied = await applyAction(ctx({ action: 'create_rule', params: { match: 'Starbucks', category_id: 'din' } }));
    expect(store.getRules().find((r) => r.id === applied.entity_id)).toMatchObject({ match: 'Starbucks', category_id: 'din' });
    await undoAction(ctx({ appliedActionId: applied.id }));
    expect(store.getRules()).toHaveLength(0);
  });
});

describe('learn/apply — export_backup', () => {
  it('calls the injected backup module and records the result; undo rejects', async () => {
    const applied = await applyAction(ctx({ action: 'export_backup', params: {} }));
    expect(applied.entity_type).toBe('backup');
    expect(applied.entity_id).toBe('2026-09-18');
    await expect(undoAction(ctx({ appliedActionId: applied.id }))).rejects.toThrow(/cannot be undone/);
  });
});

// Production's ctx.store (server/money/store.js) and the `d` routes.js
// passes into applyAction both resolve the SAME require('../db/connection')
// singleton — everything there is plain CommonJS sharing one require cache.
// This test file, being ESM (.mjs), gets store.js and connection.js through
// two different module graphs (vitest's ESM loader vs. store.js's own
// internal require()), which — unlike production — can hand back two
// distinct Database objects for the same file. A double that writes through
// the exact `d` under test (mirroring how ctx.store really behaves in
// production) verifies the transaction boundary itself without tripping
// over that test-harness-only artifact.
function sharedDbStore(d) {
  return {
    createGoal: (name, target, current, linked_account_id, target_date, template, monthly_contribution, custom) =>
      repo.createGoal(d, { name, target, current, linked_account_id, target_date, template, monthly_contribution, custom }),
    createRule: (match, category_id, tag) => repo.createRule(d, { match, category_id, tag }),
    getGoals: () => repo.getGoals(d),
    getRules: () => repo.getRules(d),
  };
}

describe('learn/apply — transactional apply (I3)', () => {
  // A partial failure between the store write and the bookkeeping inserts
  // used to leave a real entity created with no activity_log or
  // learn_applied_actions row pointing at it — an untracked financial
  // record. applyAction now wraps the store write + both inserts in one
  // d.transaction(), so an injected failure in the second insert must roll
  // back the store write too.
  it('rolls back the store write if the learn_applied_actions insert fails', async () => {
    const failingRepo = { ...repo, createLearnAppliedAction: () => { throw new Error('boom'); } };
    const sharedStore = sharedDbStore(db);
    await expect(applyAction(ctx({ repo: failingRepo, store: sharedStore, action: 'create_goal', params: { name: 'Trip', target: 1000 } }))).rejects.toThrow('boom');
    expect(sharedStore.getGoals()).toHaveLength(0);
  });

  it('rolls back the store write if the activity_log insert fails', async () => {
    const failingRepo = { ...repo, createActivityLogEntry: () => { throw new Error('boom'); } };
    const sharedStore = sharedDbStore(db);
    await expect(applyAction(ctx({ repo: failingRepo, store: sharedStore, action: 'create_rule', params: { match: 'Starbucks', category_id: 'din' } }))).rejects.toThrow('boom');
    expect(sharedStore.getRules()).toHaveLength(0);
  });

  it('does not roll back a completed export_backup on a later bookkeeping failure (async apply cannot share the transaction)', async () => {
    // export_backup's apply() is async filesystem I/O outside `d`, so it
    // runs before the transaction opens — this documents that boundary
    // rather than asserting rollback of the backup itself.
    const failingRepo = { ...repo, createLearnAppliedAction: () => { throw new Error('boom'); } };
    let ran = false;
    const backup = { runBackup: async () => { ran = true; return { date: '2026-09-18' }; } };
    await expect(applyAction(ctx({ repo: failingRepo, backup, action: 'export_backup', params: {} }))).rejects.toThrow('boom');
    expect(ran).toBe(true);
  });
});

describe('learn/apply — undoAction edge cases', () => {
  it('throws for an unknown applied-action id', async () => {
    await expect(undoAction(ctx({ appliedActionId: 'nope' }))).rejects.toThrow(/not found/);
  });

  it('throws when undoing twice', async () => {
    const applied = await applyAction(ctx({ action: 'create_rule', params: { match: 'X', category_id: 'din' } }));
    await undoAction(ctx({ appliedActionId: applied.id }));
    await expect(undoAction(ctx({ appliedActionId: applied.id }))).rejects.toThrow(/already undone/);
  });
});

describe('learn/apply — update_goal_contribution', () => {
  const seedGoal = () => store.createGoal('Trip', 5000, 0, null, '2027-06-01', null, 100);

  it('changes the contribution and undo restores it', async () => {
    const goal = seedGoal();
    const applied = await applyAction(ctx({
      source: 'coach', action: 'update_goal_contribution', params: { goal_id: goal.id, monthly_contribution: 450 },
    }));
    expect(applied).toMatchObject({ entity_type: 'goal', entity_id: goal.id });
    expect(store.getGoals().find((g) => g.id === goal.id).monthly_contribution).toBe(450);
    const entry = repo.getActivityLogEntry(db, applied.activity_log_id);
    expect(entry.before).toEqual({ monthly_contribution: 100 });
    expect(entry.after).toEqual({ monthly_contribution: 450 });

    await undoActivity(ctx({ activityLogId: applied.activity_log_id }));
    expect(store.getGoals().find((g) => g.id === goal.id).monthly_contribution).toBe(100);
  });

  it('rejects an unknown goal', async () => {
    const err = await applyAction(ctx({
      action: 'update_goal_contribution', params: { goal_id: 'nope', monthly_contribution: 50 },
    })).catch((e) => e);
    expect(err.validationErrors).toHaveLength(1);
  });

  it.each([-1, 'abc', null, Infinity])('rejects monthly_contribution %s without writing', async (bad) => {
    const goal = seedGoal();
    const err = await applyAction(ctx({
      action: 'update_goal_contribution', params: { goal_id: goal.id, monthly_contribution: bad },
    })).catch((e) => e);
    expect(err.validationErrors).toHaveLength(1);
    expect(store.getGoals().find((g) => g.id === goal.id).monthly_contribution).toBe(100);
    expect(repo.getAllActivityLog(db)).toHaveLength(0);
  });
});

describe('learn/apply — coach source without a lesson', () => {
  it('writes an activity_log row with the given source and no learn_applied_actions row', async () => {
    const applied = await applyAction(ctx({
      source: 'coach', action: 'create_goal', params: { name: 'Emergency fund', target: 9000, current: 100 },
    }));
    expect(applied.activity_log_id).toBeTruthy();
    expect(repo.getActivityLogEntry(db, applied.activity_log_id)).toMatchObject({ source: 'coach', action: 'create_goal' });
    expect(repo.getAllLearnAppliedActions(db)).toHaveLength(0);
  });

  it('keeps writing source "learn" and a learn_applied_actions row for lesson callers', async () => {
    const applied = await applyAction(ctx({ lessonId: 'les1', action: 'create_goal', params: { name: 'Trip', target: 1000 } }));
    expect(repo.getActivityLogEntry(db, applied.activity_log_id).source).toBe('learn');
    expect(repo.getAllLearnAppliedActions(db)).toHaveLength(1);
  });
});

describe('learn/apply — undoActivity', () => {
  it('undoes once, then refuses', async () => {
    const applied = await applyAction(ctx({ source: 'coach', action: 'create_goal', params: { name: 'Trip', target: 1000 } }));
    await undoActivity(ctx({ activityLogId: applied.activity_log_id }));
    expect(store.getGoals()).toHaveLength(0);
    expect(repo.getActivityLogEntry(db, applied.activity_log_id).undone_at).toBeTruthy();
    await expect(undoActivity(ctx({ activityLogId: applied.activity_log_id }))).rejects.toThrow('Already undone');
  });

  it('throws for a missing entry', async () => {
    await expect(undoActivity(ctx({ activityLogId: 99999 }))).rejects.toThrow('Applied action not found');
  });
});
