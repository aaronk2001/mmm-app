const express = require('express');
const store = require('./store');
const advice = require('./advice');
const ollama = require('./ollama');
const { coachSystemPrompt } = require('./coach-persona');
const v = require('../middleware/validators');

const router = express.Router();

// 400 with the validator's field errors; returns true when the request is bad.
function invalid(res, check) {
  if (check.valid) return false;
  res.status(400).json({ error: check.errors.join('; ') });
  return true;
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/money/overview
// ────────────────────────────────────────────────────────────────────────────

router.get('/overview', (req, res) => {
  try {
    const data = store.readData();
    const cc = store.getCurrencyConfig();
    const nw = store.computeNetWorth(data.accounts, cc.baseCurrency, cc.fxRates);

    // Top categories this month. Month membership is a string-prefix check on
    // the local calendar month (Date-object comparison drops 1st-of-month
    // transactions in UTC-negative timezones).
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const categorySpend = {};
    data.transactions
      .filter(t => t.amount < 0 && String(t.date).slice(0, 7) === ym)
      .forEach(t => {
        if (!categorySpend[t.category_id]) categorySpend[t.category_id] = 0;
        categorySpend[t.category_id] += Math.abs(t.amount);
      });

    const topCategories = Object.entries(categorySpend)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([catId, spent]) => {
        const cat = data.categories.find(c => c.id === catId);
        return {
          category: cat?.name || 'Unknown',
          spent: Math.round(spent * 100) / 100,
        };
      });

    // Budget status (only monthly, active)
    const budgetStatus = store.computeBudgetStatus(data.budgets, data.transactions);

    // Recent snapshots (last 30 days) — string-compared dates.
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const recentSnapshots = data.networth_snapshots
      .filter(s => String(s.date) >= cutoff)
      .map(s => ({
        date: s.date,
        net: s.net,
      }));

    res.json({
      netWorth: nw.net,
      assets: nw.assets,
      liabilities: nw.liabilities,
      accountsCount: data.accounts.length,
      snapshots: recentSnapshots,
      topCategoriesThisMonth: topCategories,
      budgetStatus,
      displayCurrency: cc.baseCurrency,
      isEmpty: data.accounts.length === 0 && data.transactions.length === 0,
      lastAutopost: store.getLastAutopost(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Accounts
// ────────────────────────────────────────────────────────────────────────────

router.get('/accounts', (req, res) => {
  try {
    res.json({ accounts: store.getAccounts() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/accounts', (req, res) => {
  try {
    if (invalid(res, v.validateAccount(req.body))) return;
    const { name, type, balance, institution, currency, status, custom } = req.body;
    const account = store.createAccount(name, type, balance, institution, currency, status, custom);
    res.status(201).json({ account });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/accounts/:id', (req, res) => {
  try {
    if (invalid(res, v.validateAccount(req.body, { partial: true }))) return;
    const account = store.updateAccount(req.params.id, req.body);
    res.json({ account });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/accounts/:id', (req, res) => {
  try {
    store.deleteAccount(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Transactions
// ────────────────────────────────────────────────────────────────────────────

router.get('/transactions', (req, res) => {
  try {
    const filters = {
      account_id: req.query.account_id,
      category_id: req.query.category_id,
      from: req.query.from,
      to: req.query.to,
    };
    const transactions = store.getTransactions(filters);
    res.json({ transactions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/transactions', (req, res) => {
  try {
    if (invalid(res, v.validateTransaction(req.body))) return;
    const { account_id, date, amount, payee, category_id, tags, note, source, cleared, custom } = req.body;
    const transaction = store.createTransaction(
      account_id,
      date,
      amount,
      payee,
      category_id,
      tags,
      note,
      source,
      cleared,
      custom
    );
    res.status(201).json({ transaction });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Bulk ops registered before /:id so the path can't be captured by it.
router.post('/transactions/bulk-update', (req, res) => {
  try {
    const { ids, updates } = req.body;
    if (invalid(res, v.validateBulkIds(req.body))) return;
    if (invalid(res, v.validateTransaction(updates || {}, { partial: true }))) return;
    const updated = store.updateTransactionsBulk(ids, updates);
    res.json({ updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/transactions/bulk-delete', (req, res) => {
  try {
    const { ids } = req.body;
    if (invalid(res, v.validateBulkIds(req.body))) return;
    const deleted = store.deleteTransactionsBulk(ids);
    res.json({ deleted });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/transactions/:id', (req, res) => {
  try {
    if (invalid(res, v.validateTransaction(req.body, { partial: true }))) return;
    const transaction = store.updateTransaction(req.params.id, req.body);
    res.json({ transaction });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/transactions/:id', (req, res) => {
  try {
    store.deleteTransaction(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Payees ranked by frequency (quick-add autocomplete + category suggestion).
router.get('/payees', (req, res) => {
  try {
    res.json({ payees: store.getPayeeStats(parseInt(req.query.limit, 10) || 100) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Transactions import
// ────────────────────────────────────────────────────────────────────────────

router.post('/transactions/import', (req, res) => {
  try {
    if (invalid(res, v.validateImport(req.body))) return;
    const { account_id, rows, csv, mapping } = req.body;
    const result = store.importTransactions(account_id, rows, csv, mapping);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// OFX / QIF file import (file read as text client-side, posted as JSON — no upload middleware).
router.post('/transactions/import-file', (req, res) => {
  try {
    if (invalid(res, v.validateImport(req.body))) return;
    const { account_id, format, content } = req.body;
    res.json(store.importFile(account_id, format, content));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Categories
// ────────────────────────────────────────────────────────────────────────────

router.get('/categories', (req, res) => {
  try {
    res.json({ categories: store.getCategories() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', (req, res) => {
  try {
    if (invalid(res, v.validateCategory(req.body))) return;
    const { name, group, color, icon } = req.body;
    const category = store.createCategory(name, group, color, icon);
    res.status(201).json({ category });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Budgets
// ────────────────────────────────────────────────────────────────────────────

router.get('/budgets', (req, res) => {
  try {
    res.json({ budgets: store.getBudgets() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/budgets', (req, res) => {
  try {
    if (invalid(res, v.validateBudget(req.body))) return;
    const { category_id, period, limit, rollover } = req.body;
    const budget = store.createBudget(category_id, period, limit, rollover);
    res.status(201).json({ budget });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/budgets/:id', (req, res) => {
  try {
    if (invalid(res, v.validateBudget(req.body, { partial: true }))) return;
    const budget = store.updateBudget(req.params.id, req.body);
    res.json({ budget });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/budgets/:id', (req, res) => {
  try {
    store.deleteBudget(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Net worth
// ────────────────────────────────────────────────────────────────────────────

router.get('/networth', (req, res) => {
  try {
    const snapshots = store.getNetWorthSnapshots();
    res.json({ snapshots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Named numeric variables for the custom-metric formula engine.
router.get('/metrics', (req, res) => {
  try {
    res.json({ metrics: store.getMetrics() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Multi-currency: base currency + FX rates + the available currency list.
router.get('/currency', (req, res) => {
  try {
    res.json(store.getCurrencyConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Investments / holdings
// ────────────────────────────────────────────────────────────────────────────

router.get('/holdings', (req, res) => {
  try {
    res.json({ holdings: store.getHoldings(req.query.account_id || null) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/holdings', (req, res) => {
  try {
    if (invalid(res, v.validateHolding(req.body))) return;
    const { account_id, symbol, shares, cost_basis, current_price } = req.body;
    const holding = store.createHolding(account_id, symbol, shares, cost_basis, current_price);
    res.status(201).json({ holding });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/holdings/:id', (req, res) => {
  try {
    if (invalid(res, v.validateHolding(req.body, { partial: true }))) return;
    res.json({ holding: store.updateHolding(req.params.id, req.body) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/holdings/:id', (req, res) => {
  try {
    store.deleteHolding(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/investments/summary', (req, res) => {
  try {
    const holdings = store.getHoldings();
    res.json({ holdings, ...store.computeInvestmentMetrics(holdings) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Recurring
// ────────────────────────────────────────────────────────────────────────────

router.get('/recurring', (req, res) => {
  try {
    const declared = store.getDeclaredRecurring();
    const recurring = store.detectRecurring(store.getTransactions(), declared);
    res.json({ recurring, declared });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/recurring', (req, res) => {
  try {
    if (invalid(res, v.validateRecurring(req.body))) return;
    const { payee, amount, cadence, kind, next_date, note, account_id } = req.body;
    res.status(201).json({ recurring: store.createRecurring({ payee, amount, cadence, kind, next_date, note, account_id }) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Post every due recurring item into transactions (idempotent). Runs on app
// launch server-side; exposed so the client can trigger + refetch on demand.
router.post('/recurring/post-due', (req, res) => {
  try {
    res.json(store.postDueRecurring());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/recurring/:id', (req, res) => {
  try {
    if (invalid(res, v.validateRecurring(req.body, { partial: true }))) return;
    res.json({ recurring: store.updateRecurring(req.params.id, req.body) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/recurring/:id', (req, res) => {
  try {
    store.deleteRecurring(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Cashflow projection
// ────────────────────────────────────────────────────────────────────────────

router.get('/cashflow', (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 90;
    const recurring = store.detectRecurring(store.getTransactions(), store.getDeclaredRecurring());
    const projection = store.projectCashflow(store.getAccounts(), recurring, days);
    res.json(projection);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Goals
// ────────────────────────────────────────────────────────────────────────────

router.get('/goals', (req, res) => {
  try {
    res.json({ goals: store.getGoals() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/goals', (req, res) => {
  try {
    if (invalid(res, v.validateGoal(req.body))) return;
    const { name, target, current, linked_account_id, target_date, template, monthly_contribution, custom } = req.body;
    const goal = store.createGoal(name, target, current, linked_account_id, target_date, template, monthly_contribution, custom);
    res.status(201).json({ goal });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/goals/:id', (req, res) => {
  try {
    if (invalid(res, v.validateGoal(req.body, { partial: true }))) return;
    const goal = store.updateGoal(req.params.id, req.body);
    res.json({ goal });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/goals/:id', (req, res) => {
  try {
    store.deleteGoal(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/goals/insights', (req, res) => {
  try {
    const data = store.readData();
    const recurring = store.detectRecurring(store.getTransactions(), store.getDeclaredRecurring());
    const insights = store.computeGoalInsights(data.accounts, data.transactions, recurring);
    res.json(insights);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Debt
// ────────────────────────────────────────────────────────────────────────────

router.get('/debt', (req, res) => {
  try {
    const data = store.readData();
    const debts = data.accounts
      .filter(a => a.type === 'loan' || a.type === 'credit')
      .map(a => ({
        account_id: a.id,
        name: a.name,
        balance: Math.abs(parseFloat(a.balance) || 0),
        type: a.type,
        apr: a.apr || (a.type === 'credit' ? 0.20 : 0.07),
        min_payment: a.min_payment || Math.max(2, Math.abs(parseFloat(a.balance) || 0) * 0.02),
      }));
    res.json({ debts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/debt/payoff', (req, res) => {
  try {
    const { strategy, monthly_extra } = req.body;
    if (!strategy || !['avalanche', 'snowball'].includes(strategy)) {
      return res.status(400).json({ error: 'strategy must be avalanche or snowball' });
    }

    const data = store.readData();
    const debts = data.accounts
      .filter(a => a.type === 'loan' || a.type === 'credit')
      .map(a => ({
        account_id: a.id,
        name: a.name,
        balance: Math.abs(parseFloat(a.balance) || 0),
        type: a.type,
        rate: (a.apr || (a.type === 'credit' ? 0.20 : 0.07)) * 100,
        min_payment: a.min_payment || Math.max(2, Math.abs(parseFloat(a.balance) || 0) * 0.02),
      }))
      .filter(d => d.balance > 0);

    if (debts.length === 0) {
      return res.json({
        strategy,
        order: [],
        monthsToFree: 0,
        totalInterest: 0,
        schedule: [],
      });
    }

    const extra = Math.max(0, Number(monthly_extra) || 0);

    // Sort by strategy
    let ordered = [...debts];
    if (strategy === 'snowball') {
      ordered.sort((a, b) => a.balance - b.balance);
    } else {
      ordered.sort((a, b) => b.rate - a.rate);
    }

    // Simulate payoff
    const state = ordered.map(d => ({
      name: d.name,
      remaining: d.balance,
      min: d.min_payment,
      rate: d.rate,
    }));

    let month = 0;
    let totalInterest = 0;
    const schedule = [];

    while (state.some(d => d.remaining > 0.01) && month < 600) {
      month++;

      // Accrue interest
      state.forEach(d => {
        if (d.remaining > 0.01) {
          const interest = d.remaining * (d.rate / 100 / 12);
          d.remaining += interest;
          totalInterest += interest;
        }
      });

      // Pay minimums
      let freed = 0;
      state.forEach(d => {
        if (d.remaining > 0.01) {
          const pmt = Math.min(d.min, d.remaining);
          d.remaining = Math.max(0, d.remaining - pmt);
          if (d.remaining < 0.01) freed += d.min - pmt;
        }
      });

      // Apply extra payment to first debt with balance
      let extraApplied = extra + freed;
      for (const d of state) {
        if (d.remaining > 0.01 && extraApplied > 0.01) {
          const pmt = Math.min(extraApplied, d.remaining);
          d.remaining = Math.max(0, d.remaining - pmt);
          extraApplied -= pmt;
        }
      }

      if (month % 3 === 0 || state.every(d => d.remaining < 0.01)) {
        schedule.push({
          month,
          balances: state.map(d => ({
            name: d.name,
            remaining: Math.round(d.remaining * 100) / 100,
          })),
        });
      }
    }

    res.json({
      strategy,
      order: ordered.map(d => d.name),
      monthsToFree: month,
      totalInterest: Math.round(totalInterest),
      schedule,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Rules
// ────────────────────────────────────────────────────────────────────────────

router.get('/rules', (req, res) => {
  try {
    res.json({ rules: store.getRules() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rules', (req, res) => {
  try {
    if (invalid(res, v.validateRule(req.body))) return;
    const { match, category_id, tag } = req.body;
    const rule = store.createRule(match, category_id, tag);
    res.status(201).json({ rule });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/rules/:id', (req, res) => {
  try {
    if (invalid(res, v.validateRule(req.body, { partial: true }))) return;
    const rule = store.updateRule(req.params.id, req.body);
    res.json({ rule });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/rules/:id', (req, res) => {
  try {
    store.deleteRule(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/rules/apply', (req, res) => {
  try {
    const data = store.readData();
    const rules = store.getRules();
    const updated = store.applyRules(data.transactions, rules);
    res.json({ updated: updated.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Advice (deterministic coach findings)
// ────────────────────────────────────────────────────────────────────────────

// Gather everything computeAdvice() needs. Shared by /advice and /digest so the
// finding set is identical in both surfaces.
function adviceContext() {
  const data = store.readData();
  const metrics = store.getMetrics();
  const recurring = store.detectRecurring(store.getTransactions(), store.getDeclaredRecurring());
  const goalInsights = store.computeGoalInsights(data.accounts, data.transactions, recurring);
  const budgetStatus = store.computeBudgetStatus(data.budgets, data.transactions);
  const cashflow = store.projectCashflow(store.getAccounts(), recurring, 90);
  const investments = store.computeInvestmentMetrics(store.getHoldings());
  const debts = data.accounts
    .filter((a) => a.type === 'loan' || a.type === 'credit')
    .map((a) => ({
      name: a.name,
      balance: Math.abs(parseFloat(a.balance) || 0),
      apr: a.apr || (a.type === 'credit' ? 0.20 : 0.07),
    }));

  // Current vs previous full month expense totals (string-prefix month match,
  // same convention as /overview to avoid UTC drift).
  const now = new Date();
  const thisYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastYm = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const sumMonth = (ym) => data.transactions
    .filter((t) => t.amount < 0 && String(t.date).slice(0, 7) === ym)
    .reduce((s, t) => s + Math.abs(parseFloat(t.amount) || 0), 0);

  const input = {
    metrics, goalInsights, budgetStatus, categories: data.categories, cashflow,
    debts, goals: data.goals, accounts: data.accounts, recurring, investments,
    spendThisMonth: sumMonth(thisYm), spendLastMonth: sumMonth(lastYm),
  };
  return { data, metrics, goalInsights, input };
}

router.get('/advice', (req, res) => {
  try {
    res.json({ findings: advice.computeAdvice(adviceContext().input) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/digest', (req, res) => {
  try {
    const { data, metrics, goalInsights, input } = adviceContext();
    const findings = advice.computeAdvice(input);

    // Rolling 7-day windows (local calendar dates, string-compared).
    const dayStr = (offset) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const today = dayStr(0);
    const thisStart = dayStr(-6);
    const lastStart = dayStr(-13);
    const lastEnd = dayStr(-7);
    const inRange = (d, a, b) => { const s = String(d).slice(0, 10); return s >= a && s <= b; };

    const tx = data.transactions;
    const spendIn = (a, b) => tx.filter((t) => t.amount < 0 && inRange(t.date, a, b)).reduce((s, t) => s + Math.abs(parseFloat(t.amount) || 0), 0);
    const incomeIn = (a, b) => tx.filter((t) => t.amount > 0 && inRange(t.date, a, b)).reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    const spendThisWeek = spendIn(thisStart, today);
    const spendLastWeek = spendIn(lastStart, lastEnd);
    const savedThisWeek = incomeIn(thisStart, today) - spendThisWeek;

    // Net-worth change vs the newest snapshot at least 7 days old.
    let netWorthDelta = null;
    const snaps = store.getNetWorthSnapshots();
    if (Array.isArray(snaps) && snaps.length) {
      const past = snaps.filter((s) => String(s.date).slice(0, 10) <= lastEnd).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      if (past && Number.isFinite(Number(past.net))) netWorthDelta = Math.round(((metrics.net_worth || 0) - Number(past.net)) * 100) / 100;
    }

    // Biggest category increase this week vs last week.
    let topMover = null;
    const byCat = {};
    const bump = (cid, field, amt) => { (byCat[cid] = byCat[cid] || { now: 0, prev: 0 })[field] += amt; };
    tx.filter((t) => t.amount < 0).forEach((t) => {
      const amt = Math.abs(parseFloat(t.amount) || 0);
      if (inRange(t.date, thisStart, today)) bump(t.category_id, 'now', amt);
      else if (inRange(t.date, lastStart, lastEnd)) bump(t.category_id, 'prev', amt);
    });
    Object.entries(byCat).forEach(([cid, v]) => {
      const delta = v.now - v.prev;
      if (delta > 0 && (!topMover || delta > topMover.delta)) {
        const cat = data.categories.find((c) => c.id === cid);
        topMover = { category: cat?.name || 'Something', delta: Math.round(delta) };
      }
    });

    const digest = advice.computeDigest({
      weekOf: thisStart,
      savedThisWeek,
      spendThisWeek,
      spendLastWeek,
      netWorthDelta,
      topMover,
      emergencyFund: goalInsights.emergencyFund || null,
      findings,
    });
    res.json(digest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Coach chat (grounded local LLM — optional, falls back to rules)
// ────────────────────────────────────────────────────────────────────────────

router.get('/coach/status', async (req, res) => {
  try {
    res.json(await ollama.status(req.query.model));
  } catch (err) {
    res.json({ available: false, models: [], model: null, error: err.message });
  }
});

router.post('/coach', async (req, res) => {
  try {
    const msgs = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
    const history = msgs
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-8);
    if (!history.length) return res.status(400).json({ error: 'messages required' });

    const st = await ollama.status(req.body && req.body.model);
    if (!st.available) return res.json({ available: false });

    const { data, metrics, goalInsights, input } = adviceContext();
    const findings = advice.computeAdvice(input);
    const facts = {
      netWorth: metrics.net_worth,
      assets: metrics.assets,
      liabilities: metrics.liabilities,
      monthlyIncome: metrics.monthly_income,
      monthlyExpenses: metrics.monthly_expenses,
      monthlySurplus: metrics.monthly_surplus,
      savingsRate: metrics.savings_rate,
      runwayMonths: metrics.runway_months,
      liquidSavings: metrics.liquid_savings,
      emergencyFund: goalInsights.emergencyFund || null,
      accounts: data.accounts
        .filter((a) => a.type !== 'loan' && a.type !== 'credit')
        .slice(0, 12)
        .map((a) => ({ name: a.name, type: a.type, balance: parseFloat(a.balance) || 0 })),
      debts: input.debts,
    };
    const system = coachSystemPrompt({ facts, findings });
    const reply = await ollama.chat({
      model: st.model,
      messages: [{ role: 'system', content: system }, ...history],
    });
    res.json({ available: true, reply, model: st.model });
  } catch (err) {
    // Model timeout / crash / OOM → tell the client to fall back to rules.
    res.json({ available: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Glossary
// ────────────────────────────────────────────────────────────────────────────

let _glossary = null; // static bundled JSON — read once, serve from memory
function loadGlossary() {
  if (!_glossary) {
    const path = require('path');
    const fs = require('fs');
    _glossary = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'store', 'money', 'glossary.json'), 'utf8'));
  }
  return _glossary;
}
router.get('/glossary', (req, res) => {
  try {
    const g = loadGlossary();
    const q = String(req.query.term || '').trim().toLowerCase();
    if (!q) return res.json(g);
    const hit = (g.terms || []).find(t => String(t.term).toLowerCase() === q);
    if (!hit) return res.status(404).json({ error: `No glossary entry for "${req.query.term}"` });
    res.json({ term: hit.term, definition: hit.plain, more: hit.more || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Seed & reset
// ────────────────────────────────────────────────────────────────────────────

router.post('/seed-sample', (req, res) => {
  try {
    const path = require('path');
    const samplePath = path.join(__dirname, '..', 'store', 'money', 'sample.money.json');
    store.seedSample(samplePath);
    res.json({ seeded: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/reset', (req, res) => {
  try {
    store.reset();
    res.json({ reset: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Backup export / import (full data blob — stays on the device)
// ────────────────────────────────────────────────────────────────────────────

router.get('/export', (req, res) => {
  try {
    res.json(store.readData());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/import', (req, res) => {
  try {
    // Accept both a raw data blob (GET /export) and the automatic-backup
    // wrapper ({ format: 'mmm-backup@1', data, settings }).
    const body = req.body;
    const data = body && body.format === 'mmm-backup@1' ? body.data : body;
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        !Array.isArray(data.accounts) || !Array.isArray(data.transactions)) {
      return res.status(400).json({ error: 'Not a valid MMM backup (missing accounts/transactions arrays).' });
    }
    store.writeData(data);
    res.json({
      imported: true,
      counts: {
        accounts: data.accounts.length,
        transactions: data.transactions.length,
        budgets: Array.isArray(data.budgets) ? data.budgets.length : 0,
        goals: Array.isArray(data.goals) ? data.goals.length : 0,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
