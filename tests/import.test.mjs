// Bank-file import: normalization, dedupe, the recurring claim rule, undo, and
// the HTTP contract the Transactions UI codes against. Runs over the real
// SQLite data layer (temp MMM_DATA_DIR from tests/setup.mjs).
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import store from '../server/money/store.js';
import routes from '../server/money/routes.js';

beforeEach(() => {
  store.reset();
});

const txnsOf = (accountId) => store.getTransactions({ account_id: accountId });
const balanceOf = (accountId) => store.getAccounts().find((a) => a.id === accountId).balance;

describe('amounts and dates the way banks write them (finding #1)', () => {
  it('imports every row of a US bank CSV at its real value', () => {
    const acc = store.createAccount('Checking', 'checking', 0);
    const out = store.importTransactions(acc.id, [
      { date: 'Date', amount: 'Amount', payee: 'Description' },
      { date: '09/01/2026', amount: '2,500.00', payee: 'Paycheck' },
      { date: '09/02/2026', amount: '-1,850.00', payee: 'Rent' },
      { date: '09/03/2026', amount: '-$4.50', payee: 'Coffee' },
      { date: '09/04/2026', amount: '(12.34)', payee: 'Fee' },
      { date: '09/05/2026', amount: '56.78-', payee: 'Grocer' },
    ]);
    // Before: 2 of 5 rows imported, as $2.00 and -$1.00.
    expect(out).toMatchObject({ imported: 5, skipped: 0, duplicates: 0, errors: [] });
    expect(balanceOf(acc.id)).toBe(576.38); // 2500 - 1850 - 4.50 - 12.34 - 56.78
  });

  it('imports a European file (day-first dates, decimal comma) without being told', () => {
    const acc = store.createAccount('Girokonto', 'checking', 0);
    const out = store.importTransactions(acc.id, [
      { date: '01.09.2026', amount: '2.500,00', payee: 'Gehalt' },
      { date: '13.09.2026', amount: '-25,90', payee: 'Supermarkt' },
    ]);
    expect(out.detected).toMatchObject({ dateFormat: 'DMY', decimal: ',' });
    expect(txnsOf(acc.id).map((t) => [t.date, t.amount])).toEqual([['2026-09-13', -25.9], ['2026-09-01', 2500]]);
  });

  it('reads Debit/Credit columns', () => {
    const acc = store.createAccount('Checking', 'checking', 100);
    store.importTransactions(acc.id, [
      { date: '2026-09-01', debit: '40.00', credit: '', payee: 'Grocer' },
      { date: '2026-09-02', debit: '', credit: '1,000.00', payee: 'Paycheck' },
    ]);
    expect(balanceOf(acc.id)).toBe(1060);
  });

  it('skips and reports a bad row instead of rejecting the batch — or dating it today', () => {
    const acc = store.createAccount('Checking', 'checking', 0);
    const out = store.importTransactions(acc.id, [
      { date: '2026-09-01', amount: '10', payee: 'Good' },
      { date: '31/31/2026', amount: '10', payee: 'Bad date' },
      { date: '2026-09-02', amount: 'ten', payee: 'Bad amount' },
      { date: '', amount: '10', payee: 'No date' },
    ]);
    expect(out.imported).toBe(1);
    expect(out.skipped).toBe(3);
    expect(out.errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(txnsOf(acc.id).map((t) => t.payee)).toEqual(['Good']);
  });

  it('imports an OFX with a decimal-comma TRNAMT at its real value', () => {
    const acc = store.createAccount('Konto', 'checking', 0);
    store.importFile(acc.id, 'ofx', '<OFX><STMTTRN><DTPOSTED>20260910<TRNAMT>-25,90<FITID>E1<NAME>Supermarkt</STMTTRN></OFX>');
    expect(balanceOf(acc.id)).toBe(-25.9); // was -2590
  });
});

describe('dedupe (finding #2)', () => {
  const ofx = '<OFX>'
    + '<STMTTRN><DTPOSTED>20260910<TRNAMT>-25.90<FITID>A1<NAME>Grocer</STMTTRN>'
    + '<STMTTRN><DTPOSTED>20260911<TRNAMT>-5.00<FITID>A2<NAME>Coffee</STMTTRN>'
    + '</OFX>';

  it('re-importing the same OFX adds nothing (FITID)', () => {
    const acc = store.createAccount('Checking', 'checking', 0);
    expect(store.importFile(acc.id, 'ofx', ofx)).toMatchObject({ imported: 2, duplicates: 0 });
    expect(store.importFile(acc.id, 'ofx', ofx)).toMatchObject({ imported: 0, duplicates: 2, batch_id: null });
    expect(txnsOf(acc.id)).toHaveLength(2);
    expect(txnsOf(acc.id).map((t) => t.external_id).sort()).toEqual(['fitid:A1', 'fitid:A2']);
  });

  it('keeps two genuine identical coffees, and still dedupes them on re-import', () => {
    const acc = store.createAccount('Checking', 'checking', 0);
    const rows = [
      { date: '2026-09-12', amount: '-5.00', payee: 'Coffee' },
      { date: '2026-09-12', amount: '-5.00', payee: 'Coffee' },
    ];
    expect(store.importTransactions(acc.id, rows)).toMatchObject({ imported: 2, duplicates: 0 });
    expect(store.importTransactions(acc.id, rows)).toMatchObject({ imported: 0, duplicates: 2 });
    // An overlapping export with a third coffee that day adds only the new one.
    expect(store.importTransactions(acc.id, [...rows, rows[0]])).toMatchObject({ imported: 1, duplicates: 2 });
    expect(txnsOf(acc.id)).toHaveLength(3);
  });

  it('dedupes regardless of payee case/punctuation, per account', () => {
    const a = store.createAccount('A', 'checking', 0);
    const b = store.createAccount('B', 'checking', 0);
    store.importTransactions(a.id, [{ date: '2026-09-12', amount: '-9.99', payee: 'NETFLIX.COM' }]);
    expect(store.importTransactions(a.id, [{ date: '2026-09-12', amount: '-9.99', payee: 'Netflix com' }]).duplicates).toBe(1);
    expect(store.importTransactions(b.id, [{ date: '2026-09-12', amount: '-9.99', payee: 'NETFLIX.COM' }]).imported).toBe(1);
  });
});

describe('recurring claim rule', () => {
  const autoPost = (accountId, date, amount, payee = 'Rent') =>
    store.createTransaction(accountId, date, amount, payee, null, [], 'Auto-posted from recurring', 'recurring');

  it('a bank row within ±3 days and the same amount claims the auto-posted row', () => {
    const acc = store.createAccount('Checking', 'checking', 5000);
    autoPost(acc.id, '2026-09-01', -1850);
    const out = store.importTransactions(acc.id, [{ date: '2026-09-03', amount: '-1,850.00', payee: 'LANDLORD LLC' }]);
    expect(out).toMatchObject({ imported: 1, claimed: 1, duplicates: 0 });
    const txns = txnsOf(acc.id);
    expect(txns).toHaveLength(1); // not two rent payments
    expect(txns[0]).toMatchObject({ date: '2026-09-03', payee: 'LANDLORD LLC', source: 'csv', amount: -1850 });
    expect(txns[0].external_id).toMatch(/^h:/);
    expect(balanceOf(acc.id)).toBe(3150);
    // …and the same bank row imported again is a duplicate, not a second claim.
    expect(store.importTransactions(acc.id, [{ date: '2026-09-03', amount: '-1,850.00', payee: 'LANDLORD LLC' }]).duplicates).toBe(1);
  });

  it('does not claim outside the window, at a different amount, or a manual row', () => {
    const acc = store.createAccount('Checking', 'checking', 5000);
    autoPost(acc.id, '2026-09-01', -1850);
    store.createTransaction(acc.id, '2026-09-10', -60, 'Gym'); // manual, not recurring
    const out = store.importTransactions(acc.id, [
      { date: '2026-09-05', amount: '-1850.00', payee: 'Rent, 4 days late' },
      { date: '2026-09-02', amount: '-1850.01', payee: 'Rent, a cent off' },
      { date: '2026-09-10', amount: '-60.00', payee: 'GYM' },
    ]);
    expect(out).toMatchObject({ imported: 3, claimed: 0 });
    expect(txnsOf(acc.id)).toHaveLength(5);
  });

  it('claims the closest-dated row and each auto-post only once', () => {
    const acc = store.createAccount('Checking', 'checking', 0);
    autoPost(acc.id, '2026-09-01', -50, 'Phone');
    autoPost(acc.id, '2026-09-04', -50, 'Phone');
    const out = store.importTransactions(acc.id, [
      { date: '2026-09-03', amount: '-50', payee: 'VERIZON' },
      { date: '2026-09-02', amount: '-50', payee: 'VERIZON' },
    ]);
    expect(out.claimed).toBe(2);
    expect(txnsOf(acc.id).map((t) => t.date).sort()).toEqual(['2026-09-02', '2026-09-03']);
  });
});

describe('undo an import', () => {
  it('removes the rows it added and gives claimed auto-posts back', () => {
    const acc = store.createAccount('Checking', 'checking', 1000);
    store.createTransaction(acc.id, '2026-09-01', -1850, 'Rent', 'hou', [], 'Auto-posted from recurring', 'recurring');
    const out = store.importTransactions(acc.id, [
      { date: '2026-09-02', amount: '-1850', payee: 'LANDLORD LLC' },
      { date: '2026-09-05', amount: '-20', payee: 'Lunch' },
    ]);
    expect(out).toMatchObject({ imported: 2, claimed: 1 });

    const undo = store.undoImport(out.batch_id);
    expect(undo).toMatchObject({ batch_id: out.batch_id, deleted: 1, restored: 1 });
    const txns = txnsOf(acc.id);
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ date: '2026-09-01', payee: 'Rent', source: 'recurring', external_id: null, custom: {} });
    expect(balanceOf(acc.id)).toBe(1000 - 1850);

    // Released: importing again claims it again.
    expect(store.importTransactions(acc.id, [{ date: '2026-09-02', amount: '-1850', payee: 'LANDLORD LLC' }]).claimed).toBe(1);
  });

  it('404s an unknown batch', () => {
    expect(() => store.undoImport('nope')).toThrow(/not found/);
  });
});

