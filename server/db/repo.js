'use strict';

const crypto = require('crypto');
const { toCents } = require('../money/amounts');
const { normalizeBalance } = require('../money/account-types');

// Repository v2 — per-row prepared statements over the cents-based schema.
// Money is INTEGER cents in SQLite; this layer converts to float dollars at its
// boundary, so store.js / routes / UI keep the dollar shapes they always had.
// Account balances are DERIVED: opening_balance_cents + SUM(transactions).
// readAll/writeAll remain only for export / import / seed / reset.

// toCents is the strict money boundary (server/money/amounts.js): it throws on
// garbage and out-of-range amounts instead of storing a wrong number.
const toDollars = (c) => (c == null ? null : Math.round(c) / 100);
// Local YYYY-MM-DD. toISOString() is UTC and names tomorrow on an Arizona evening.
const todayLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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
    http_cache: [],
    paper_account: null,
    paper_positions: [],
    paper_trades: [],
    paper_journal: [],
    agent_events: [],
    decisions: [],
    closes: [],
    watchlist: [],
    import_log: [],
    price_cache: [],
    alert_rules: [],
    price_bars: [],
    strategies: [],
    backtest_runs: [],
    learn_progress: [],
    learn_step_progress: [],
    learn_cards: [],
    learn_reviews: [],
    learn_applied_actions: [],
    learn_settings: null,
    learn_streak: null,
    learn_events: [],
    activity_log: [],
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
  apr: r.apr ?? null, min_payment: toDollars(r.min_payment_cents),
});
const rowTxn = (r) => ({
  id: r.id, account_id: r.account_id, date: r.date,
  amount: toDollars(r.amount_cents),
  payee: r.payee, category_id: r.category_id,
  tags: safeJson(r.tags, []), note: r.note, source: r.source,
  cleared: !!r.cleared, custom: safeJson(r.custom, {}),
  external_id: r.external_id ?? null, import_batch_id: r.import_batch_id ?? null,
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
const rowRecurring = (r) => ({ id: r.id, payee: r.payee, amount: toDollars(r.amount_cents), cadence: r.cadence, kind: r.kind, next_date: r.next_date, note: r.note, account_id: r.account_id || null, anchor_day: r.anchor_day ?? null });
const rowHttpCache = (r) => ({ cache_key: r.cache_key, feature: r.feature, url: r.url, data: safeJson(r.data, null), cached_at: r.cached_at });

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
const ACCOUNT_INSERT = 'INSERT INTO accounts (id, name, type, opening_balance_cents, institution, currency, status, created_at, custom, apr, min_payment_cents) VALUES (?,?,?,?,?,?,?,?,?,?,?)';
const optCents = (v) => (v === undefined || v === null || v === '' ? null : toCents(v));
const optRate = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
function insertAccountRow(d, id, a, openingCents) {
  d.prepare(ACCOUNT_INSERT).run(id, a.name, a.type, openingCents, a.institution || '', a.currency || 'USD',
    a.status || 'active', a.created_at || null, jsonText(a.custom, {}), optRate(a.apr), optCents(a.min_payment));
}
function createAccount(d, a) {
  const id = a.id || newId();
  const balance = normalizeBalance(a.type, a.balance);
  insertAccountRow(d, id, { ...a, created_at: a.created_at || new Date().toISOString() }, toCents(balance));
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
    if (patch.apr !== undefined) { sets.push('apr = ?'); vals.push(optRate(patch.apr)); }
    if (patch.min_payment !== undefined) { sets.push('min_payment_cents = ?'); vals.push(optCents(patch.min_payment)); }
    if (patch.balance !== undefined) {
      // Balance is derived — editing it adjusts the opening balance so the
      // derived value lands exactly on the requested number.
      const balance = normalizeBalance(patch.type ?? existing.type, patch.balance);
      sets.push('opening_balance_cents = ?');
      vals.push(toCents(balance) - txnSumCents(d, id));
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

const TXN_INSERT = 'INSERT INTO transactions (id, account_id, date, amount_cents, payee, category_id, tags, note, source, cleared, custom, external_id, import_batch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)';
function txnInsertArgs(t, id) {
  return [id, t.account_id || null, String(t.date).slice(0, 10), toCents(t.amount), t.payee || '', t.category_id || null,
    jsonText(t.tags, []), t.note || '', t.source || 'manual', t.cleared ? 1 : 0, jsonText(t.custom, {}),
    t.external_id || null, t.import_batch_id || null];
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
    .run(id, h.account_id || null, String(h.symbol).toUpperCase().trim(), parseFloat(h.shares) || 0, toCents(h.cost_basis), toCents(h.current_price), h.price_source || 'manual', h.updated_at || todayLocal());
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
  if (patch.price_source !== undefined) { sets.push('price_source = ?'); vals.push(patch.price_source); }
  sets.push('updated_at = ?');
  vals.push(todayLocal());
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
// Monthly/quarterly/annual schedules are pinned to the day of month they were
// created on, so an item due the 31st comes back to the 31st after a short
// month instead of drifting to the 28th forever.
const dayOf = (ymd) => (ymd && /^\d{4}-\d{2}-\d{2}/.test(ymd) ? Number(String(ymd).slice(8, 10)) : null);
function createRecurring(d, r) {
  const id = r.id || newId();
  const anchor = r.anchor_day ?? dayOf(r.next_date);
  d.prepare('INSERT INTO recurring (id, payee, amount_cents, cadence, kind, next_date, note, account_id, anchor_day) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, r.payee, toCents(r.amount), r.cadence, r.kind, r.next_date || null, r.note || '', r.account_id || null, anchor);
  return rowRecurring(d.prepare('SELECT * FROM recurring WHERE id = ?').get(id));
}
function updateRecurring(d, id, patch) {
  const existing = d.prepare('SELECT * FROM recurring WHERE id = ?').get(id);
  if (!existing) throw new Error('Recurring item not found');
  const sets = [];
  const vals = [];
  for (const k of ['payee', 'cadence', 'kind', 'next_date', 'note', 'account_id']) {
    if (patch[k] !== undefined) { sets.push(`${k} = ?`); vals.push(patch[k] === '' ? null : patch[k]); }
  }
  if (patch.amount !== undefined) { sets.push('amount_cents = ?'); vals.push(toCents(patch.amount)); }
  // A user edit of next_date re-pins the schedule to that day; the auto-post
  // advance passes its own anchor_day so it never re-pins to a clamped date.
  if (patch.anchor_day !== undefined) { sets.push('anchor_day = ?'); vals.push(patch.anchor_day); }
  else if (patch.next_date) { sets.push('anchor_day = ?'); vals.push(dayOf(patch.next_date)); }
  if (sets.length) d.prepare(`UPDATE recurring SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return rowRecurring(d.prepare('SELECT * FROM recurring WHERE id = ?').get(id));
}
function deleteRecurring(d, id) {
  const info = d.prepare('DELETE FROM recurring WHERE id = ?').run(id);
  if (!info.changes) throw new Error('Recurring item not found');
}

// ── online seam http cache (Sprint A, Track 1) ──────────────────────────────

function getHttpCacheEntry(d, cacheKey) {
  const r = d.prepare('SELECT * FROM http_cache WHERE cache_key = ?').get(cacheKey);
  return r ? rowHttpCache(r) : null;
}
function getAllHttpCache(d) {
  return d.prepare('SELECT * FROM http_cache').all().map(rowHttpCache);
}
function upsertHttpCache(d, entry) {
  d.prepare(`
    INSERT INTO http_cache (cache_key, feature, url, data, cached_at) VALUES (?,?,?,?,?)
    ON CONFLICT(cache_key) DO UPDATE SET feature = excluded.feature, url = excluded.url, data = excluded.data, cached_at = excluded.cached_at
  `).run(entry.cache_key, entry.feature || null, entry.url || null, jsonText(entry.data, null), entry.cached_at);
  return getHttpCacheEntry(d, entry.cache_key);
}

// ── paper trading ledger (Sprint A, Track 3) ────────────────────────────────
// Paper-only forever. Money is INTEGER cents at rest; this layer converts to
// dollars at its boundary like every other table here. paper_account is a
// singleton (id='default'), so it is handled outside the BLOB_KEYS array
// loop — same spirit as meta['settings'].

const rowPaperAccount = (r) => ({
  capital: toDollars(r.capital_cents),
  starting_capital: toDollars(r.starting_capital_cents),
  created_at: r.created_at,
});
const rowPaperPosition = (r) => ({
  id: r.id, ticker: r.ticker, direction: r.direction, shares: r.shares,
  entry_price: toDollars(r.entry_price_cents),
  stop_price: toDollars(r.stop_price_cents),
  target1: toDollars(r.target1_cents), target2: toDollars(r.target2_cents),
  thesis: r.thesis, decision_id: r.decision_id, sector: r.sector,
  risk_amount: toDollars(r.risk_amount_cents),
  opened_at: r.opened_at, source: r.source, source_id: r.source_id,
});
const rowPaperTrade = (r) => ({
  id: r.id, ticker: r.ticker, direction: r.direction, shares: r.shares,
  entry_price: toDollars(r.entry_price_cents), exit_price: toDollars(r.exit_price_cents),
  pnl: toDollars(r.pnl_cents), pnl_pct: r.pnl_pct,
  thesis: r.thesis, sector: r.sector, decision_id: r.decision_id,
  opened_at: r.opened_at, closed_at: r.closed_at,
  what_happened: r.what_happened, lesson: r.lesson,
  source: r.source, source_id: r.source_id,
});
const rowPaperJournal = (r) => ({ id: r.id, trade_id: r.trade_id, note: r.note, tag: r.tag, created_at: r.created_at });
const rowAgentEvent = (r) => ({ id: r.id, ts: r.ts, event: r.event, ticker: r.ticker, sector: r.sector, outcome: r.outcome, data: safeJson(r.data, {}) });
const rowDecision = (r) => ({
  id: r.id, ticker: r.ticker, direction: r.direction,
  entry_price: toDollars(r.entry_price_cents),
  thesis: r.thesis, consensus: r.consensus, pm: r.pm, context: r.context,
  created_at: r.created_at, status: r.status,
});
const rowClose = (r) => ({
  decision_id: r.decision_id, exit_price: toDollars(r.exit_price_cents),
  pnl: toDollars(r.pnl_cents), return_pct: r.return_pct, alpha_vs_spy: r.alpha_vs_spy,
  lesson: r.lesson, closed_at: r.closed_at,
});
const rowWatchlistItem = (r) => ({ id: r.id, symbol: r.symbol, note: r.note, source: r.source, added_at: r.added_at });
const rowImportLog = (r) => ({ source: r.source, source_id: r.source_id, imported_at: r.imported_at });

function ensurePaperAccount(d) {
  d.prepare("INSERT OR IGNORE INTO paper_account (id, capital_cents, starting_capital_cents, created_at) VALUES ('default', 10000000, 10000000, ?)")
    .run(new Date().toISOString());
}
function getPaperAccount(d) {
  ensurePaperAccount(d);
  return rowPaperAccount(d.prepare("SELECT * FROM paper_account WHERE id='default'").get());
}
// Sets both capital and starting_capital (fresh-start reset, or blob import).
function importPaperAccount(d, pa) {
  const capitalCents = toCents(pa.capital ?? pa.starting_capital ?? 100000);
  const startingCents = toCents(pa.starting_capital ?? pa.capital ?? 100000);
  d.prepare(`
    INSERT INTO paper_account (id, capital_cents, starting_capital_cents, created_at) VALUES ('default', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET capital_cents = excluded.capital_cents, starting_capital_cents = excluded.starting_capital_cents, created_at = excluded.created_at
  `).run(capitalCents, startingCents, pa.created_at || new Date().toISOString());
  return getPaperAccount(d);
}
// In-place capital adjustment (open/close cash flows). deltaDollars may be negative.
function adjustPaperAccountCapital(d, deltaDollars) {
  ensurePaperAccount(d);
  d.prepare("UPDATE paper_account SET capital_cents = capital_cents + ? WHERE id='default'").run(toCents(deltaDollars));
  return getPaperAccount(d);
}

function getPaperPositions(d) {
  return d.prepare('SELECT * FROM paper_positions ORDER BY opened_at').all().map(rowPaperPosition);
}
function getPaperPosition(d, id) {
  const r = d.prepare('SELECT * FROM paper_positions WHERE id = ?').get(id);
  return r ? rowPaperPosition(r) : null;
}
function createPaperPosition(d, p) {
  const id = p.id || newId();
  d.prepare(`
    INSERT INTO paper_positions (id, ticker, direction, shares, entry_price_cents, stop_price_cents, target1_cents, target2_cents, thesis, decision_id, sector, risk_amount_cents, opened_at, source, source_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, String(p.ticker).toUpperCase(), p.direction, parseFloat(p.shares) || 0,
    toCents(p.entry_price), p.stop_price != null ? toCents(p.stop_price) : null,
    p.target1 != null ? toCents(p.target1) : null, p.target2 != null ? toCents(p.target2) : null,
    p.thesis || '', p.decision_id ?? null, p.sector || null,
    p.risk_amount != null ? toCents(p.risk_amount) : null,
    p.opened_at || new Date().toISOString(), p.source || 'app', p.source_id ?? null,
  );
  return getPaperPosition(d, id);
}
function deletePaperPosition(d, id) {
  const info = d.prepare('DELETE FROM paper_positions WHERE id = ?').run(id);
  if (!info.changes) throw new Error('Position not found');
}

function getPaperTrades(d) {
  return d.prepare('SELECT * FROM paper_trades ORDER BY closed_at DESC').all().map(rowPaperTrade);
}
function getPaperTrade(d, id) {
  const r = d.prepare('SELECT * FROM paper_trades WHERE id = ?').get(id);
  return r ? rowPaperTrade(r) : null;
}
function createPaperTrade(d, t) {
  const id = t.id || newId();
  d.prepare(`
    INSERT INTO paper_trades (id, ticker, direction, shares, entry_price_cents, exit_price_cents, pnl_cents, pnl_pct, thesis, sector, decision_id, opened_at, closed_at, what_happened, lesson, source, source_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, String(t.ticker).toUpperCase(), t.direction, parseFloat(t.shares) || 0,
    toCents(t.entry_price), toCents(t.exit_price), toCents(t.pnl), t.pnl_pct || 0,
    t.thesis || '', t.sector || null, t.decision_id ?? null,
    t.opened_at, t.closed_at || new Date().toISOString(),
    t.what_happened || '', t.lesson || '', t.source || 'app', t.source_id ?? null,
  );
  return getPaperTrade(d, id);
}
function updatePaperTrade(d, id, patch) {
  const existing = d.prepare('SELECT * FROM paper_trades WHERE id = ?').get(id);
  if (!existing) throw new Error('Trade not found');
  const sets = [];
  const vals = [];
  if (patch.what_happened !== undefined) { sets.push('what_happened = ?'); vals.push(patch.what_happened); }
  if (patch.lesson !== undefined) { sets.push('lesson = ?'); vals.push(patch.lesson); }
  if (sets.length) d.prepare(`UPDATE paper_trades SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return getPaperTrade(d, id);
}

function getPaperJournal(d, tradeId = null) {
  const rows = tradeId
    ? d.prepare('SELECT * FROM paper_journal WHERE trade_id = ? ORDER BY created_at').all(tradeId)
    : d.prepare('SELECT * FROM paper_journal ORDER BY created_at').all();
  return rows.map(rowPaperJournal);
}
function createPaperJournalEntry(d, j) {
  const id = j.id || newId();
  d.prepare('INSERT INTO paper_journal (id, trade_id, note, tag, created_at) VALUES (?,?,?,?,?)')
    .run(id, j.trade_id ?? null, j.note, j.tag || null, j.created_at || new Date().toISOString());
  return rowPaperJournal(d.prepare('SELECT * FROM paper_journal WHERE id = ?').get(id));
}

function getAgentEvents(d, { since = null, event = null, limit = null } = {}) {
  let sql = 'SELECT * FROM agent_events WHERE 1=1';
  const args = [];
  if (since) { sql += ' AND ts >= ?'; args.push(since); }
  if (event) { sql += ' AND event = ?'; args.push(event); }
  sql += ' ORDER BY ts DESC, id DESC';
  if (limit) { sql += ' LIMIT ?'; args.push(limit); }
  return d.prepare(sql).all(...args).map(rowAgentEvent);
}
function appendAgentEvent(d, e) {
  const info = d.prepare('INSERT INTO agent_events (id, ts, event, ticker, sector, outcome, data) VALUES (?,?,?,?,?,?,?)')
    .run(e.id ?? null, e.ts || new Date().toISOString(), e.event, e.ticker || null, e.sector || null, e.outcome || null, jsonText(e.data, {}));
  return rowAgentEvent(d.prepare('SELECT * FROM agent_events WHERE id = ?').get(e.id ?? info.lastInsertRowid));
}

function getDecisions(d) {
  return d.prepare('SELECT * FROM decisions ORDER BY created_at').all().map(rowDecision);
}
function getDecision(d, id) {
  const r = d.prepare('SELECT * FROM decisions WHERE id = ?').get(id);
  return r ? rowDecision(r) : null;
}
function createDecision(d, dec) {
  const info = d.prepare(`
    INSERT INTO decisions (id, ticker, direction, entry_price_cents, thesis, consensus, pm, context, created_at, status)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    dec.id ?? null, String(dec.ticker).toUpperCase(), dec.direction,
    dec.entry_price != null ? toCents(dec.entry_price) : null,
    dec.thesis || '', dec.consensus || '', dec.pm || '', dec.context || '',
    dec.created_at || new Date().toISOString(), dec.status || 'open',
  );
  return getDecision(d, dec.id ?? info.lastInsertRowid);
}
function updateDecisionStatus(d, id, status) {
  const info = d.prepare('UPDATE decisions SET status = ? WHERE id = ?').run(status, id);
  if (!info.changes) throw new Error('Decision not found');
  return getDecision(d, id);
}

function getCloses(d) {
  return d.prepare('SELECT * FROM closes ORDER BY closed_at').all().map(rowClose);
}
function createClose(d, c) {
  d.prepare(`
    INSERT INTO closes (decision_id, exit_price_cents, pnl_cents, return_pct, alpha_vs_spy, lesson, closed_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    c.decision_id, c.exit_price != null ? toCents(c.exit_price) : null,
    c.pnl != null ? toCents(c.pnl) : null, c.return_pct ?? null, c.alpha_vs_spy ?? null,
    c.lesson || '', c.closed_at || new Date().toISOString(),
  );
  return rowClose(d.prepare('SELECT * FROM closes WHERE decision_id = ?').get(c.decision_id));
}

function getWatchlist(d) {
  return d.prepare('SELECT * FROM watchlist ORDER BY added_at').all().map(rowWatchlistItem);
}
function createWatchlistItem(d, w) {
  const id = w.id || newId();
  d.prepare('INSERT INTO watchlist (id, symbol, note, source, added_at) VALUES (?,?,?,?,?)')
    .run(id, String(w.symbol).toUpperCase(), w.note || '', w.source || 'manual', w.added_at || new Date().toISOString());
  return rowWatchlistItem(d.prepare('SELECT * FROM watchlist WHERE id = ?').get(id));
}
function deleteWatchlistItem(d, id) {
  const info = d.prepare('DELETE FROM watchlist WHERE id = ?').run(id);
  if (!info.changes) throw new Error('Watchlist item not found');
}

// ── market price cache (Sprint A, Track 2) ──────────────────────────────────
// Written only by server/market/snapshots.js (interval job or explicit
// Refresh) — never read-triggers-a-fetch. Money is INTEGER cents at rest;
// this layer converts to dollars at its boundary like every other table.

const rowPriceCache = (r) => ({
  id: r.id, kind: r.kind, symbol: r.symbol,
  price: toDollars(r.price_cents), change_pct: r.change_pct,
  data: safeJson(r.data, {}), source: r.source, fetched_at: r.fetched_at,
});
function getPriceCache(d, kind = null) {
  const rows = kind
    ? d.prepare('SELECT * FROM price_cache WHERE kind = ? ORDER BY symbol').all(kind)
    : d.prepare('SELECT * FROM price_cache ORDER BY kind, symbol').all();
  return rows.map(rowPriceCache);
}
function getPriceCacheEntry(d, id) {
  const r = d.prepare('SELECT * FROM price_cache WHERE id = ?').get(id);
  return r ? rowPriceCache(r) : null;
}
function upsertPriceCache(d, entry) {
  d.prepare(`
    INSERT INTO price_cache (id, kind, symbol, price_cents, change_pct, data, source, fetched_at) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, symbol = excluded.symbol, price_cents = excluded.price_cents,
      change_pct = excluded.change_pct, data = excluded.data, source = excluded.source, fetched_at = excluded.fetched_at
  `).run(
    entry.id, entry.kind, entry.symbol,
    entry.price == null ? null : toCents(entry.price), entry.change_pct ?? null,
    jsonText(entry.data, {}), entry.source || 'yahoo', entry.fetched_at || new Date().toISOString(),
  );
  return getPriceCacheEntry(d, entry.id);
}

// ── price alert rules (Sprint A, Track 2) ───────────────────────────────────

const rowAlertRule = (r) => ({
  id: r.id, symbol: r.symbol, condition: r.condition,
  target: toDollars(r.target_cents), active: !!r.active,
  created_at: r.created_at, triggered_at: r.triggered_at,
});
function getAlertRules(d) {
  return d.prepare('SELECT * FROM alert_rules ORDER BY created_at').all().map(rowAlertRule);
}
function createAlertRule(d, a) {
  const id = a.id || newId();
  d.prepare('INSERT INTO alert_rules (id, symbol, condition, target_cents, active, created_at, triggered_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, String(a.symbol).toUpperCase(), a.condition, toCents(a.target), a.active === false ? 0 : 1, a.created_at || new Date().toISOString(), a.triggered_at || null);
  return getAlertRule(d, id);
}
function getAlertRule(d, id) {
  const r = d.prepare('SELECT * FROM alert_rules WHERE id = ?').get(id);
  return r ? rowAlertRule(r) : null;
}
function updateAlertRule(d, id, patch) {
  const existing = getAlertRule(d, id);
  if (!existing) throw new Error('Alert rule not found');
  const sets = [];
  const vals = [];
  if (patch.condition !== undefined) { sets.push('condition = ?'); vals.push(patch.condition); }
  if (patch.target !== undefined) { sets.push('target_cents = ?'); vals.push(toCents(patch.target)); }
  if (patch.active !== undefined) { sets.push('active = ?'); vals.push(patch.active ? 1 : 0); }
  if (patch.triggered_at !== undefined) { sets.push('triggered_at = ?'); vals.push(patch.triggered_at); }
  if (sets.length) d.prepare(`UPDATE alert_rules SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return getAlertRule(d, id);
}
function deleteAlertRule(d, id) {
  const info = d.prepare('DELETE FROM alert_rules WHERE id = ?').run(id);
  if (!info.changes) throw new Error('Alert rule not found');
}

// ── backtester (Sprint B, Wave 2) ───────────────────────────────────────────

const rowPriceBar = (r) => ({
  symbol: r.symbol, date: r.date,
  open: toDollars(r.open_cents), high: toDollars(r.high_cents),
  low: toDollars(r.low_cents), close: toDollars(r.close_cents),
  volume: r.volume, split: r.split, dividend: toDollars(r.dividend_cents) || 0,
  source: r.source,
});
function getPriceBars(d, symbol, { from = null, to = null } = {}) {
  let sql = 'SELECT * FROM price_bars WHERE symbol = ?';
  const params = [String(symbol).toUpperCase()];
  if (from) { sql += ' AND date >= ?'; params.push(from); }
  if (to) { sql += ' AND date <= ?'; params.push(to); }
  sql += ' ORDER BY date';
  return d.prepare(sql).all(...params).map(rowPriceBar);
}
function getPriceBarSymbols(d) {
  return d.prepare('SELECT DISTINCT symbol FROM price_bars ORDER BY symbol').all().map((r) => r.symbol);
}
// Cheap (COUNT/MAX, no row payload) fingerprint of one symbol's bar content
// over a date range — used to fold bar CONTENT into a backtest config hash
// so a re-upload of corrected bars under an unchanged config is recognised
// as a new run instead of matching a stale cached one.
function getPriceBarFingerprint(d, symbol, { from = null, to = null } = {}) {
  let sql = 'SELECT COUNT(*) as count, MAX(date) as maxDate FROM price_bars WHERE symbol = ?';
  const params = [String(symbol).toUpperCase()];
  if (from) { sql += ' AND date >= ?'; params.push(from); }
  if (to) { sql += ' AND date <= ?'; params.push(to); }
  const row = d.prepare(sql).get(...params);
  return { count: row.count, maxDate: row.maxDate };
}
// Bulk upsert — one call per CSV upload or Yahoo sync. Returns rows written.
function upsertPriceBars(d, symbol, bars, source = 'csv') {
  const sym = String(symbol).toUpperCase();
  const stmt = d.prepare(`
    INSERT INTO price_bars (symbol, date, open_cents, high_cents, low_cents, close_cents, volume, split, dividend_cents, source)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(symbol, date) DO UPDATE SET open_cents = excluded.open_cents, high_cents = excluded.high_cents,
      low_cents = excluded.low_cents, close_cents = excluded.close_cents, volume = excluded.volume,
      split = excluded.split, dividend_cents = excluded.dividend_cents, source = excluded.source
  `);
  let count = 0;
  const run = d.transaction(() => {
    for (const b of bars) {
      stmt.run(
        sym, String(b.date).slice(0, 10), toCents(b.open), toCents(b.high), toCents(b.low), toCents(b.close),
        b.volume == null ? null : Math.round(Number(b.volume)) || 0,
        b.split == null ? 1 : Number(b.split) || 1,
        toCents(b.dividend || 0), source,
      );
      count += 1;
    }
  });
  run();
  return count;
}
function deletePriceBars(d, symbol) {
  return d.prepare('DELETE FROM price_bars WHERE symbol = ?').run(String(symbol).toUpperCase()).changes;
}

const rowStrategy = (r) => ({ id: r.id, name: r.name, kind: r.kind, params: safeJson(r.params, {}), created_at: r.created_at });
function getStrategies(d) {
  return d.prepare('SELECT * FROM strategies ORDER BY created_at').all().map(rowStrategy);
}
function getStrategy(d, id) {
  const r = d.prepare('SELECT * FROM strategies WHERE id = ?').get(id);
  return r ? rowStrategy(r) : null;
}
function createStrategy(d, s) {
  const id = s.id || newId();
  d.prepare('INSERT INTO strategies (id, name, kind, params, created_at) VALUES (?,?,?,?,?)')
    .run(id, s.name, s.kind, jsonText(s.params, {}), s.created_at || new Date().toISOString());
  return getStrategy(d, id);
}
function deleteStrategy(d, id) {
  const info = d.prepare('DELETE FROM strategies WHERE id = ?').run(id);
  if (!info.changes) throw new Error('Strategy not found');
}

const rowBacktestRun = (r) => ({
  id: r.id, config_hash: r.config_hash, strategy_id: r.strategy_id,
  config: safeJson(r.config, {}), outcome: r.outcome, error: r.error,
  result: safeJson(r.result, null), metrics: safeJson(r.metrics, null),
  created_at: r.created_at,
});
function getBacktestRuns(d, { limit = 50 } = {}) {
  return d.prepare('SELECT * FROM backtest_runs ORDER BY created_at DESC LIMIT ?').all(limit).map(rowBacktestRun);
}
function getBacktestRun(d, id) {
  const r = d.prepare('SELECT * FROM backtest_runs WHERE id = ?').get(id);
  return r ? rowBacktestRun(r) : null;
}
function getBacktestRunsByHash(d, hash) {
  return d.prepare('SELECT * FROM backtest_runs WHERE config_hash = ? ORDER BY created_at DESC').all(hash).map(rowBacktestRun);
}
function createBacktestRun(d, r) {
  const id = r.id || newId();
  d.prepare(`
    INSERT INTO backtest_runs (id, config_hash, strategy_id, config, outcome, error, result, metrics, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    id, r.config_hash, r.strategy_id || null, jsonText(r.config, {}), r.outcome,
    r.error || null, r.result == null ? null : jsonText(r.result, null), r.metrics == null ? null : jsonText(r.metrics, null),
    r.created_at || new Date().toISOString(),
  );
  return getBacktestRun(d, id);
}

function getImportLog(d) {
  return d.prepare('SELECT * FROM import_log').all().map(rowImportLog);
}
function hasImported(d, source, sourceId) {
  return !!d.prepare('SELECT 1 FROM import_log WHERE source = ? AND source_id = ?').get(source, sourceId);
}
function markImported(d, source, sourceId, importedAt = new Date().toISOString()) {
  d.prepare('INSERT OR IGNORE INTO import_log (source, source_id, imported_at) VALUES (?,?,?)').run(source, sourceId, importedAt);
}

// ── learn engine (Sprint D, Track 1) ────────────────────────────────────────
// Single local user — no user_id columns, same spirit as paper_account.
// Lesson CONTENT never lives here (content/learn/**/*.md, loaded by
// server/learn/content.js); these tables are purely the user's progress,
// spaced-repetition state, applied-action ledger, and settings.

const rowLearnProgress = (r) => ({
  lesson_id: r.lesson_id, status: r.status, score_pct: r.score_pct,
  apply_action_done: !!r.apply_action_done,
  started_at: r.started_at, completed_at: r.completed_at, updated_at: r.updated_at,
});
function getAllLearnProgress(d) {
  return d.prepare('SELECT * FROM learn_progress').all().map(rowLearnProgress);
}
function getLearnProgress(d, lessonId) {
  const r = d.prepare('SELECT * FROM learn_progress WHERE lesson_id = ?').get(lessonId);
  return r ? rowLearnProgress(r) : null;
}
function upsertLearnProgress(d, lessonId, patch = {}) {
  const now = new Date().toISOString();
  const existing = getLearnProgress(d, lessonId);
  const next = {
    status: 'not_started', score_pct: null, apply_action_done: false,
    started_at: null, completed_at: null,
    ...(existing || {}), ...patch, lesson_id: lessonId, updated_at: now,
  };
  d.prepare(`
    INSERT INTO learn_progress (lesson_id, status, score_pct, apply_action_done, started_at, completed_at, updated_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(lesson_id) DO UPDATE SET status = excluded.status, score_pct = excluded.score_pct,
      apply_action_done = excluded.apply_action_done, started_at = excluded.started_at,
      completed_at = excluded.completed_at, updated_at = excluded.updated_at
  `).run(lessonId, next.status, next.score_pct, next.apply_action_done ? 1 : 0, next.started_at, next.completed_at, now);
  return getLearnProgress(d, lessonId);
}
// Full-blob import (backup/seed/reset): preserves the exact row, unlike
// upsertLearnProgress which stamps `updated_at = now` for live app writes.
function importLearnProgress(d, row) {
  d.prepare(`
    INSERT INTO learn_progress (lesson_id, status, score_pct, apply_action_done, started_at, completed_at, updated_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(lesson_id) DO UPDATE SET status = excluded.status, score_pct = excluded.score_pct,
      apply_action_done = excluded.apply_action_done, started_at = excluded.started_at,
      completed_at = excluded.completed_at, updated_at = excluded.updated_at
  `).run(
    row.lesson_id, row.status || 'not_started', row.score_pct ?? null,
    row.apply_action_done ? 1 : 0, row.started_at || null, row.completed_at || null,
    row.updated_at || new Date().toISOString(),
  );
}

const rowLearnStepProgress = (r) => ({
  id: r.id, lesson_id: r.lesson_id, step_index: r.step_index, status: r.status,
  answer: safeJson(r.answer, {}), updated_at: r.updated_at,
});
function getLearnStepProgress(d, lessonId) {
  return d.prepare('SELECT * FROM learn_step_progress WHERE lesson_id = ? ORDER BY step_index').all(lessonId).map(rowLearnStepProgress);
}
function getAllLearnStepProgress(d) {
  return d.prepare('SELECT * FROM learn_step_progress ORDER BY lesson_id, step_index').all().map(rowLearnStepProgress);
}
function upsertLearnStepProgress(d, lessonId, stepIndex, patch = {}) {
  const now = new Date().toISOString();
  const existing = d.prepare('SELECT * FROM learn_step_progress WHERE lesson_id = ? AND step_index = ?').get(lessonId, stepIndex);
  const id = (existing && existing.id) || patch.id || newId();
  const status = patch.status !== undefined ? patch.status : (existing ? existing.status : 'pending');
  const answer = patch.answer !== undefined ? patch.answer : (existing ? safeJson(existing.answer, {}) : {});
  d.prepare(`
    INSERT INTO learn_step_progress (id, lesson_id, step_index, status, answer, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(lesson_id, step_index) DO UPDATE SET status = excluded.status, answer = excluded.answer, updated_at = excluded.updated_at
  `).run(id, lessonId, stepIndex, status, jsonText(answer, {}), now);
  return d.prepare('SELECT * FROM learn_step_progress WHERE lesson_id = ? AND step_index = ?').get(lessonId, stepIndex);
}
function importLearnStepProgress(d, row) {
  d.prepare(`
    INSERT INTO learn_step_progress (id, lesson_id, step_index, status, answer, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(lesson_id, step_index) DO UPDATE SET status = excluded.status, answer = excluded.answer, updated_at = excluded.updated_at
  `).run(row.id || newId(), row.lesson_id, row.step_index, row.status || 'pending', jsonText(row.answer, {}), row.updated_at || new Date().toISOString());
}

const rowLearnCard = (r) => ({
  id: r.id, lesson_id: r.lesson_id, step_index: r.step_index, due: r.due,
  stability: r.stability, difficulty: r.difficulty, elapsed_days: r.elapsed_days,
  scheduled_days: r.scheduled_days, learning_steps: r.learning_steps,
  reps: r.reps, lapses: r.lapses, state: r.state, last_review: r.last_review,
  created_at: r.created_at,
});
function getAllLearnCards(d) {
  return d.prepare('SELECT * FROM learn_cards').all().map(rowLearnCard);
}
function getLearnCard(d, id) {
  const r = d.prepare('SELECT * FROM learn_cards WHERE id = ?').get(id);
  return r ? rowLearnCard(r) : null;
}
function getLearnCardByStep(d, lessonId, stepIndex) {
  const r = d.prepare('SELECT * FROM learn_cards WHERE lesson_id = ? AND step_index = ?').get(lessonId, stepIndex);
  return r ? rowLearnCard(r) : null;
}
function getDueLearnCards(d, { before = new Date().toISOString(), limit = 20 } = {}) {
  return d.prepare('SELECT * FROM learn_cards WHERE due <= ? ORDER BY due LIMIT ?').all(before, limit).map(rowLearnCard);
}
// Upsert keyed on (lesson_id, step_index) — the FSRS Card is 1:1 with a step,
// so re-scheduling the same step always updates the same row.
function upsertLearnCard(d, c) {
  const id = c.id || getLearnCardByStep(d, c.lesson_id, c.step_index)?.id || newId();
  d.prepare(`
    INSERT INTO learn_cards (id, lesson_id, step_index, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(lesson_id, step_index) DO UPDATE SET due = excluded.due, stability = excluded.stability,
      difficulty = excluded.difficulty, elapsed_days = excluded.elapsed_days, scheduled_days = excluded.scheduled_days,
      learning_steps = excluded.learning_steps, reps = excluded.reps, lapses = excluded.lapses,
      state = excluded.state, last_review = excluded.last_review
  `).run(
    id, c.lesson_id, c.step_index, c.due, c.stability || 0, c.difficulty || 0,
    c.elapsed_days || 0, c.scheduled_days || 0, c.learning_steps || 0, c.reps || 0, c.lapses || 0,
    c.state || 0, c.last_review || null, c.created_at || new Date().toISOString(),
  );
  return getLearnCardByStep(d, c.lesson_id, c.step_index);
}

const rowLearnReview = (r) => ({
  id: r.id, card_id: r.card_id, rating: r.rating, state: r.state, due: r.due,
  stability: r.stability, difficulty: r.difficulty, elapsed_days: r.elapsed_days,
  last_elapsed_days: r.last_elapsed_days, scheduled_days: r.scheduled_days, reviewed_at: r.reviewed_at,
});
function getAllLearnReviews(d) {
  return d.prepare('SELECT * FROM learn_reviews ORDER BY reviewed_at').all().map(rowLearnReview);
}
function getLearnReviews(d, cardId) {
  return d.prepare('SELECT * FROM learn_reviews WHERE card_id = ? ORDER BY reviewed_at').all(cardId).map(rowLearnReview);
}
function appendLearnReview(d, rv) {
  const info = d.prepare(`
    INSERT INTO learn_reviews (id, card_id, rating, state, due, stability, difficulty, elapsed_days, last_elapsed_days, scheduled_days, reviewed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    rv.id ?? null, rv.card_id, rv.rating, rv.state, rv.due ?? null,
    rv.stability ?? null, rv.difficulty ?? null, rv.elapsed_days ?? null,
    rv.last_elapsed_days ?? null, rv.scheduled_days ?? null, rv.reviewed_at || new Date().toISOString(),
  );
  return rowLearnReview(d.prepare('SELECT * FROM learn_reviews WHERE id = ?').get(rv.id ?? info.lastInsertRowid));
}

const rowLearnAppliedAction = (r) => ({
  id: r.id, lesson_id: r.lesson_id, action: r.action, params: safeJson(r.params, {}),
  entity_type: r.entity_type, entity_id: r.entity_id, activity_log_id: r.activity_log_id,
  applied_at: r.applied_at, undone_at: r.undone_at,
});
function getAllLearnAppliedActions(d) {
  return d.prepare('SELECT * FROM learn_applied_actions ORDER BY applied_at').all().map(rowLearnAppliedAction);
}
function getLearnAppliedAction(d, id) {
  const r = d.prepare('SELECT * FROM learn_applied_actions WHERE id = ?').get(id);
  return r ? rowLearnAppliedAction(r) : null;
}
function createLearnAppliedAction(d, a) {
  const id = a.id || newId();
  d.prepare(`
    INSERT INTO learn_applied_actions (id, lesson_id, action, params, entity_type, entity_id, activity_log_id, applied_at, undone_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    id, a.lesson_id || null, a.action, jsonText(a.params, {}),
    a.entity_type || null, a.entity_id || null, a.activity_log_id ?? null,
    a.applied_at || new Date().toISOString(), a.undone_at || null,
  );
  return getLearnAppliedAction(d, id);
}
function markLearnAppliedActionUndone(d, id, undoneAt = new Date().toISOString()) {
  const info = d.prepare('UPDATE learn_applied_actions SET undone_at = ? WHERE id = ?').run(undoneAt, id);
  if (!info.changes) throw new Error('Applied action not found');
  return getLearnAppliedAction(d, id);
}

const rowLearnSettings = (r) => ({
  daily_card_cap: r.daily_card_cap, session_minutes_cap: r.session_minutes_cap,
  core_retention: r.core_retention, trivia_retention: r.trivia_retention, updated_at: r.updated_at,
});
function ensureLearnSettings(d) {
  d.prepare("INSERT OR IGNORE INTO learn_settings (id, daily_card_cap, session_minutes_cap, core_retention, trivia_retention, updated_at) VALUES ('default', 20, 7, 0.90, 0.85, ?)")
    .run(new Date().toISOString());
}
function getLearnSettings(d) {
  ensureLearnSettings(d);
  return rowLearnSettings(d.prepare("SELECT * FROM learn_settings WHERE id='default'").get());
}
function setLearnSettings(d, patch = {}) {
  ensureLearnSettings(d);
  const current = getLearnSettings(d);
  const next = { ...current, ...patch };
  d.prepare(`
    UPDATE learn_settings SET daily_card_cap = ?, session_minutes_cap = ?, core_retention = ?, trivia_retention = ?, updated_at = ?
    WHERE id = 'default'
  `).run(next.daily_card_cap, next.session_minutes_cap, next.core_retention, next.trivia_retention, new Date().toISOString());
  return getLearnSettings(d);
}
// Full-blob import (backup/seed/reset): sets to the given value or defaults.
function importLearnSettings(d, s) {
  const v = { daily_card_cap: 20, session_minutes_cap: 7, core_retention: 0.90, trivia_retention: 0.85, ...(s || {}) };
  d.prepare(`
    INSERT INTO learn_settings (id, daily_card_cap, session_minutes_cap, core_retention, trivia_retention, updated_at)
    VALUES ('default', ?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET daily_card_cap = excluded.daily_card_cap, session_minutes_cap = excluded.session_minutes_cap,
      core_retention = excluded.core_retention, trivia_retention = excluded.trivia_retention, updated_at = excluded.updated_at
  `).run(v.daily_card_cap, v.session_minutes_cap, v.core_retention, v.trivia_retention, (s && s.updated_at) || new Date().toISOString());
  return getLearnSettings(d);
}

const rowLearnStreak = (r) => ({
  current_streak: r.current_streak, longest_streak: r.longest_streak,
  last_active_date: r.last_active_date, updated_at: r.updated_at,
});
function ensureLearnStreak(d) {
  d.prepare("INSERT OR IGNORE INTO learn_streak (id, current_streak, longest_streak, last_active_date, updated_at) VALUES ('default', 0, 0, NULL, ?)")
    .run(new Date().toISOString());
}
function getLearnStreak(d) {
  ensureLearnStreak(d);
  return rowLearnStreak(d.prepare("SELECT * FROM learn_streak WHERE id='default'").get());
}
function setLearnStreak(d, patch = {}) {
  ensureLearnStreak(d);
  const current = getLearnStreak(d);
  const next = { ...current, ...patch };
  d.prepare(`
    UPDATE learn_streak SET current_streak = ?, longest_streak = ?, last_active_date = ?, updated_at = ?
    WHERE id = 'default'
  `).run(next.current_streak, next.longest_streak, next.last_active_date, new Date().toISOString());
  return getLearnStreak(d);
}
function importLearnStreak(d, s) {
  const v = { current_streak: 0, longest_streak: 0, last_active_date: null, ...(s || {}) };
  d.prepare(`
    INSERT INTO learn_streak (id, current_streak, longest_streak, last_active_date, updated_at) VALUES ('default', ?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET current_streak = excluded.current_streak, longest_streak = excluded.longest_streak,
      last_active_date = excluded.last_active_date, updated_at = excluded.updated_at
  `).run(v.current_streak, v.longest_streak, v.last_active_date, (s && s.updated_at) || new Date().toISOString());
  return getLearnStreak(d);
}

const rowLearnEvent = (r) => ({
  id: r.id, reason: r.reason, source_type: r.source_type, source_id: r.source_id,
  data: safeJson(r.data, {}), created_at: r.created_at, updated_at: r.updated_at,
});
function getAllLearnEvents(d) {
  return d.prepare('SELECT * FROM learn_events ORDER BY id').all().map(rowLearnEvent);
}
function getLearnEvent(d, reason, sourceType, sourceId) {
  const r = d.prepare('SELECT * FROM learn_events WHERE reason = ? AND source_type = ? AND source_id = ?').get(reason, sourceType, sourceId);
  return r ? rowLearnEvent(r) : null;
}
// Idempotent on (reason, source_type, source_id): a repeat call with the same
// key is a no-op (returns { changed: false }) unless `data` differs, in which
// case the existing row is updated in place — never duplicated.
function upsertLearnEvent(d, { reason, source_type, source_id, data = {} }) {
  const now = new Date().toISOString();
  const existing = getLearnEvent(d, reason, source_type, source_id);
  if (existing && JSON.stringify(existing.data) === JSON.stringify(data)) {
    return { changed: false, event: existing };
  }
  d.prepare(`
    INSERT INTO learn_events (reason, source_type, source_id, data, created_at, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(reason, source_type, source_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(reason, source_type, source_id, jsonText(data, {}), now, now);
  return { changed: true, event: getLearnEvent(d, reason, source_type, source_id) };
}
function importLearnEvent(d, e) {
  d.prepare(`
    INSERT INTO learn_events (reason, source_type, source_id, data, created_at, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(reason, source_type, source_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(e.reason, e.source_type, e.source_id, jsonText(e.data, {}), e.created_at || new Date().toISOString(), e.updated_at || new Date().toISOString());
}

// ── activity log (generic undo ledger; first writer is server/learn/apply.js) ──

const rowActivityLog = (r) => ({
  id: r.id, source: r.source, action: r.action, entity_type: r.entity_type, entity_id: r.entity_id,
  before: safeJson(r.before, null), after: safeJson(r.after, null),
  created_at: r.created_at, undone_at: r.undone_at,
});
function getAllActivityLog(d) {
  return d.prepare('SELECT * FROM activity_log ORDER BY id').all().map(rowActivityLog);
}
function getActivityLogEntry(d, id) {
  const r = d.prepare('SELECT * FROM activity_log WHERE id = ?').get(id);
  return r ? rowActivityLog(r) : null;
}
function createActivityLogEntry(d, e) {
  const info = d.prepare(`
    INSERT INTO activity_log (id, source, action, entity_type, entity_id, before, after, created_at, undone_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    e.id ?? null, e.source, e.action, e.entity_type, e.entity_id ?? null,
    e.before === undefined ? null : jsonText(e.before, null), e.after === undefined ? null : jsonText(e.after, null),
    e.created_at || new Date().toISOString(), e.undone_at || null,
  );
  return getActivityLogEntry(d, e.id ?? info.lastInsertRowid);
}
function markActivityLogUndone(d, id, undoneAt = new Date().toISOString()) {
  const info = d.prepare('UPDATE activity_log SET undone_at = ? WHERE id = ?').run(undoneAt, id);
  if (!info.changes) throw new Error('Activity log entry not found');
  return getActivityLogEntry(d, id);
}

// ── full-blob export / import (backup, seed, reset only) ──────────────────────

const BLOB_KEYS = [
  'accounts', 'transactions', 'categories', 'budgets', 'goals', 'rules', 'holdings', 'networth_snapshots', 'recurring', 'http_cache',
  'paper_account', 'paper_positions', 'paper_trades', 'paper_journal', 'agent_events', 'decisions', 'closes', 'watchlist', 'import_log',
  'price_cache', 'alert_rules', 'price_bars', 'strategies', 'backtest_runs',
  'learn_progress', 'learn_step_progress', 'learn_cards', 'learn_reviews', 'learn_applied_actions',
  'learn_settings', 'learn_streak', 'learn_events', 'activity_log',
];

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
    http_cache: getAllHttpCache(d),
    paper_account: getPaperAccount(d),
    paper_positions: getPaperPositions(d),
    paper_trades: getPaperTrades(d),
    paper_journal: getPaperJournal(d),
    agent_events: getAgentEvents(d),
    decisions: getDecisions(d),
    closes: getCloses(d),
    watchlist: getWatchlist(d),
    import_log: getImportLog(d),
    price_cache: getPriceCache(d),
    alert_rules: getAlertRules(d),
    price_bars: d.prepare('SELECT * FROM price_bars ORDER BY symbol, date').all().map(rowPriceBar),
    strategies: getStrategies(d),
    backtest_runs: getBacktestRuns(d, { limit: 1e9 }),
    learn_progress: getAllLearnProgress(d),
    learn_step_progress: getAllLearnStepProgress(d),
    learn_cards: getAllLearnCards(d),
    learn_reviews: getAllLearnReviews(d),
    learn_applied_actions: getAllLearnAppliedActions(d),
    learn_settings: getLearnSettings(d),
    learn_streak: getLearnStreak(d),
    learn_events: getAllLearnEvents(d),
    activity_log: getAllActivityLog(d),
  };
  // Loose top-level keys round-tripped verbatim via meta.
  const extras = d.prepare("SELECT value FROM meta WHERE key='extras'").get();
  if (extras && extras.value) {
    try { Object.assign(out, JSON.parse(extras.value)); } catch { /* ignore */ }
  }
  return out;
}

// Tables writeAll manages, grouped so FK-linked tables are always replaced
// together. The money ledger group is always replaced; in `partial` mode
// (import / restore) every other group is replaced only when the blob carries
// at least one of its keys — so importing an older export, which predates the
// paper-trading, backtest and learn tables, no longer silently wipes them.
const WRITE_GROUPS = [
  { keys: ['http_cache'], tables: ['http_cache'] },
  { keys: ['paper_account', 'paper_positions', 'paper_trades', 'paper_journal', 'agent_events', 'decisions', 'closes'],
    tables: ['paper_journal', 'paper_trades', 'paper_positions', 'agent_events', 'closes', 'decisions'] },
  { keys: ['watchlist', 'alert_rules'], tables: ['watchlist', 'alert_rules'] },
  { keys: ['import_log'], tables: ['import_log'] },
  { keys: ['price_cache'], tables: ['price_cache'] },
  { keys: ['strategies', 'backtest_runs', 'price_bars'], tables: ['backtest_runs', 'strategies', 'price_bars'] },
  { keys: ['learn_progress', 'learn_step_progress', 'learn_cards', 'learn_reviews', 'learn_applied_actions',
    'learn_settings', 'learn_streak', 'learn_events', 'activity_log'],
    tables: ['learn_reviews', 'learn_cards', 'learn_step_progress', 'learn_progress', 'learn_applied_actions', 'activity_log', 'learn_events'] },
];
const LEDGER_TABLES = ['transactions', 'holdings', 'accounts', 'categories', 'budgets', 'goals', 'rules', 'networth_snapshots', 'recurring'];

// Replace the database contents with `blob`. Default is a full-state replace
// (seed / reset / restore of a complete backup). { partial: true } keeps any
// non-ledger group the blob doesn't mention.
function writeAll(d, blob, { partial = false } = {}) {
  const arr = (k) => (Array.isArray(blob[k]) ? blob[k] : []);
  const groups = WRITE_GROUPS.filter((g) => !partial || g.keys.some((k) => blob[k] !== undefined));
  const replacing = (key) => groups.some((g) => g.keys.includes(key));
  const run = d.transaction(() => {
    // FK-safe delete order (children first).
    for (const t of [...LEDGER_TABLES, ...groups.flatMap((g) => g.tables)]) {
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
      // Restores are faithful: no sign normalization of the stored balance.
      insertAccountRow(d, actualId, a, toCents(a.balance) - (sums[a.id] || 0));
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

    if (replacing('http_cache')) for (const c of arr('http_cache')) upsertHttpCache(d, c);

    if (replacing('paper_account')) {
      // A replaced paper group is a full state: paper_account is (re)set to
      // the given value, or a fresh $100k default when absent (e.g.
      // repo.emptyData()) — never left as whatever a prior DB state had.
      importPaperAccount(d, blob.paper_account || { capital: 100000, starting_capital: 100000 });
      for (const dec of arr('decisions')) createDecision(d, dec);
      for (const c of arr('closes')) createClose(d, c);
      for (const p of arr('paper_positions')) createPaperPosition(d, p);
      for (const t of arr('paper_trades')) createPaperTrade(d, t);
      for (const j of arr('paper_journal')) createPaperJournalEntry(d, j);
      for (const e of arr('agent_events')) appendAgentEvent(d, e);
    }
    if (replacing('watchlist')) {
      for (const w of arr('watchlist')) createWatchlistItem(d, w);
      for (const a of arr('alert_rules')) createAlertRule(d, a);
    }
    if (replacing('import_log')) for (const i of arr('import_log')) markImported(d, i.source, i.source_id, i.imported_at);
    if (replacing('price_cache')) for (const p of arr('price_cache')) upsertPriceCache(d, p);
    if (replacing('strategies')) {
      for (const s of arr('strategies')) createStrategy(d, s);
      for (const r of arr('backtest_runs')) createBacktestRun(d, r);
      for (const bySymbol of Object.entries(
        arr('price_bars').reduce((acc, b) => { (acc[b.symbol] = acc[b.symbol] || []).push(b); return acc; }, {}),
      )) upsertPriceBars(d, bySymbol[0], bySymbol[1], bySymbol[1][0]?.source || 'csv');
    }

    if (replacing('learn_progress')) {
      // Learn engine (Sprint D). FK order: activity_log before learn_applied_actions
      // (activity_log_id FK), learn_cards before learn_reviews (card_id FK).
      for (const a of arr('activity_log')) createActivityLogEntry(d, a);
      for (const p of arr('learn_progress')) importLearnProgress(d, p);
      for (const sp of arr('learn_step_progress')) importLearnStepProgress(d, sp);
      for (const c of arr('learn_cards')) upsertLearnCard(d, c);
      for (const rv of arr('learn_reviews')) appendLearnReview(d, rv);
      for (const aa of arr('learn_applied_actions')) createLearnAppliedAction(d, aa);
      for (const e of arr('learn_events')) importLearnEvent(d, e);
      // Singletons — like paper_account, (re)set to the given value or a
      // fresh default when absent.
      importLearnSettings(d, blob.learn_settings);
      importLearnStreak(d, blob.learn_streak);
    }

    const extras = {};
    for (const k of Object.keys(blob)) if (!BLOB_KEYS.includes(k)) extras[k] = blob[k];
    d.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('extras', ?)").run(JSON.stringify(extras));
  });
  run();
}

// ── generic meta (small JSON blobs keyed by name) ───────────────────────────
function getMeta(d, key) {
  const row = d.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

function setMeta(d, key, value) {
  d.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
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
  newId, defaultCategories, emptyData, readAll, writeAll, getSettings, setSettings, getMeta, setMeta,
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
  getHttpCacheEntry, getAllHttpCache, upsertHttpCache,
  getPaperAccount, importPaperAccount, adjustPaperAccountCapital,
  getPaperPositions, getPaperPosition, createPaperPosition, deletePaperPosition,
  getPaperTrades, getPaperTrade, createPaperTrade, updatePaperTrade,
  getPaperJournal, createPaperJournalEntry,
  getAgentEvents, appendAgentEvent,
  getDecisions, getDecision, createDecision, updateDecisionStatus,
  getCloses, createClose,
  getWatchlist, createWatchlistItem, deleteWatchlistItem,
  getImportLog, hasImported, markImported,
  getPriceCache, getPriceCacheEntry, upsertPriceCache,
  getAlertRules, getAlertRule, createAlertRule, updateAlertRule, deleteAlertRule,
  getPriceBars, getPriceBarSymbols, getPriceBarFingerprint, upsertPriceBars, deletePriceBars,
  getStrategies, getStrategy, createStrategy, deleteStrategy,
  getBacktestRuns, getBacktestRun, getBacktestRunsByHash, createBacktestRun,
  getAllLearnProgress, getLearnProgress, upsertLearnProgress, importLearnProgress,
  getLearnStepProgress, getAllLearnStepProgress, upsertLearnStepProgress, importLearnStepProgress,
  getAllLearnCards, getLearnCard, getLearnCardByStep, getDueLearnCards, upsertLearnCard,
  getAllLearnReviews, getLearnReviews, appendLearnReview,
  getAllLearnAppliedActions, getLearnAppliedAction, createLearnAppliedAction, markLearnAppliedActionUndone,
  getLearnSettings, setLearnSettings, importLearnSettings,
  getLearnStreak, setLearnStreak, importLearnStreak,
  getAllLearnEvents, getLearnEvent, upsertLearnEvent, importLearnEvent,
  getAllActivityLog, getActivityLogEntry, createActivityLogEntry, markActivityLogUndone,
};
