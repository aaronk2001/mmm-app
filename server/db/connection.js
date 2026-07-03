'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const repo = require('./repo');

// ASSET_DIR holds bundled read-only files (glossary.json, sample.money.json)
// and doubles as the dev-mode data dir. Packaged builds pass MMM_DATA_DIR
// (%APPDATA%\mmm) so user data lives outside the app folder and survives
// rebuilds/updates.
const ASSET_DIR = path.join(__dirname, '..', 'store', 'money');
const DATA_DIR = process.env.MMM_DATA_DIR || ASSET_DIR;
const DB_FILE = process.env.MMM_DB_FILE || path.join(DATA_DIR, 'mmm.db');
const JSON_FILE = path.join(ASSET_DIR, 'data.json');
const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
const SCHEMA_VERSION = '1';

let _db = null;

// One-time relocation: DBs created before MMM_DATA_DIR existed live next to the
// bundled assets (inside the app folder) and would be lost on rebuild. Merge the
// WAL into the main file, then copy it to the new home.
function migrateLegacyDb() {
  const legacy = path.join(ASSET_DIR, 'mmm.db');
  if (path.resolve(DB_FILE) === path.resolve(legacy)) return;
  if (fs.existsSync(DB_FILE) || !fs.existsSync(legacy)) return;
  try {
    try {
      const old = new Database(legacy);
      old.pragma('wal_checkpoint(TRUNCATE)');
      old.close();
    } catch { /* best effort — copy whatever is there */ }
    fs.copyFileSync(legacy, DB_FILE);
    console.log('[MMM db] migrated legacy mmm.db ->', DB_FILE);
  } catch (e) {
    console.error('[MMM db] legacy DB migration failed:', e.message);
  }
}

// Lazily open (and one-time initialize) the SQLite database. Singleton.
function db() {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  migrateLegacyDb();
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

module.exports = { db, DATA_DIR, DB_FILE, ASSET_DIR };
