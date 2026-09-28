'use strict';

// Automatic local backups. Runs in the forked server process (no electron APIs).
// Every 24h (and once on startup) snapshot the full data blob as JSON plus a
// live SQLite copy into <DATA_DIR>/backups, keeping the newest 30 days.
//
// Separately, snapshotBeforeChange() writes a "pre-<reason>-<time>.db" safety
// copy right before anything that replaces data wholesale (reset, load sample,
// import, restore, and "Back up now" replacing today's files), keeping the
// newest 20. Any of them can be restored like a daily backup.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { db, DATA_DIR } = require('../db/connection');
const repo = require('../db/repo');
const store = require('../money/store');

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const RETENTION_DAYS = 30;
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const NAME_RE = /^backup-(\d{4}-\d{2}-\d{2})\.(json|db)$/;
const SNAPSHOT_RE = /^pre-([a-z-]+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3})\.db$/;
const SNAPSHOT_KEEP = 20;

// Local day key — toISOString() is UTC, so an evening backup in Arizona was
// named (and deduped against) tomorrow.
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Local timestamp for snapshot file names: 2026-09-28T14-05-09-123.
function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

// A consistent SQLite copy, synchronously (VACUUM INTO), so it's taken before
// the caller's write and never depends on readData() — which a single corrupt
// row can make throw. Returns the snapshot id, or null when there was nothing
// to protect.
function snapshotBeforeChange(reason) {
  if (store.isEmpty()) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const id = `pre-${reason}-${stamp()}`;
  db().prepare('VACUUM INTO ?').run(path.join(BACKUP_DIR, `${id}.db`));
  pruneSnapshots();
  return id;
}

function pruneSnapshots() {
  const snaps = fs.readdirSync(BACKUP_DIR).filter((f) => SNAPSHOT_RE.test(f)).sort().reverse();
  for (const f of snaps.slice(SNAPSHOT_KEEP)) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch { /* best effort */ }
  }
}

async function runBackup({ force = false } = {}) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const date = today();
  const jsonPath = path.join(BACKUP_DIR, `backup-${date}.json`);
  const dbPath = path.join(BACKUP_DIR, `backup-${date}.db`);

  // "Back up now" used to overwrite today's files — after a restore, that
  // erased the only copy of the state from earlier today. Keep it as a
  // snapshot instead.
  if (force && fs.existsSync(dbPath)) {
    fs.renameSync(dbPath, path.join(BACKUP_DIR, `pre-backup-now-${stamp()}.db`));
    pruneSnapshots();
  }

  // SQLite copy first: it can't be broken by a bad row the way building the
  // JSON can, so a data problem never costs the day's backup.
  let dbError = null;
  if (force || !fs.existsSync(dbPath)) {
    try {
      await db().backup(dbPath); // online backup — safe while the DB is in use
    } catch (e) {
      dbError = e;
      console.error('[MMM backup] sqlite copy failed:', e.message);
    }
  }
  if (force || !fs.existsSync(jsonPath)) {
    try {
      const payload = {
        format: 'mmm-backup@1',
        created: new Date().toISOString(),
        data: store.readData(),
        settings: repo.getSettings(db()),
      };
      fs.writeFileSync(jsonPath, JSON.stringify(payload));
    } catch (e) {
      console.error('[MMM backup] json snapshot failed (the .db copy stands):', e.message);
      if (dbError) throw e;
    }
  }
  prune();
  return { date, jsonPath, dbPath };
}

