// applyAdditiveMigrations upgrades a database created before the apr /
// min_payment / external_id / import_batch_id / anchor_day columns existed.
// schema.sql's CREATE TABLE IF NOT EXISTS never touches existing tables, and
// an index on a new column must be created after the ALTER that adds it.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import connection from '../server/db/connection.js';

const { applyAdditiveMigrations } = connection;

function oldSchemaDb() {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      opening_balance_cents INTEGER NOT NULL DEFAULT 0, institution TEXT DEFAULT '', currency TEXT DEFAULT 'USD',
      status TEXT DEFAULT 'active', created_at TEXT, custom TEXT DEFAULT '{}');
    CREATE TABLE transactions (id TEXT PRIMARY KEY, account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
      date TEXT NOT NULL, amount_cents INTEGER NOT NULL, payee TEXT DEFAULT '', category_id TEXT,
      tags TEXT DEFAULT '[]', note TEXT DEFAULT '', source TEXT DEFAULT 'manual', cleared INTEGER DEFAULT 0,
      custom TEXT DEFAULT '{}');
    CREATE TABLE recurring (id TEXT PRIMARY KEY, payee TEXT NOT NULL, amount_cents INTEGER NOT NULL,
      cadence TEXT NOT NULL, kind TEXT NOT NULL, next_date TEXT, note TEXT DEFAULT '');
    INSERT INTO accounts (id, name, type) VALUES ('a1', 'Checking', 'checking');
    INSERT INTO transactions (id, account_id, date, amount_cents) VALUES ('t1', 'a1', '2026-09-01', -500);
  `);
  return d;
}
const cols = (d, table) => d.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

describe('applyAdditiveMigrations', () => {
  it('adds the new columns to an existing database without touching its rows', () => {
    const d = oldSchemaDb();
    applyAdditiveMigrations(d);
    expect(cols(d, 'accounts')).toEqual(expect.arrayContaining(['apr', 'min_payment_cents']));
    expect(cols(d, 'transactions')).toEqual(expect.arrayContaining(['external_id', 'import_batch_id']));
    expect(cols(d, 'recurring')).toEqual(expect.arrayContaining(['account_id', 'anchor_day']));
    expect(d.prepare('SELECT amount_cents FROM transactions').get().amount_cents).toBe(-500);
  });

  it('is idempotent', () => {
    const d = oldSchemaDb();
    applyAdditiveMigrations(d);
    expect(() => applyAdditiveMigrations(d)).not.toThrow();
  });

  it('makes a bank transaction id unique per account, and only when present', () => {
    const d = oldSchemaDb();
    applyAdditiveMigrations(d);
    d.exec("INSERT INTO accounts (id, name, type) VALUES ('a2', 'Savings', 'savings')");
    const ins = d.prepare("INSERT INTO transactions (id, account_id, date, amount_cents, external_id) VALUES (?, ?, '2026-09-02', 100, ?)");
    ins.run('x1', 'a1', 'FITID-1');
    expect(() => ins.run('x2', 'a1', 'FITID-1')).toThrow(/UNIQUE/);
    expect(() => ins.run('x3', 'a2', 'FITID-1')).not.toThrow(); // another account
    expect(() => { ins.run('x4', 'a1', null); ins.run('x5', 'a1', null); }).not.toThrow();
  });
});
