// Learn engine apply-action registry — real SQLite (temp DB from
// tests/setup.mjs) + the real store/validators modules, so every write goes
// through the same code path production would use. `backup` is faked to
// avoid touching the real filesystem backup directory in a unit test.
import { describe, it, expect, beforeEach } from 'vitest';
import store from '../server/money/store.js';
import repo from '../server/db/repo.js';
import { db as getDb } from '../server/db/connection.js';
import validators from '../server/middleware/validators.js';
import { ACTION_NAMES, applyAction, undoAction } from '../server/learn/apply.js';

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
  it('ships exactly the 6 non-cut actions', () => {
    expect(ACTION_NAMES.sort()).toEqual([
      'add_recurring', 'create_goal', 'create_rule', 'enable_rollover', 'export_backup', 'set_category_budget',
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
