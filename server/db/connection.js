'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const repo = require('./repo');

const MONEY_DIR = path.join(__dirname, '..', 'store', 'money');
const DB_FILE = process.env.MMM_DB_FILE || path.join(MONEY_DIR, 'mmm.db');
const JSON_FILE = path.join(MONEY_DIR, 'data.json');
const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
const SCHEMA_VERSION = '1';

let _db = null;

// Lazily open (and one-time initialize) the SQLite database. Singleton.
function db() {
  if (_db) return _db;
  fs.mkdirSync(MONEY_DIR, { recursive: true });
  _db = new Database(DB_FILE);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(SCHEMA);
  ensureCustomColumns(_db);
  initialize(_db);
  return _db;
}

// Idempotent migration: CREATE TABLE IF NOT EXISTS never alters an existing table,
// so add the `custom` JSON column to older DBs that predate custom fields.
function ensureCustomColumns(d) {
  for (const table of ['transactions', 'goals', 'accounts']) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === 'custom')) {
      d.exec(`ALTER TABLE ${table} ADD COLUMN custom TEXT DEFAULT '{}'`);
    }
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

module.exports = { db };
