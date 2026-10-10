'use strict';

// Apply-action registry for the Learn engine (Sprint D, Track 1). Every
// action here turns a lesson's ":::apply" step into a REAL write against the
// user's own data — always through the existing request validators
// (server/middleware/validators.js) and store functions
// (server/money/store.js), NEVER direct SQL. Every write is recorded in
// learn_applied_actions plus a generic activity_log row (before/after JSON
// snapshots), so it can be undone later.
//
// Six lesson actions ship (the spec's other four — set_target_allocation,
// open_paper_trade, log_prediction, schedule_review — are cut for this
// track, per real lesson content's apply_action values, all within this
// set): create_goal, set_category_budget, add_recurring, enable_rollover,
// create_rule, export_backup. update_goal_contribution is the coach's (source
// "coach", no lesson), so the coach has no write path the forms lack.
//
// Dependency injection: applyAction/undoAction take { repo, d, store,
// validators, backup } explicitly rather than require()-ing server/db/
// connection.js, server/money/store.js's live db(), or server/backup/
// scheduler.js themselves — same separation used by content.js/progress.js,
// and it lets tests supply an in-memory store double instead of ever
// touching the real dev DB or the real filesystem backup directory.

function fail(errors) {
  const err = new Error(errors.join('; '));
  err.validationErrors = errors;
  throw err;
}

function findById(list, id) {
  return list.find((x) => String(x.id) === String(id)) || null;
}

const ACTIONS = {
  create_goal: {
    apply(ctx, params) {
      const { valid, errors } = ctx.validators.validateGoal(params);
      if (!valid) fail(errors);
      const created = ctx.store.createGoal(
        params.name, params.target, params.current, params.linked_account_id || null,
        params.target_date || null, params.template || null, params.monthly_contribution || null, params.custom || {},
      );
      return { entity_type: 'goal', entity_id: created.id, before: null, after: created };
    },
    undo(ctx, entry) {
      ctx.store.deleteGoal(entry.entity_id);
    },
  },

  set_category_budget: {
    // params.id is optional: if it names an existing budget, this updates it
    // (and captures its prior state for undo); otherwise it creates a new
    // budget for params.category_id.
    apply(ctx, params) {
      const { valid, errors } = ctx.validators.validateBudget(params);
      if (!valid) fail(errors);
      const before = params.id ? findById(ctx.store.getBudgets(), params.id) : null;
      const after = before
        ? ctx.store.updateBudget(before.id, { period: params.period, limit: params.limit, rollover: params.rollover })
        : ctx.store.createBudget(params.category_id, params.period, params.limit, params.rollover);
      return { entity_type: 'budget', entity_id: after.id, before, after };
    },
    undo(ctx, entry) {
      if (entry.before) ctx.store.updateBudget(entry.entity_id, entry.before);
      else ctx.store.deleteBudget(entry.entity_id);
    },
  },

  add_recurring: {
    apply(ctx, params) {
      const { valid, errors } = ctx.validators.validateRecurring(params);
      if (!valid) fail(errors);
      const created = ctx.store.createRecurring(params);
      return { entity_type: 'recurring', entity_id: created.id, before: null, after: created };
    },
    undo(ctx, entry) {
      ctx.store.deleteRecurring(entry.entity_id);
    },
  },

  enable_rollover: {
    // Turns rollover on for an EXISTING budget (params.budget_id). Does not
    // create a budget — pair with set_category_budget first if none exists.
    apply(ctx, params) {
      const before = findById(ctx.store.getBudgets(), params.budget_id);
      if (!before) fail([`budget ${params.budget_id} not found`]);
      const after = ctx.store.updateBudget(before.id, { rollover: true });
      return { entity_type: 'budget', entity_id: after.id, before, after };
    },
    undo(ctx, entry) {
      ctx.store.updateBudget(entry.entity_id, { rollover: entry.before ? !!entry.before.rollover : false });
    },
  },

  create_rule: {
    apply(ctx, params) {
      const { valid, errors } = ctx.validators.validateRule(params);
      if (!valid) fail(errors);
      const created = ctx.store.createRule(params.match, params.category_id, params.tag || null);
      return { entity_type: 'rule', entity_id: created.id, before: null, after: created };
    },
    undo(ctx, entry) {
      ctx.store.deleteRule(entry.entity_id);
    },
  },

  update_goal_contribution: {
    // Coach-only: raises/lowers a goal's monthly contribution. A plan change,
    // not a money movement.
    apply(ctx, params) {
      const goal = findById(ctx.store.getGoals(), params.goal_id);
      const c = params.monthly_contribution;
      const errors = [];
      if (!goal) errors.push(`goal ${params.goal_id} not found`);
      if (typeof c !== 'number' || !Number.isFinite(c) || c < 0) errors.push('monthly_contribution must be a number >= 0');
      if (errors.length) fail(errors);
      const before = { monthly_contribution: goal.monthly_contribution };
      ctx.store.updateGoal(goal.id, { monthly_contribution: c });
      return { entity_type: 'goal', entity_id: goal.id, before, after: { monthly_contribution: c } };
    },
    undo(ctx, entry) {
      ctx.store.updateGoal(entry.entity_id, entry.before);
    },
  },

  export_backup: {
    // One-way: a backup snapshot isn't a mutation of live data, so there's
    // nothing meaningful to revert. undo() rejects explicitly rather than
    // silently no-op-ing, so a caller never mistakes it for having worked.
    async apply(ctx) {
      const result = await ctx.backup.runBackup({ force: true });
      return { entity_type: 'backup', entity_id: result.date, before: null, after: result };
    },
    undo() {
      throw new Error('export_backup cannot be undone');
    },
  },
};

