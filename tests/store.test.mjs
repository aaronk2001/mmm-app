// Integration tests over the real SQLite data layer (temp DB from tests/setup.mjs).
// Focus: derived balances, integer-cents exactness, cascade deletes, deep-merge
// settings, recurring CRUD, and export/import round-trips.
import { describe, it, expect, beforeEach } from 'vitest';
import store from '../server/money/store.js';
import repo from '../server/db/repo.js';
import { db } from '../server/db/connection.js';

beforeEach(() => {
  store.reset();
});

describe('derived account balances', () => {
  it('balance = opening balance + sum of transactions', () => {
    const acc = store.createAccount('Checking', 'checking', 100);
    expect(acc.balance).toBe(100);

    store.createTransaction(acc.id, '2026-07-01', -25.5, 'Coffee');
    store.createTransaction(acc.id, '2026-07-02', 10, 'Refund');
    expect(store.getAccounts().find(a => a.id === acc.id).balance).toBe(84.5);
  });

  it('deleting a transaction restores the balance exactly', () => {
    const acc = store.createAccount('Checking', 'checking', 100);
    const t = store.createTransaction(acc.id, '2026-07-01', -33.33, 'Thing');
    store.deleteTransaction(t.id);
    expect(store.getAccounts()[0].balance).toBe(100);
  });

  it('editing a transaction amount recomputes the balance', () => {
    const acc = store.createAccount('Checking', 'checking', 0);
    const t = store.createTransaction(acc.id, '2026-07-01', -10, 'A');
    store.updateTransaction(t.id, { amount: -40 });
    expect(store.getAccounts()[0].balance).toBe(-40);
  });

  it('editing the account balance adjusts the opening balance, not history', () => {
    const acc = store.createAccount('Checking', 'checking', 100);
    store.createTransaction(acc.id, '2026-07-01', -20, 'A');
    store.updateAccount(acc.id, { balance: 500 });
    expect(store.getAccounts()[0].balance).toBe(500);
    // History intact: removing the txn moves the balance UP by 20.
    const t = store.getTransactions()[0];
    store.deleteTransaction(t.id);
    expect(store.getAccounts()[0].balance).toBe(520);
  });

  it('float-poison amounts store exactly as cents', () => {
    const acc = store.createAccount('Checking', 'checking', 0);
    // 0.1 + 0.2 === 0.30000000000000004 in float land
    store.createTransaction(acc.id, '2026-07-01', 0.1 + 0.2, 'poison');
    for (let i = 0; i < 10; i++) store.createTransaction(acc.id, '2026-07-01', 0.1, 'dime');
    expect(store.getAccounts()[0].balance).toBe(1.3); // exact, no 1.2999999…
  });
});

describe('cascade deletes', () => {
  it('deleting an account removes its transactions and holdings', () => {
    const acc = store.createAccount('Brokerage', 'investment', 1000);
    store.createTransaction(acc.id, '2026-07-01', -5, 'Fee');
    store.createHolding(acc.id, 'VTI', 2, 100, 120);
    store.deleteAccount(acc.id);
    expect(store.getTransactions()).toHaveLength(0);
    expect(store.getHoldings()).toHaveLength(0);
  });
});

describe('settings deep-merge', () => {
  it('a partial write no longer clobbers sibling nested keys', () => {
    const d = db();
    repo.setSettings(d, { dashboards: { overview: { layout: [{ i: 'netWorth' }], widgetConfig: { budgets: { count: 3 } } } } });
    repo.setSettings(d, { appearance: { theme: 'dark' } });
    repo.setSettings(d, { dashboards: { overview: { widgetConfig: { goals: { count: 2 } } } } });

    const s = repo.getSettings(d);
    expect(s.appearance.theme).toBe('dark');
    expect(s.dashboards.overview.layout).toEqual([{ i: 'netWorth' }]); // survived
    expect(s.dashboards.overview.widgetConfig.budgets).toEqual({ count: 3 }); // survived
    expect(s.dashboards.overview.widgetConfig.goals).toEqual({ count: 2 });
  });

  it('arrays replace wholesale (customFields semantics)', () => {
    const d = db();
    repo.setSettings(d, { customFields: [{ id: 'a' }, { id: 'b' }] });
    repo.setSettings(d, { customFields: [{ id: 'a' }] });
    expect(repo.getSettings(d).customFields).toEqual([{ id: 'a' }]);
  });
});

