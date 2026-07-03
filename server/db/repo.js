'use strict';

// Lossless repository: round-trips the legacy data.json blob shape to/from
// normalized SQLite tables. store.js's readData()/writeData() delegate here, so
// every existing high-level function keeps working unchanged (Phase 0). Per-row
// query methods get added in Phase 2 when the editable transactions table needs
// them — for now the whole blob is read/written, matching the old JSON behavior.

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
    holdings: [],
    networth_snapshots: [],
  };
}

// table -> column order used for INSERT (and the shape SELECT * returns).
const TABLES = {
  accounts:           ['id', 'name', 'type', 'balance', 'institution', 'currency', 'status', 'created_at', 'custom'],
  categories:         ['id', 'name', 'group', 'color', 'icon'],
  transactions:       ['id', 'account_id', 'date', 'amount', 'payee', 'category_id', 'tags', 'note', 'source', 'cleared', 'custom'],
  budgets:            ['id', 'category_id', 'period', 'limit', 'rollover'],
  goals:              ['id', 'name', 'target', 'current', 'linked_account_id', 'target_date', 'template', 'monthly_contribution', 'custom'],
  rules:              ['id', 'match', 'category_id', 'tag'],
  deductions:         ['id', 'category', 'amount', 'note', 'date'],
  holdings:           ['id', 'account_id', 'symbol', 'shares', 'cost_basis', 'current_price', 'price_source', 'updated_at'],
  networth_snapshots: ['date', 'assets', 'liabilities', 'net'],
};
const KNOWN = new Set(Object.keys(TABLES));

function safeJson(s, fallback) {
  try { const v = JSON.parse(s); return v == null ? fallback : v; } catch { return fallback; }
}

function deserializeRow(table, r) {
  if (table === 'transactions') return { ...r, tags: safeJson(r.tags, []), cleared: !!r.cleared, custom: safeJson(r.custom, {}) };
  if (table === 'budgets') return { ...r, rollover: !!r.rollover };
  if (table === 'goals' || table === 'accounts') return { ...r, custom: safeJson(r.custom, {}) };
  return r;
}

function serializeValue(table, col, val) {
  if (table === 'transactions' && col === 'tags') return JSON.stringify(Array.isArray(val) ? val : []);
  if (col === 'cleared' || col === 'rollover') return val ? 1 : 0;
  if (val === undefined) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (val !== null && typeof val === 'object') return JSON.stringify(val);
  return val;
}

function readAll(d) {
  const out = {};
  for (const table of Object.keys(TABLES)) {
    out[table] = d.prepare(`SELECT * FROM ${table}`).all().map((r) => deserializeRow(table, r));
  }
  // Loose top-level keys (e.g. `recurring`) round-tripped verbatim via meta.
  const extras = d.prepare("SELECT value FROM meta WHERE key='extras'").get();
  if (extras && extras.value) {
    try { Object.assign(out, JSON.parse(extras.value)); } catch { /* ignore */ }
  }
  return out;
}

function writeAll(d, data) {
  const run = d.transaction((blob) => {
    for (const [table, cols] of Object.entries(TABLES)) {
      d.prepare(`DELETE FROM ${table}`).run();
      const rows = Array.isArray(blob[table]) ? blob[table] : [];
      if (!rows.length) continue;
      const colSql = cols.map((c) => `"${c}"`).join(', ');
      const placeholders = cols.map(() => '?').join(', ');
      const stmt = d.prepare(`INSERT INTO ${table} (${colSql}) VALUES (${placeholders})`);
      for (const row of rows) stmt.run(...cols.map((c) => serializeValue(table, c, row[c])));
    }
    const extras = {};
    for (const k of Object.keys(blob)) if (!KNOWN.has(k)) extras[k] = blob[k];
    d.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('extras', ?)").run(JSON.stringify(extras));
  });
  run(data);
}

// ── User settings (theme, dashboards, custom fields/sections, etc.) ──────────
// Stored as a single JSON object under meta['settings'], independent of the
// money data blob. Shallow top-level merge on write.
function getSettings(d) {
  const row = d.prepare("SELECT value FROM meta WHERE key='settings'").get();
  try { return row && row.value ? JSON.parse(row.value) : {}; } catch { return {}; }
}

function setSettings(d, partial) {
  const next = { ...getSettings(d), ...(partial && typeof partial === 'object' ? partial : {}) };
  d.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('settings', ?)").run(JSON.stringify(next));
  return next;
}

module.exports = { defaultCategories, emptyData, readAll, writeAll, getSettings, setSettings, TABLES };