function prune() {
  const byDate = new Map();
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    const m = NAME_RE.exec(f);
    if (!m) continue;
    if (!byDate.has(m[1])) byDate.set(m[1], []);
    byDate.get(m[1]).push(f);
  }
  const dates = [...byDate.keys()].sort().reverse();
  for (const date of dates.slice(RETENTION_DAYS)) {
    for (const f of byDate.get(date)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch { /* best effort */ }
    }
  }
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  const byDate = new Map();
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    const m = NAME_RE.exec(f);
    if (!m) continue;
    const stat = fs.statSync(path.join(BACKUP_DIR, f));
    const entry = byDate.get(m[1]) || { date: m[1], size: 0, created: stat.mtime.toISOString(), hasJson: false, hasDb: false };
    entry.size += stat.size;
    if (m[2] === 'json') entry.hasJson = true;
    if (m[2] === 'db') entry.hasDb = true;
    if (stat.mtime.toISOString() > entry.created) entry.created = stat.mtime.toISOString();
    byDate.set(m[1], entry);
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function listSnapshots() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .map((f) => SNAPSHOT_RE.exec(f))
    .filter(Boolean)
    .map((m) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, m[0]));
      return { id: m[0].replace(/\.db$/, ''), reason: m[1], created: stat.mtime.toISOString(), size: stat.size };
    })
    .sort((a, b) => b.id.localeCompare(a.id));
}

// Restore from the JSON snapshot for a given date. Returns counts. The current
// state is snapshotted first, and tables the backup doesn't carry are kept.
function restoreBackup(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('Invalid backup date.');
  const jsonPath = path.join(BACKUP_DIR, `backup-${date}.json`);
  if (!fs.existsSync(jsonPath)) throw new Error(`No backup found for ${date}.`);
  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const data = parsed.format === 'mmm-backup@1' ? parsed.data : parsed;
  if (!data || !Array.isArray(data.accounts) || !Array.isArray(data.transactions)) {
    throw new Error('Backup file is not a valid MMM snapshot.');
  }
  const safety = snapshotBeforeChange('restore');
  store.writeData(data, { partial: true });
  if (parsed.format === 'mmm-backup@1' && parsed.settings && typeof parsed.settings === 'object') {
    repo.setSettings(db(), parsed.settings);
  }
  return {
    restored: true,
    date,
    safety,
    counts: { accounts: data.accounts.length, transactions: data.transactions.length },
  };
}

// Restore a pre-change snapshot (.db): read it with the same repo code that
// reads the live DB, then write that state back.
function restoreSnapshot(id) {
  const file = `${id}.db`;
  if (!SNAPSHOT_RE.test(file)) throw new Error('Invalid snapshot id.');
  const full = path.join(BACKUP_DIR, file);
  if (!fs.existsSync(full)) throw new Error(`No snapshot named ${id}.`);
  // Read through a scratch copy: some repo getters insert default rows (the
  // paper account, learn settings), and the snapshot itself must stay as-is.
  const scratch = path.join(BACKUP_DIR, `.reading-${process.pid}-${Date.now()}.db`);
  fs.copyFileSync(full, scratch);
  let data; let settings;
  const snap = new Database(scratch, { fileMustExist: true });
  try {
    data = repo.readAll(snap);
    settings = repo.getSettings(snap);
  } finally {
    snap.close();
    for (const f of [scratch, `${scratch}-wal`, `${scratch}-shm`, `${scratch}-journal`]) {
      try { fs.unlinkSync(f); } catch { /* not present */ }
    }
  }
  const safety = snapshotBeforeChange('restore');
  store.writeData(data);
  if (settings && typeof settings === 'object') repo.setSettings(db(), settings);
  return {
    restored: true,
    snapshot: id,
    safety,
    counts: { accounts: data.accounts.length, transactions: data.transactions.length },
  };
}

let timer = null;

function startBackupScheduler() {
  const kickoff = () => runBackup().catch((e) => console.error('[MMM backup] failed:', e.message));
  kickoff();
  timer = setInterval(kickoff, INTERVAL_MS);
  timer.unref(); // never hold the process open
  console.log('[MMM backup] scheduler started —', BACKUP_DIR);
}

module.exports = {
  startBackupScheduler, runBackup, listBackups, restoreBackup,
  snapshotBeforeChange, listSnapshots, restoreSnapshot, BACKUP_DIR,
};
