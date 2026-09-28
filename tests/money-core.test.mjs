// Cross-cutting money semantics: transfers are neither income nor spending,
// the forecast doesn't subtract a bill twice, and balances in other
// currencies are converted before they're added up.
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import store from '../server/money/store.js';
import moneyRoutes from '../server/money/routes.js';

const ymd = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let server; let base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/money', moneyRoutes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/money`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
const get = async (p) => (await fetch(`${base}${p}`)).json();

beforeEach(() => {
  store.reset();
  store.saveSettings({ baseCurrency: 'USD', fxRates: {} });
});

describe('cash-flow forecast', () => {
  // $10k, rent $2k a month: 90 days hold three rents -> $4,000. The old
  // "discretionary" average included the rent it then subtracted again and
  // ended at -$2,066.67, which also raised a critical advice alert.
  it('does not subtract a recurring bill twice', () => {
    const acc = store.createAccount('Checking', 'checking', 10000);
    store.createTransaction(acc.id, ymd(-58), -2000, 'Landlord');
    store.createTransaction(acc.id, ymd(-28), -2000, 'Landlord');
    store.updateAccount(acc.id, { balance: 10000 });

    const recurring = store.detectRecurring(store.getTransactions(), store.getDeclaredRecurring());
    const out = store.projectCashflow(store.getAccounts(), recurring, 90);
    expect(out.startBalance).toBe(10000);
    expect(out.projection[out.projection.length - 1].balance).toBe(4000);
  });

  it('bounds ?days so a request can\'t pin the CPU', async () => {
    store.createAccount('Checking', 'checking', 100);
    const out = await get('/cashflow?days=200000');
    expect(out.projection).toHaveLength(731);
  });
});

describe('transfers between your own accounts', () => {
  function seedTransfer() {
    const chk = store.createAccount('Checking', 'checking', 5000);
    const sav = store.createAccount('Savings', 'savings', 0);
    store.createTransaction(chk.id, ymd(-3), -2500, 'Transfer to Savings', 'sav');
    store.createTransaction(sav.id, ymd(-3), 2500, 'Transfer from Checking', 'sav');
    store.createTransaction(chk.id, ymd(-2), -80, 'Grocer', 'fod');
    store.createTransaction(chk.id, ymd(-1), 3000, 'Payroll', 'inc');
  }

  it('are neither income nor spending in the metrics', () => {
    seedTransfer();
    const m = store.getMetrics();
    expect(m.monthly_expenses).toBe(40);   // $80 over the 2-month window
    expect(m.monthly_income).toBe(1500);  // $3,000 over the 2-month window
  });

  it('are neither income nor spending in goal insights', () => {
    seedTransfer();
    const recurring = store.detectRecurring(store.getTransactions(), []);
    const gi = store.computeGoalInsights(store.getAccounts(), store.getTransactions(), recurring);
    expect(gi.emergencyFund.monthlyExpenses).toBe(40);
  });

  it('never top the overview\'s spending categories', async () => {
    seedTransfer();
    const overview = await get('/overview');
    expect(overview.topCategoriesThisMonth.map((c) => c.category)).not.toContain('Savings');
  });
});

describe('multi-currency', () => {
  it('converts balances before adding them up — snapshot, goal insights, forecast', () => {
    store.saveSettings({ baseCurrency: 'USD', fxRates: { JPY: 0.0064 } });
    store.createAccount('Checking', 'checking', 1000);
    store.createAccount('Yen account', 'savings', 1000000, '', 'JPY');

    const snaps = store.getNetWorthSnapshots();
    expect(snaps[snaps.length - 1].net).toBe(7400);

    const gi = store.computeGoalInsights(store.getAccounts(), [], []);
    expect(gi.emergencyFund.currentSaved).toBe(7400);
    expect(gi.fire.currentNetWorth).toBe(7400);

    const cf = store.projectCashflow(store.getAccounts(), [], 30);
    expect(cf.startBalance).toBe(7400);
  });

  it('keeps today\'s snapshot current through the day', () => {
    const acc = store.createAccount('Checking', 'checking', 100);
    store.getNetWorthSnapshots();
    store.updateAccount(acc.id, { balance: 250 });
    const snaps = store.getNetWorthSnapshots();
    expect(snaps[snaps.length - 1].net).toBe(250);
  });
});
