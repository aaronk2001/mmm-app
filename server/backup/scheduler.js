'use strict';

// Automatic local backups. Runs in the forked server process (no electron APIs).
// Every 24h (and once on startup) snapshot the full data blob as JSON plus a
// live SQLite copy into <DATA_DIR>/backups, keeping the newest 30 days.

const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('../db/connection');
const repo = require('../db/repo');
const store = require('../money/store');

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const RETENTION_DAYS = 30;
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const NAME_RE = /^backup-(\d{4}-\d{2}-\d{2})\.(json|db)$/;

// Local day key — toISOString() is UTC, so an evening backup in Arizona was
// named (and deduped against) tomorrow.
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function runBackup({ force = false } = {}) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const date = today();
  const jsonPath = path.join(BACKUP_DIR, `backup-${date}.json`);
  const dbPath = path.join(BACKUP_DIR, `backup-${date}.db`);

  if (force || !fs.existsSync(jsonPath)) {
    const payload = {
      format: 'mmm-backup@1',
      created: new Date().toISOString(),
      data: store.readData(),
      settings: repo.getSettings(db()),
    };
    fs.writeFileSync(jsonPath, JSON.stringify(payload));
  }
  if (force || !fs.existsSync(dbPath)) {
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      await db().backup(dbPath); // online backup — safe while the DB is in use
    } catch (e) {
      console.error('[MMM backup] sqlite copy failed:', e.message);
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

// Restore from the JSON snapshot for a given date. Returns counts.
function restoreBackup(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('Invalid backup date.');
  const jsonPath = path.join(BACKUP_DIR, `backup-${date}.json`);
  if (!fs.existsSync(jsonPath)) throw new Error(`No backup found for ${date}.`);
  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const data = parsed.format === 'mmm-backup@1' ? parsed.data : parsed;
  if (!data || !Array.isArray(data.accounts) || !Array.isArray(data.transactions)) {
    throw new Error('Backup file is not a valid MMM snapshot.');
  }
  store.writeData(data);
  if (parsed.format === 'mmm-backup@1' && parsed.settings && typeof parsed.settings === 'object') {
    repo.setSettings(db(), parsed.settings);
  }
  return {
    restored: true,
    date,
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

module.exports = { startBackupScheduler, runBackup, listBackups, restoreBackup, BACKUP_DIR };
