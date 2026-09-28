// Route-level guards around everything that replaces data wholesale: load
// sample, reset, import, restore and "Back up now". Mounts the real routers on
// an ephemeral Express server against the temp MMM_DATA_DIR from setup.mjs.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import moneyRoutes from '../server/money/routes.js';
import backupRoutes from '../server/backup/routes.js';
import store from '../server/money/store.js';
import scheduler from '../server/backup/scheduler.js';

let server; let base;

async function call(method, p, body) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const accounts = () => store.getAccounts();

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '100mb' }));
  app.use('/api/money/backups', backupRoutes);
  app.use('/api/money', moneyRoutes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/money`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  store.reset();
  fs.rmSync(scheduler.BACKUP_DIR, { recursive: true, force: true });
  store.createAccount('MY REAL CHECKING', 'checking', 1234.56);
});

describe('load sample', () => {
  it('refuses to replace real data without an explicit confirmation', async () => {
    const res = await call('POST', '/seed-sample', {});
    expect(res.status).toBe(409);
    expect(res.body.needsConfirm).toBe(true);
    expect(accounts().map((a) => a.name)).toEqual(['MY REAL CHECKING']);
  });

  it('with replace:true, snapshots first — and the snapshot restores the real data', async () => {
    const res = await call('POST', '/seed-sample', { replace: true });
    expect(res.status).toBe(200);
    expect(res.body.safety).toMatch(/^pre-sample-/);
    expect(accounts().some((a) => a.name === 'MY REAL CHECKING')).toBe(false);

    const list = await call('GET', '/backups');
    expect(list.body.snapshots.map((s) => s.id)).toContain(res.body.safety);

    const restored = await call('POST', '/backups/restore', { snapshot: res.body.safety });
    expect(restored.status).toBe(200);
    expect(accounts().map((a) => [a.name, a.balance])).toEqual([['MY REAL CHECKING', 1234.56]]);
    // …and the restore itself was snapshotted, so it can be undone too.
    expect(restored.body.safety).toMatch(/^pre-restore-/);
  });

  it('loads freely into an empty ledger', async () => {
    store.reset();
    const res = await call('POST', '/seed-sample', {});
    expect(res.status).toBe(200);
    expect(res.body.safety).toBeNull();
    expect(accounts().length).toBeGreaterThan(0);
  });
});

describe('reset', () => {
  it('needs { confirm: true }', async () => {
    const res = await call('POST', '/reset', {});
    expect(res.status).toBe(400);
    expect(accounts()).toHaveLength(1);
  });

  it('snapshots before erasing', async () => {
    const res = await call('POST', '/reset', { confirm: true });
    expect(res.status).toBe(200);
    expect(accounts()).toHaveLength(0);
    expect(fs.existsSync(path.join(scheduler.BACKUP_DIR, `${res.body.safety}.db`))).toBe(true);
  });
});

describe('export / import', () => {
  it('round-trips settings and keeps tables an older export predates', async () => {
    store.saveSettings({ baseCurrency: 'EUR', customFields: [] });
    const exported = await call('GET', '/export');
    expect(exported.body.format).toBe('mmm-backup@1');
    expect(exported.body.settings.baseCurrency).toBe('EUR');
    expect(exported.body.data.accounts).toHaveLength(1);

    // Paper-trading state that an old, money-only export knows nothing about.
    store.saveSettings({ baseCurrency: 'USD' });
    const repo = (await import('../server/db/repo.js')).default;
    const { db } = (await import('../server/db/connection.js')).default;
    repo.createWatchlistItem(db(), { symbol: 'KEEP' });

    const oldStyle = { accounts: exported.body.data.accounts, transactions: [], categories: exported.body.data.categories };
    const imported = await call('POST', '/import', { format: 'mmm-backup@1', data: oldStyle, settings: exported.body.settings });
    expect(imported.status).toBe(200);
    expect(imported.body.safety).toMatch(/^pre-import-/);
    expect(repo.getWatchlist(db()).map((w) => w.symbol)).toEqual(['KEEP']);
    expect(store.getSettings().baseCurrency).toBe('EUR');
  });
});

describe('Back up now', () => {
  it('keeps the earlier copy from today instead of overwriting it', async () => {
    await call('POST', '/backups/run');
    store.createAccount('Added later', 'savings', 10);
    await call('POST', '/backups/run');
    const snaps = (await call('GET', '/backups')).body.snapshots;
    expect(snaps.some((s) => s.reason === 'backup-now')).toBe(true);
  });
});

describe('accounts', () => {
  it('stores a credit card entered as a positive "amount owed" as a liability', async () => {
    const res = await call('POST', '/accounts', { name: 'Card', type: 'credit', balance: 2000, apr: 0.2499, min_payment: 35 });
    expect(res.status).toBe(201);
    const card = accounts().find((a) => a.name === 'Card');
    expect(card).toMatchObject({ balance: -2000, apr: 0.2499, min_payment: 35 });

    // A purchase grows the debt instead of shrinking it.
    store.createTransaction(card.id, '2026-09-01', -500, 'Store');
    expect(accounts().find((a) => a.name === 'Card').balance).toBe(-2500);
  });

  it('accepts every type the Add Account form offers', async () => {
    for (const type of ['brokerage', 'retirement', 'crypto', 'real_estate', 'vehicle']) {
      expect((await call('POST', '/accounts', { name: type, type, balance: 1 })).status).toBe(201);
    }
  });

  it('feeds APR / minimum payment from the account into /debt', async () => {
    await call('POST', '/accounts', { name: 'Card', type: 'credit', balance: 1000, apr: 0.3, min_payment: 40 });
    const { body } = await call('GET', '/debt');
    expect(body.debts[0]).toMatchObject({ name: 'Card', balance: 1000, apr: 0.3, apr_is_default: false, min_payment: 40 });
  });
});

describe('what counts as "your data"', () => {
  it('protects paper trades and learn progress, not just the ledger', async () => {
    store.reset();
    const repo = (await import('../server/db/repo.js')).default;
    const { db } = (await import('../server/db/connection.js')).default;
    repo.createWatchlistItem(db(), { symbol: 'MINE' });
    expect((await call('POST', '/seed-sample', {})).status).toBe(409);
    const res = await call('POST', '/reset', { confirm: true });
    expect(res.body.safety).toMatch(/^pre-reset-/);
  });
});
