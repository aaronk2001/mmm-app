'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const repo = require('./repo');

// ASSET_DIR holds bundled read-only files (glossary.json, sample.money.json)
// and doubles as the dev-mode data dir. Packaged builds pass MMM_DATA_DIR
// (%APPDATA%\mmm) so user data lives outside the app folder and survives
// rebuilds/updates.
const ASSET_DIR = path.join(__dirname, '..', 'store', 'money');

// Sprint E, Track 1: MMM_DATA_DIR used to silently fall back to ASSET_DIR —
// the real in-repo dev database — whenever it wasn't set. That fallback fired
// for anything that required this module without knowing about the env var
// (a `node -e` one-liner, a stray sanity-check script) and once wiped the dev
// DB outright. The fallback is still here —
// npm run dev / npm start need it — but it now requires an explicit opt-in
// (MMM_ALLOW_DEV_DB) instead of firing implicitly. electron.js sets that
// opt-in itself when launching the dev server; tests/setup.mjs and the
// packaged app both set MMM_DATA_DIR directly and never touch this branch.
const DEV_DB_OPT_IN = 'MMM_ALLOW_DEV_DB';

function resolveDataDir() {
  if (process.env.MMM_DATA_DIR) return process.env.MMM_DATA_DIR;
  if (process.env[DEV_DB_OPT_IN]) return ASSET_DIR;
  throw new Error(
    `MMM_DATA_DIR is not set. Refusing to fall back to the in-repo dev database at ${ASSET_DIR} ` +
    `implicitly — that footgun has wiped the dev DB before. ` +
    `Set MMM_DATA_DIR explicitly (a temp dir for a one-off script, %APPDATA%\\mmm for the packaged ` +
    `app), or set ${DEV_DB_OPT_IN}=1 if you deliberately want the in-repo dev database ` +
    `(npm run dev / npm start do this automatically).`
  );
}

const DATA_DIR = resolveDataDir();
const DB_FILE = process.env.MMM_DB_FILE || path.join(DATA_DIR, 'mmm.db');
// Legacy pre-SQLite blob. Resolved from DATA_DIR, not ASSET_DIR: only the dev
// dir can hold one, and reading ASSET_DIR imported the dev data.json into (and
// wrote a .bak beside it from) every fresh temp data dir.
const JSON_FILE = path.join(DATA_DIR, 'data.json');
const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
const SCHEMA_VERSION = '2';

let _db = null;


// Lazily open (and one-time initialize) the SQLite database. Singleton.
function db() {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_FILE);
  _db.pragma('journal_mode = WAL');
  migrateSchema(_db); // may drop/recreate tables — runs before foreign_keys ON
  _db.pragma('foreign_keys = ON');
  _db.exec(SCHEMA);
  applyAdditiveMigrations(_db);
  initialize(_db);
  scheduleMaintenance(_db);
  return _db;
}

const toCents = (v) => Math.round((parseFloat(v) || 0) * 100);