describe('HTTP contract', () => {
  let server; let base;
  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/money', routes);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/money`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  it('POST /transactions/import answers { imported, skipped, duplicates, errors, batch_id }', async () => {
    const acc = store.createAccount('Checking', 'checking', 0);
    const { status, body } = await call('POST', '/transactions/import', {
      account_id: acc.id,
      dateFormat: 'auto',
      decimal: 'auto',
      rows: [
        { date: 'Date', amount: 'Amount', payee: 'Payee' },
        { date: '09/01/2026', amount: '$1,234.56', payee: 'Paycheck', note: 'sept' },
        { date: '09/02/2026', amount: 'lots', payee: 'Bad' },
      ],
    });
    expect(status).toBe(200); // one bad row never 400s the batch
    expect(body).toMatchObject({ imported: 1, skipped: 1, duplicates: 0, errors: [{ row: 3, reason: 'unrecognized amount "lots"' }] });
    expect(typeof body.batch_id).toBe('string');
  });

  it('POST /transactions/import-file returns the same summary', async () => {
    const acc = store.createAccount('Checking', 'checking', 0);
    const content = '!Type:Bank\nD09/01/26\nT-1,234.56\nPBig Bill\n^\nDnope\nT-1\nPBad\n^\n';
    const { status, body } = await call('POST', '/transactions/import-file', { account_id: acc.id, format: 'qif', content });
    expect(status).toBe(200);
    expect(body).toMatchObject({ imported: 1, skipped: 1, duplicates: 0, errors: [{ row: 2, reason: 'unrecognized date "nope"' }] });
    expect(typeof body.batch_id).toBe('string');
  });

  it('DELETE /transactions/import/:batch_id undoes one import', async () => {
    const acc = store.createAccount('Checking', 'checking', 0);
    const { body } = await call('POST', '/transactions/import', { account_id: acc.id, rows: [{ date: '2026-09-01', amount: '-5', payee: 'x' }] });
    const del = await call('DELETE', `/transactions/import/${body.batch_id}`);
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ batch_id: body.batch_id, deleted: 1, restored: 0 });
    expect(txnsOf(acc.id)).toHaveLength(0);
    expect((await call('DELETE', `/transactions/import/${body.batch_id}`)).status).toBe(404);
  });

  it('400s a bad request, 404s a missing account', async () => {
    expect((await call('POST', '/transactions/import', { rows: [] })).status).toBe(400);
    expect((await call('POST', '/transactions/import', { account_id: 'x', rows: [], dateFormat: 'DDMMYY' })).status).toBe(400);
    expect((await call('POST', '/transactions/import', { account_id: 'nope', rows: [{ date: '2026-09-01', amount: '1' }] })).status).toBe(404);
  });
});