describe('declared recurring CRUD', () => {
  it('create, update, list, delete', () => {
    const r = store.createRecurring({ payee: 'Rent', amount: 1200, cadence: 'monthly', kind: 'bill', next_date: '2026-08-01' });
    expect(r.amount).toBe(1200);
    store.updateRecurring(r.id, { amount: 1250.55 });
    expect(store.getDeclaredRecurring()[0].amount).toBe(1250.55);
    store.deleteRecurring(r.id);
    expect(store.getDeclaredRecurring()).toHaveLength(0);
  });

  it('declared recurring feeds detectRecurring with precedence', () => {
    store.createRecurring({ payee: 'gym', amount: 45, cadence: 'monthly', kind: 'bill' });
    const merged = store.detectRecurring([], store.getDeclaredRecurring());
    expect(merged).toHaveLength(1);
    expect(merged[0].amount).toBe(45);
  });
});

describe('export / import round-trip', () => {
  it('readData -> writeData -> readData preserves balances and rows', () => {
    const acc = store.createAccount('Checking', 'checking', 250.75);
    store.createTransaction(acc.id, '2026-07-01', -50.25, 'Store');
    store.createBudget('fod', 'monthly', 600);
    store.createGoal('Houston fund', 5000, 750);
    store.createRule('spotify', 'sub');
    store.createRecurring({ payee: 'Rent', amount: 1200, cadence: 'monthly', kind: 'bill' });

    const blob = store.readData();
    store.reset();
    store.writeData(blob);
    const after = store.readData();

    expect(after.accounts[0].balance).toBe(200.5); // 250.75 - 50.25
    expect(after.transactions).toHaveLength(1);
    expect(after.budgets[0].limit).toBe(600);
    expect(after.goals[0].target).toBe(5000);
    expect(after.rules[0].match).toBe('spotify');
    expect(after.recurring[0].amount).toBe(1200);
  });

  it('orphaned transactions in a backup import as unassigned, not a crash', () => {
    store.writeData({
      accounts: [{ id: 'a1', name: 'X', type: 'checking', balance: 10 }],
      transactions: [
        { id: 't1', account_id: 'a1', date: '2026-07-01', amount: -1, payee: 'ok' },
        { id: 't2', account_id: 'GONE', date: '2026-07-01', amount: -2, payee: 'orphan' },
      ],
    });
    const txns = store.getTransactions();
    expect(txns).toHaveLength(2);
    expect(txns.find(t => t.id === 't2').account_id).toBe(null);
  });
});

describe('import pipeline', () => {
  it('CSV import with quoted payees lands transactions with auto-categories', () => {
    const acc = store.createAccount('Checking', 'checking', 0);
    const csv = 'date,amount,payee,note\n2026-07-01,-42.50,"Trader Joes, Inc",food\n2026-07-02,-15,LA Fitness,gym';
    const out = store.importTransactions(acc.id, null, csv, null);
    expect(out.imported).toBe(2);
    const txns = store.getTransactions();
    expect(txns.find(t => t.payee.includes('Trader Joes')).category_id).toBe('fod');
    expect(txns.find(t => t.payee === 'LA Fitness').category_id).toBe('hea');
    expect(store.getAccounts()[0].balance).toBe(-57.5);
  });

  it('normalizes bank-style MM/DD/YYYY dates so month filters still see them', () => {
    const acc = store.createAccount('Checking', 'checking', 0);
    store.importTransactions(acc.id, null, 'date,amount,payee\n07/04/2026,-10,Gas', null);
    expect(store.getTransactions()[0].date).toBe('2026-07-04');
  });

  it('QIF file import works end-to-end', () => {
    const acc = store.createAccount('Checking', 'checking', 0);
    const out = store.importFile(acc.id, 'qif', 'D07/01/26\nT-100\nPRent Co\n^\n');
    expect(out.imported).toBe(1);
    expect(store.getAccounts()[0].balance).toBe(-100);
  });
});

describe('rules apply atomically', () => {
  it('applyRules re-files matching transactions and returns changed ids', () => {
    const acc = store.createAccount('Checking', 'checking', 0);
    const t1 = store.createTransaction(acc.id, '2026-07-01', -10, 'Spotify AB', 'oth');
    store.createTransaction(acc.id, '2026-07-01', -20, 'Nothing', 'oth');
    const changed = store.applyRules(store.getTransactions(), [{ id: 'r1', match: 'spotify', category_id: 'sub' }]);
    expect(changed).toEqual([t1.id]);
    expect(store.getTransactions().find(t => t.id === t1.id).category_id).toBe('sub');
  });
});
