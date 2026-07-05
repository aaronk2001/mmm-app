'use strict';

const crypto = require('crypto');

// Repository v2 — per-row prepared statements over the cents-based schema.
// Money is INTEGER cents in SQLite; this layer converts to float dollars at its
// boundary, so store.js / routes / UI keep the dollar shapes they always had.
// Account balances are DERIVED: opening_balance_cents + SUM(transactions).
// readAll/writeAll remain only for export / import / seed / reset.

const toCents = (v) => Math.round((parseFloat(v) || 0) * 100);
const toDollars = (c) => (c == null ? null : Math.round(c) / 100);

function newId() {
  return crypto.randomUUID();
}

function defaultCategories() {
  return [
    { id: 'inc', name: 'Income', group: 'income', color: '#10b981', icon: 'plus' },
    { id: 'hou', name: 'Housing', group: 'expenses', color: '#f59e0b', icon: 'home' },
    { id: 'fod', name: 'Food & Dining', group: 'expenses', color: '#ef4444', icon: 'utensils' },
    { id: 'tra', name: 'Transportation', group: 'expenses', color: '#3b82f6', icon: 'car' },
    { id: 'sho', name: 'Shopping', group: 'expenses', color: '#8b5cf6', icon: 'bag' },
    { id: 'uti', name: 'Utilities', group: 'expenses', color: '#ec4899', icon: 'zap' },
    { id: 'ent', name: 'Entertainment', group: 'expenses', color: '#06b6d4', icon: 'film' },
    { id: 'hea', name: 'Health', group: 'expenses', color: '#06b6d4', icon: 'heart' },
    { id: 'sav', name: 'Savings', group: 'transfers', color: '#14b8a6', icon: 'piggy-bank' },
    { id: 'sub', name: 'Subscriptions', group: 'expenses', color: '#a78bfa', icon: 'layers' },
    { id: 'oth', name: 'Other', group: 'expenses', color: '#6b7280', icon: 'circle' },
  ];
}

function emptyData() {
  return {
    accounts: [],
    transactions: [],
    categories: defaultCategories(),
    budgets: [],
    goals: [],
    rules: [],
    holdings: [],
    networth_snapshots: [],
    recurring: [],
  };
}

function safeJson(s, fallback) {
  if (s != null && typeof s === 'object') return s;
  try { const v = JSON.parse(s); return v == null ? fallback : v; } catch { return fallback; }
}
const jsonText = (v, fallback) => JSON.stringify(v != null && typeof v === 'object' ? v : fallback);

// ── row deserializers (DB row -> JS dollar shape) ────────────────────────────

const rowAccount = (r) => ({
  id: r.id, name: r.name, type: r.type,
  balance: toDollars(r.balance_cents),
  institution: r.institution, currency: r.currency, status: r.status,
  created_at: r.created_at, custom: safeJson(r.custom, {}),
});
const rowTxn = (r) => ({
  id: r.id, account_id: r.account_id, date: r.date,
  amount: toDollars(r.amount_cents),
  payee: r.payee, category_id: r.category_id,
  tags: safeJson(r.tags, []), note: r.note, source: r.source,
  cleared: !!r.cleared, custom: safeJson(r.custom, {}),
});
const rowBudget = (r) => ({ id: r.id, category_id: r.category_id, period: r.period, limit: toDollars(r.limit_cents), rollover: !!r.rollover });
const rowGoal = (r) => ({
  id: r.id, name: r.name,
  target: toDollars(r.target_cents), current: toDollars(r.current_cents),
  linked_account_id: r.linked_account_id, target_date: r.target_date, template: r.template,
  monthly_contribution: toDollars(r.monthly_contribution_cents),
  custom: safeJson(r.custom, {}),
});
const rowRule = (r) => ({ id: r.id, match: r.match, category_id: r.category_id, tag: r.tag });
const rowHolding = (r) => ({
  id: r.id, account_id: r.account_id, symbol: r.symbol, shares: r.shares,
  cost_basis: toDollars(r.cost_basis_cents), current_price: toDollars(r.current_price_cents),
  price_source: r.price_source, updated_at: r.updated_at,
});
const rowSnapshot = (r) => ({ date: r.date, assets: toDollars(r.assets_cents), liabilities: toDollars(r.liabilities_cents), net: toDollars(r.net_cents) });
const rowRecurring = (r) => ({ id: r.id, payee: r.payee, amount: toDollars(r.amount_cents), cadence: r.cadence, kind: r.kind, next_date: r.next_date, note: r.note });