// v1 -> v2: money columns move from REAL dollars to INTEGER cents, account
// balances become derived (opening_balance_cents + SUM of transactions), and
// declared recurring moves from meta extras into its own table. Reads the old
// rows, drops the data tables, recreates them from schema.sql, reinserts.
function migrateSchema(d) {
  // Brand-new DB: no tables at all yet — nothing to migrate; db() execs the
  // schema right after this and initialize() stamps v2.
  const hasMeta = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").get();
  if (!hasMeta) return;
  const ver = d.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value;
  if (ver !== '1') return; // already v2

  const old = {};
  for (const t of ['accounts', 'categories', 'transactions', 'budgets', 'goals', 'rules', 'holdings', 'networth_snapshots']) {
    try { old[t] = d.prepare(`SELECT * FROM ${t}`).all(); } catch { old[t] = []; }
  }
  let extras = {};
  try {
    const r = d.prepare("SELECT value FROM meta WHERE key='extras'").get();
    extras = r && r.value ? JSON.parse(r.value) : {};
  } catch { /* ignore */ }
  const declared = Array.isArray(extras.recurring) ? extras.recurring : [];

  const run = d.transaction(() => {
    for (const t of ['transactions', 'holdings', 'accounts', 'categories', 'budgets', 'goals', 'rules', 'networth_snapshots', 'deductions', 'recurring']) {
      d.exec(`DROP TABLE IF EXISTS ${t}`);
    }
    d.exec(SCHEMA);

    // Per-account transaction sums, in cents, matching how balances will derive.
    const txnSum = {};
    for (const t of old.transactions) {
      txnSum[t.account_id] = (txnSum[t.account_id] || 0) + toCents(t.amount);
    }

    const ins = (sql) => d.prepare(sql);
    const accIns = ins('INSERT INTO accounts (id, name, type, opening_balance_cents, institution, currency, status, created_at, custom) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const a of old.accounts) {
      accIns.run(a.id, a.name, a.type, toCents(a.balance) - (txnSum[a.id] || 0), a.institution || '', a.currency || 'USD', a.status || 'active', a.created_at || null, a.custom || '{}');
    }
    const catIns = ins('INSERT INTO categories (id, name, "group", color, icon) VALUES (?,?,?,?,?)');
    for (const c of old.categories) catIns.run(c.id, c.name, c.group, c.color, c.icon);

    const txnIns = ins('INSERT INTO transactions (id, account_id, date, amount_cents, payee, category_id, tags, note, source, cleared, custom) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    for (const t of old.transactions) {
      txnIns.run(t.id, t.account_id, String(t.date).slice(0, 10), toCents(t.amount), t.payee || '', t.category_id || null, t.tags || '[]', t.note || '', t.source || 'manual', t.cleared ? 1 : 0, t.custom || '{}');
    }
    const budIns = ins('INSERT INTO budgets (id, category_id, period, limit_cents, rollover) VALUES (?,?,?,?,?)');
    for (const b of old.budgets) budIns.run(b.id, b.category_id, b.period, toCents(b.limit), b.rollover ? 1 : 0);

    const goalIns = ins('INSERT INTO goals (id, name, target_cents, current_cents, linked_account_id, target_date, template, monthly_contribution_cents, custom) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const g of old.goals) {
      goalIns.run(g.id, g.name, toCents(g.target), toCents(g.current), g.linked_account_id || null, g.target_date || null, g.template || null, g.monthly_contribution == null ? null : toCents(g.monthly_contribution), g.custom || '{}');
    }
    const ruleIns = ins('INSERT INTO rules (id, match, category_id, tag) VALUES (?,?,?,?)');
    for (const r of old.rules) ruleIns.run(r.id, r.match, r.category_id, r.tag || null);

    const holdIns = ins('INSERT INTO holdings (id, account_id, symbol, shares, cost_basis_cents, current_price_cents, price_source, updated_at) VALUES (?,?,?,?,?,?,?,?)');
    for (const h of old.holdings) holdIns.run(h.id, h.account_id || null, h.symbol, h.shares || 0, toCents(h.cost_basis), toCents(h.current_price), h.price_source || 'manual', h.updated_at || null);

    const snapIns = ins('INSERT OR REPLACE INTO networth_snapshots (date, assets_cents, liabilities_cents, net_cents) VALUES (?,?,?,?)');
    for (const s of old.networth_snapshots) snapIns.run(s.date, toCents(s.assets), toCents(s.liabilities), toCents(s.net));

    const recIns = ins('INSERT INTO recurring (id, payee, amount_cents, cadence, kind, next_date, note) VALUES (?,?,?,?,?,?,?)');
    for (const r of declared) {
      recIns.run(r.id || crypto.randomUUID(), r.payee || '', toCents(r.amount), r.cadence || 'monthly', r.kind || 'bill', r.next_date || null, r.note || '');
    }

    delete extras.recurring;
    d.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('extras', ?)").run(JSON.stringify(extras));
    d.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '2')").run();
  });
  run();
  console.log(`[MMM db] migrated schema v1 -> v2 (${old.transactions.length} txns, ${old.accounts.length} accounts, cents + derived balances)`);
}

// Additive column adds for already-migrated (v2) DBs. schema.sql uses
// CREATE TABLE IF NOT EXISTS, so new columns on existing tables must be ALTERed
// in by hand. Each add is guarded by a table_info check, so this is idempotent.
function applyAdditiveMigrations(d) {
  const hasCol = (table, col) =>
    d.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!hasCol('recurring', 'account_id')) {
    d.exec('ALTER TABLE recurring ADD COLUMN account_id TEXT');
    console.log('[MMM db] added recurring.account_id');
  }
}

// First run only: import the legacy data.json (and back it up), else seed empty.
function initialize(d) {
  const ver = d.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
  if (ver) return;
  if (fs.existsSync(JSON_FILE)) {
    try {
      const json = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
      repo.writeAll(d, json);
      try { fs.copyFileSync(JSON_FILE, JSON_FILE + '.migrated.bak'); } catch { /* best effort */ }
      console.log('[MMM db] migrated data.json -> SQLite');
    } catch (e) {
      repo.writeAll(d, repo.emptyData());
      console.error('[MMM db] data.json unreadable, seeded empty:', e.message);
    }
  } else {
    repo.writeAll(d, repo.emptyData());
  }
  d.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(SCHEMA_VERSION);
}

// Merge the WAL back into the main file so it never grows unbounded on a
// long-running app. Also exposed for the shutdown path in server/index.js.
function checkpoint(mode = 'RESTART') {
  try {
    if (_db) _db.pragma(`wal_checkpoint(${mode})`);
  } catch (e) {
    console.warn('[MMM db] checkpoint failed:', e.message);
  }
}

function scheduleMaintenance(d) {
  const timer = setInterval(() => {
    checkpoint('RESTART');
    try { d.pragma('optimize'); } catch { /* best effort */ }
  }, 6 * 60 * 60 * 1000);
  timer.unref();
}

module.exports = { db, checkpoint, DATA_DIR, DB_FILE, ASSET_DIR };