const ACTION_NAMES = Object.keys(ACTIONS);

// Bookkeeping shared by both branches below: one activity_log row, plus one
// learn_applied_actions row unless another source (the coach) drove the write.
function recordApplied(repo, d, { lessonId, source }, action, params, result) {
  const activity = repo.createActivityLogEntry(d, {
    source,
    action,
    entity_type: result.entity_type,
    entity_id: String(result.entity_id),
    before: result.before,
    after: result.after,
  });

  if (source !== 'learn') {
    return {
      action, params, entity_type: result.entity_type, entity_id: String(result.entity_id), activity_log_id: activity.id,
    };
  }

  return repo.createLearnAppliedAction(d, {
    lesson_id: lessonId,
    action,
    params,
    entity_type: result.entity_type,
    entity_id: String(result.entity_id),
    activity_log_id: activity.id,
  });
}

async function applyAction({ repo, d, store, validators, backup, lessonId = null, source = 'learn', action, params = {} }) {
  const def = ACTIONS[action];
  if (!def) throw new Error(`Unknown apply action: ${action}`);

  const ctx = { store, validators, backup };

  // export_backup's apply() awaits filesystem I/O (backup.runBackup) rather
  // than writing through `d` — better-sqlite3 transactions must be a plain
  // synchronous function, so an async apply() can't be inside the
  // transaction boundary. Every other action's apply() is synchronous and
  // writes through the same `d` connection ctx.store uses internally
  // (server/db/connection.js's db() singleton), so the store write and both
  // bookkeeping inserts are wrapped in one transaction: previously a throw
  // between the store write and either insert could leave a real
  // goal/budget/recurring/rule created with no activity_log or
  // learn_applied_actions record of it — an untracked financial record.
  if (def.apply.constructor.name === 'AsyncFunction') {
    const result = await def.apply(ctx, params);
    const run = d.transaction(() => recordApplied(repo, d, { lessonId, source }, action, params, result));
    return run();
  }

  const run = d.transaction(() => {
    const result = def.apply(ctx, params);
    return recordApplied(repo, d, { lessonId, source }, action, params, result);
  });
  return run();
}

async function undoActivity({ repo, d, store, validators, backup, activityLogId }) {
  const activity = repo.getActivityLogEntry(d, activityLogId);
  if (!activity) throw new Error('Applied action not found');
  if (activity.undone_at) throw new Error('Already undone');

  const def = ACTIONS[activity.action];
  if (!def) throw new Error(`Unknown apply action: ${activity.action}`);

  await def.undo({ store, validators, backup }, { entity_id: activity.entity_id, before: activity.before });
  return repo.markActivityLogUndone(d, activity.id, new Date().toISOString());
}

async function undoAction(ctx) {
  const { repo, d, appliedActionId } = ctx;
  const applied = repo.getLearnAppliedAction(d, appliedActionId);
  if (!applied) throw new Error('Applied action not found');
  if (applied.undone_at) throw new Error('Applied action already undone');

  await undoActivity({ ...ctx, activityLogId: applied.activity_log_id });
  return repo.markLearnAppliedActionUndone(d, applied.id, new Date().toISOString());
}

module.exports = { ACTION_NAMES, applyAction, undoAction, undoActivity };