// Derived balance: opening + sum of the account's transactions, in cents.
const ACCOUNT_SELECT = `
  SELECT a.*, (a.opening_balance_cents + COALESCE(
    (SELECT SUM(t.amount_cents) FROM transactions t WHERE t.account_id = a.id), 0
  )) AS balance_cents
  FROM accounts a`;

function txnSumCents(d, accountId) {
  const r = d.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM transactions WHERE account_id = ?').get(accountId);
  return r.s;
}

// ── accounts ──────────────────────────────────────────────────────────────────

function getAccounts(d) {
  return d.prepare(ACCOUNT_SELECT).all().map(rowAccount);
}
function getAccount(d, id) {
  const r = d.prepare(ACCOUNT_SELECT + ' WHERE a.id = ?').get(id);
  return r ? rowAccount(r) : null;
}
function createAccount(d, a) {
  const id = a.id || newId();
  d.prepare('INSERT INTO accounts (id, name, type, opening_balance_cents, institution, currency, status, created_at, custom) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, a.name, a.type, toCents(a.balance), a.institution || '', a.currency || 'USD', a.status || 'active', a.created_at || new Date().toISOString(), jsonText(a.custom, {}));
  return getAccount(d, id);
}
function updateAccount(d, id, patch) {
  const existing = getAccount(d, id);
  if (!existing) throw new Error('Account not found');
  const run = d.transaction(() => {
    const sets = [];
    const vals = [];
    for (const k of ['name', 'type', 'institution', 'currency', 'status']) {
      if (patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(patch[k]); }
    }
    if (patch.custom !== undefined) { sets.push('custom = ?'); vals.push(jsonText(patch.custom, {})); }
    if (patch.balance !== undefined) {
      // Balance is derived — editing it adjusts the opening balance so the
      // derived value lands exactly on the requested number.
      sets.push('opening_balance_cents = ?');
      vals.push(toCents(patch.balance) - txnSumCents(d, id));
    }
    if (sets.length) d.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  });
  run();
  return getAccount(d, id);
}
function deleteAccount(d, id) {
  const info = d.prepare('DELETE FROM accounts WHERE id = ?').run(id); // CASCADE removes txns + holdings
  if (!info.changes) throw new Error('Account not found');
}

// ── transactions ──────────────────────────────────────────────────────────────

function getTransactions(d, filters = {}) {
  let sql = 'SELECT * FROM transactions WHERE 1=1';
  const params = [];
  if (filters.account_id) { sql += ' AND account_id = ?'; params.push(filters.account_id); }
  if (filters.category_id) { sql += ' AND category_id = ?'; params.push(filters.category_id); }
  if (filters.from) { sql += ' AND date >= ?'; params.push(filters.from); }
  if (filters.to) { sql += ' AND date <= ?'; params.push(filters.to); }
  sql += ' ORDER BY date DESC, rowid DESC';
  return d.prepare(sql).all(...params).map(rowTxn);
}
function getTransaction(d, id) {
  const r = d.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  return r ? rowTxn(r) : null;
}

const TXN_INSERT = 'INSERT INTO transactions (id, account_id, date, amount_cents, payee, category_id, tags, note, source, cleared, custom) VALUES (?,?,?,?,?,?,?,?,?,?,?)';
function txnInsertArgs(t, id) {
  return [id, t.account_id || null, String(t.date).slice(0, 10), toCents(t.amount), t.payee || '', t.category_id || null,
    jsonText(t.tags, []), t.note || '', t.source || 'manual', t.cleared ? 1 : 0, jsonText(t.custom, {})];
}
function createTransaction(d, t) {
  const id = t.id || newId();
  d.prepare(TXN_INSERT).run(...txnInsertArgs(t, id));
  return getTransaction(d, id);
}
// Bulk insert (imports) — one transaction, returns the inserted rows.
function insertTransactions(d, txns) {
  const stmt = d.prepare(TXN_INSERT);
  const ids = [];
  const run = d.transaction(() => {
    for (const t of txns) {
      const id = t.id || newId();
      stmt.run(...txnInsertArgs(t, id));
      ids.push(id);
    }
  });
  run();
  const getStmt = d.prepare('SELECT * FROM transactions WHERE id = ?');
  return ids.map((id) => rowTxn(getStmt.get(id)));
}
const TXN_PATCH_COLS = {
  account_id: (v) => v,
  date: (v) => String(v).slice(0, 10),
  payee: (v) => v,
  category_id: (v) => v,
  note: (v) => v,
  source: (v) => v,
  cleared: (v) => (v ? 1 : 0),
  tags: (v) => jsonText(v, []),
  custom: (v) => jsonText(v, {}),
};
function txnPatchSql(patch) {
  const sets = [];
  const vals = [];
  for (const [k, fn] of Object.entries(TXN_PATCH_COLS)) {
    if (patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(fn(patch[k])); }
  }
  if (patch.amount !== undefined) { sets.push('amount_cents = ?'); vals.push(toCents(patch.amount)); }
  return { sets, vals };
}
function updateTransaction(d, id, patch) {
  if (!getTransaction(d, id)) throw new Error('Transaction not found');
  const { sets, vals } = txnPatchSql(patch);
  if (sets.length) d.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return getTransaction(d, id);
}
function deleteTransaction(d, id) {
  const info = d.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  if (!info.changes) throw new Error('Transaction not found');
}
function updateTransactionsBulk(d, ids, patch) {
  const { sets, vals } = txnPatchSql(patch);
  if (!sets.length || !ids.length) return 0;
  const stmt = d.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`);
  let count = 0;
  const run = d.transaction(() => {
    for (const id of ids) count += stmt.run(...vals, id).changes;
  });
  run();
  return count;
}
function deleteTransactionsBulk(d, ids) {
  if (!ids.length) return 0;
  const stmt = d.prepare('DELETE FROM transactions WHERE id = ?');
  let count = 0;
  const run = d.transaction(() => {
    for (const id of ids) count += stmt.run(id).changes;
  });
  run();
  return count;
}
// Payees ranked by use with their most frequent category — feeds the quick-add
// autocomplete and category suggestion.
function getPayeeStats(d, limit = 100) {
  return d.prepare(`
    SELECT payee,
           COUNT(*) AS uses,
           MAX(date) AS last_date,
           (SELECT t2.category_id FROM transactions t2
             WHERE t2.payee = t.payee AND t2.category_id IS NOT NULL
             GROUP BY t2.category_id ORDER BY COUNT(*) DESC LIMIT 1) AS category_id
    FROM transactions t
    WHERE payee != ''
    GROUP BY payee
    ORDER BY uses DESC, last_date DESC
    LIMIT ?`).all(limit);
}

// applyRules support: set category per id, atomically.
function setTransactionCategories(d, pairs) {
  const stmt = d.prepare('UPDATE transactions SET category_id = ? WHERE id = ?');
  const run = d.transaction(() => {
    for (const p of pairs) stmt.run(p.category_id, p.id);
  });
  run();
}

// ── categories ────────────────────────────────────────────────────────────────

function getCategories(d) {
  return d.prepare('SELECT * FROM categories').all().map((r) => ({ id: r.id, name: r.name, group: r.group, color: r.color, icon: r.icon }));
}
function createCategory(d, c) {
  const id = c.id || newId();
  d.prepare('INSERT INTO categories (id, name, "group", color, icon) VALUES (?,?,?,?,?)')
    .run(id, c.name, c.group, c.color || '#6b7280', c.icon || 'circle');
  return { id, name: c.name, group: c.group, color: c.color || '#6b7280', icon: c.icon || 'circle' };
}

// ── budgets ───────────────────────────────────────────────────────────────────

function getBudgets(d) {
  return d.prepare('SELECT * FROM budgets').all().map(rowBudget);
}
function createBudget(d, b) {
  const id = b.id || newId();
  d.prepare('INSERT INTO budgets (id, category_id, period, limit_cents, rollover) VALUES (?,?,?,?,?)')
    .run(id, b.category_id, b.period, toCents(b.limit), b.rollover ? 1 : 0);
  return rowBudget(d.prepare('SELECT * FROM budgets WHERE id = ?').get(id));
}
function updateBudget(d, id, patch) {
  const existing = d.prepare('SELECT * FROM budgets WHERE id = ?').get(id);
  if (!existing) throw new Error('Budget not found');
  const sets = [];
  const vals = [];
  for (const k of ['category_id', 'period']) {
    if (patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(patch[k]); }
  }
  if (patch.limit !== undefined) { sets.push('limit_cents = ?'); vals.push(toCents(patch.limit)); }
  if (patch.rollover !== undefined) { sets.push('rollover = ?'); vals.push(patch.rollover ? 1 : 0); }
  if (sets.length) d.prepare(`UPDATE budgets SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return rowBudget(d.prepare('SELECT * FROM budgets WHERE id = ?').get(id));
}
function deleteBudget(d, id) {
  const info = d.prepare('DELETE FROM budgets WHERE id = ?').run(id);
  if (!info.changes) throw new Error('Budget not found');
}

// ── goals ─────────────────────────────────────────────────────────────────────

function getGoals(d) {
  return d.prepare('SELECT * FROM goals').all().map(rowGoal);
}
function createGoal(d, g) {
  const id = g.id || newId();
  d.prepare('INSERT INTO goals (id, name, target_cents, current_cents, linked_account_id, target_date, template, monthly_contribution_cents, custom) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, g.name, toCents(g.target), toCents(g.current), g.linked_account_id || null, g.target_date || null, g.template || null,
      g.monthly_contribution == null ? null : toCents(g.monthly_contribution), jsonText(g.custom, {}));
  return rowGoal(d.prepare('SELECT * FROM goals WHERE id = ?').get(id));
}
function updateGoal(d, id, patch) {
  const existing = d.prepare('SELECT * FROM goals WHERE id = ?').get(id);
  if (!existing) throw new Error('Goal not found');
  const sets = [];
  const vals = [];
  for (const k of ['name', 'linked_account_id', 'target_date', 'template']) {
    if (patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(patch[k]); }
  }
  for (const [k, col] of [['target', 'target_cents'], ['current', 'current_cents'], ['monthly_contribution', 'monthly_contribution_cents']]) {
    if (patch[k] !== undefined) { sets.push(`${col} = ?`); vals.push(patch[k] == null ? null : toCents(patch[k])); }
  }
  if (patch.custom !== undefined) { sets.push('custom = ?'); vals.push(jsonText(patch.custom, {})); }
  if (sets.length) d.prepare(`UPDATE goals SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return rowGoal(d.prepare('SELECT * FROM goals WHERE id = ?').get(id));
}
function deleteGoal(d, id) {
  const info = d.prepare('DELETE FROM goals WHERE id = ?').run(id);
  if (!info.changes) throw new Error('Goal not found');
}

// ── rules ─────────────────────────────────────────────────────────────────────

function getRules(d) {
  return d.prepare('SELECT * FROM rules').all().map(rowRule);
}
function createRule(d, r) {
  const id = r.id || newId();
  d.prepare('INSERT INTO rules (id, match, category_id, tag) VALUES (?,?,?,?)').run(id, r.match, r.category_id, r.tag || null);
  return rowRule(d.prepare('SELECT * FROM rules WHERE id = ?').get(id));
}
function updateRule(d, id, patch) {
  const existing = d.prepare('SELECT * FROM rules WHERE id = ?').get(id);
  if (!existing) throw new Error('Rule not found');
  const sets = [];
  const vals = [];
  for (const k of ['match', 'category_id', 'tag']) {
    if (patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(patch[k]); }
  }
  if (sets.length) d.prepare(`UPDATE rules SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return rowRule(d.prepare('SELECT * FROM rules WHERE id = ?').get(id));
}
function deleteRule(d, id) {
  const info = d.prepare('DELETE FROM rules WHERE id = ?').run(id);
  if (!info.changes) throw new Error('Rule not found');
}

// ── holdings ──────────────────────────────────────────────────────────────────

function getHoldings(d, accountId = null) {
  const rows = accountId
    ? d.prepare('SELECT * FROM holdings WHERE account_id = ?').all(accountId)
    : d.prepare('SELECT * FROM holdings').all();
  return rows.map(rowHolding);
}
function createHolding(d, h) {
  const id = h.id || newId();
  d.prepare('INSERT INTO holdings (id, account_id, symbol, shares, cost_basis_cents, current_price_cents, price_source, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, h.account_id || null, String(h.symbol).toUpperCase().trim(), parseFloat(h.shares) || 0, toCents(h.cost_basis), toCents(h.current_price), h.price_source || 'manual', h.updated_at || new Date().toISOString().slice(0, 10));
  return rowHolding(d.prepare('SELECT * FROM holdings WHERE id = ?').get(id));
}
function updateHolding(d, id, patch) {
  const existing = d.prepare('SELECT * FROM holdings WHERE id = ?').get(id);
  if (!existing) throw new Error('Holding not found');
  const sets = [];
  const vals = [];
  if (patch.symbol !== undefined) { sets.push('symbol = ?'); vals.push(String(patch.symbol).toUpperCase().trim()); }
  if (patch.account_id !== undefined) { sets.push('account_id = ?'); vals.push(patch.account_id || null); }
  if (patch.shares !== undefined) { sets.push('shares = ?'); vals.push(parseFloat(patch.shares) || 0); }
  if (patch.cost_basis !== undefined) { sets.push('cost_basis_cents = ?'); vals.push(toCents(patch.cost_basis)); }
  if (patch.current_price !== undefined) { sets.push('current_price_cents = ?'); vals.push(toCents(patch.current_price)); }
  sets.push('updated_at = ?');
  vals.push(new Date().toISOString().slice(0, 10));
  d.prepare(`UPDATE holdings SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return rowHolding(d.prepare('SELECT * FROM holdings WHERE id = ?').get(id));
}
function deleteHolding(d, id) {
  const info = d.prepare('DELETE FROM holdings WHERE id = ?').run(id);
  if (!info.changes) throw new Error('Holding not found');
}

// ── net-worth snapshots ───────────────────────────────────────────────────────

function getSnapshots(d, fromDate = null) {
  const rows = fromDate
    ? d.prepare('SELECT * FROM networth_snapshots WHERE date >= ? ORDER BY date').all(fromDate)
    : d.prepare('SELECT * FROM networth_snapshots ORDER BY date').all();
  return rows.map(rowSnapshot);
}
// ensure-daily semantics: never overwrite an existing snapshot for the date.
function insertSnapshotIfMissing(d, s) {
  d.prepare('INSERT OR IGNORE INTO networth_snapshots (date, assets_cents, liabilities_cents, net_cents) VALUES (?,?,?,?)')
    .run(s.date, toCents(s.assets), toCents(s.liabilities), toCents(s.net));
}

// ── declared recurring ────────────────────────────────────────────────────────

function getRecurring(d) {
  return d.prepare('SELECT * FROM recurring ORDER BY next_date').all().map(rowRecurring);
}
function createRecurring(d, r) {
  const id = r.id || newId();
  d.prepare('INSERT INTO recurring (id, payee, amount_cents, cadence, kind, next_date, note) VALUES (?,?,?,?,?,?,?)')
    .run(id, r.payee, toCents(r.amount), r.cadence, r.kind, r.next_date || null, r.note || '');
  return rowRecurring(d.prepare('SELECT * FROM recurring WHERE id = ?').get(id));
}
function updateRecurring(d, id, patch) {
  const existing = d.prepare('SELECT * FROM recurring WHERE id = ?').get(id);
  if (!existing) throw new Error('Recurring item not found');
  const sets = [];
  const vals = [];
  for (const k of ['payee', 'cadence', 'kind', 'next_date', 'note']) {
    if (patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(patch[k]); }
  }
  if (patch.amount !== undefined) { sets.push('amount_cents = ?'); vals.push(toCents(patch.amount)); }
  if (sets.length) d.prepare(`UPDATE recurring SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return rowRecurring(d.prepare('SELECT * FROM recurring WHERE id = ?').get(id));
}
function deleteRecurring(d, id) {
  const info = d.prepare('DELETE FROM recurring WHERE id = ?').run(id);
  if (!info.changes) throw new Error('Recurring item not found');
}

// ── full-blob export / import (backup, seed, reset only) ──────────────────────

const BLOB_KEYS = ['accounts', 'transactions', 'categories', 'budgets', 'goals', 'rules', 'holdings', 'networth_snapshots', 'recurring'];

function readAll(d) {
  const out = {
    accounts: getAccounts(d),
    transactions: getTransactions(d),
    categories: getCategories(d),
    budgets: getBudgets(d),
    goals: getGoals(d),
    rules: getRules(d),
    holdings: getHoldings(d),
    networth_snapshots: getSnapshots(d),
    recurring: getRecurring(d),
  };
  // Loose top-level keys round-tripped verbatim via meta.
  const extras = d.prepare("SELECT value FROM meta WHERE key='extras'").get();
  if (extras && extras.value) {
    try { Object.assign(out, JSON.parse(extras.value)); } catch { /* ignore */ }
  }
  return out;
}

function writeAll(d, blob) {
  const arr = (k) => (Array.isArray(blob[k]) ? blob[k] : []);
  const run = d.transaction(() => {
    // FK-safe delete order (children first).
    for (const t of ['transactions', 'holdings', 'accounts', 'categories', 'budgets', 'goals', 'rules', 'networth_snapshots', 'recurring']) {
      d.prepare(`DELETE FROM ${t}`).run();
    }

    for (const c of arr('categories')) createCategory(d, c);

    // Accounts: incoming `balance` is the CURRENT balance; derive the opening
    // balance by subtracting the incoming transactions for that account.
    const txns = arr('transactions');
    const sums = {};
    for (const t of txns) sums[t.account_id] = (sums[t.account_id] || 0) + toCents(t.amount);
    const accIds = new Set();
    for (const a of arr('accounts')) {
      const actualId = a.id || newId();
      accIds.add(actualId);
      d.prepare('INSERT INTO accounts (id, name, type, opening_balance_cents, institution, currency, status, created_at, custom) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(actualId, a.name, a.type, toCents(a.balance) - (sums[a.id] || 0), a.institution || '', a.currency || 'USD', a.status || 'active', a.created_at || null, jsonText(a.custom, {}));
    }

    const txnStmt = d.prepare(TXN_INSERT);
    for (const t of txns) {
      // Orphaned account references (old/hand-edited backups) become unassigned
      // rather than failing the whole import on the FK.
      const acct = accIds.has(t.account_id) ? t.account_id : null;
      txnStmt.run(...txnInsertArgs({ ...t, account_id: acct }, t.id || newId()));
    }

    for (const b of arr('budgets')) createBudget(d, b);
    for (const g of arr('goals')) createGoal(d, { ...g, linked_account_id: accIds.has(g.linked_account_id) ? g.linked_account_id : null });
    for (const r of arr('rules')) createRule(d, r);
    for (const h of arr('holdings')) createHolding(d, { ...h, account_id: accIds.has(h.account_id) ? h.account_id : null });
    for (const s of arr('networth_snapshots')) {
      d.prepare('INSERT OR REPLACE INTO networth_snapshots (date, assets_cents, liabilities_cents, net_cents) VALUES (?,?,?,?)')
        .run(s.date, toCents(s.assets), toCents(s.liabilities), toCents(s.net));
    }
    for (const r of arr('recurring')) createRecurring(d, { cadence: 'monthly', kind: 'bill', ...r });

    const extras = {};
    for (const k of Object.keys(blob)) if (!BLOB_KEYS.includes(k)) extras[k] = blob[k];
    d.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('extras', ?)").run(JSON.stringify(extras));
  });
  run();
}

// ── user settings (meta['settings']) ─────────────────────────────────────────
// Deep merge: nested objects merge recursively, arrays and scalars replace —
// so a partial PUT can no longer clobber sibling nested keys.

function deepMerge(base, patch) {
  if (patch === null || Array.isArray(patch) || typeof patch !== 'object') return patch;
  const out = (base && typeof base === 'object' && !Array.isArray(base)) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
  return out;
}

function getSettings(d) {
  const row = d.prepare("SELECT value FROM meta WHERE key='settings'").get();
  try { return row && row.value ? JSON.parse(row.value) : {}; } catch { return {}; }
}

function setSettings(d, partial) {
  const next = deepMerge(getSettings(d), partial && typeof partial === 'object' ? partial : {});
  d.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('settings', ?)").run(JSON.stringify(next));
  return next;
}

module.exports = {
  newId, defaultCategories, emptyData, readAll, writeAll, getSettings, setSettings,
  getAccounts, getAccount, createAccount, updateAccount, deleteAccount,
  getTransactions, getTransaction, createTransaction, insertTransactions,
  updateTransaction, deleteTransaction, updateTransactionsBulk, deleteTransactionsBulk, setTransactionCategories, getPayeeStats,
  getCategories, createCategory,
  getBudgets, createBudget, updateBudget, deleteBudget,
  getGoals, createGoal, updateGoal, deleteGoal,
  getRules, createRule, updateRule, deleteRule,
  getHoldings, createHolding, updateHolding, deleteHolding,
  getSnapshots, insertSnapshotIfMissing,
  getRecurring, createRecurring, updateRecurring, deleteRecurring,
};
