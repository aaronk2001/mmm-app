const express = require('express');
const store = require('./store');

const router = express.Router();

// ────────────────────────────────────────────────────────────────────────────
// GET /api/money/overview
// ────────────────────────────────────────────────────────────────────────────

router.get('/overview', (req, res) => {
  try {
    const data = store.readData();
    const cc = store.getCurrencyConfig();
    const nw = store.computeNetWorth(data.accounts, cc.baseCurrency, cc.fxRates);

    // Top categories this month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const categorySpend = {};
    data.transactions
      .filter(t => {
        const tDate = new Date(t.date);
        return t.amount < 0 &&
               tDate >= monthStart &&
               tDate <= monthEnd;
      })
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

    // Recent snapshots (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentSnapshots = data.networth_snapshots
      .filter(s => new Date(s.date) >= thirtyDaysAgo)
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
    const { name, type, balance, institution, currency, status, custom } = req.body;
    const account = store.createAccount(name, type, balance, institution, currency, status, custom);
    res.status(201).json({ account });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/accounts/:id', (req, res) => {
  try {
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
    const updated = store.updateTransactionsBulk(ids, updates);
    res.json({ updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/transactions/bulk-delete', (req, res) => {
  try {
    const { ids } = req.body;
    const deleted = store.deleteTransactionsBulk(ids);
    res.json({ deleted });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/transactions/:id', (req, res) => {
  try {
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

// ────────────────────────────────────────────────────────────────────────────
// Transactions import
// ────────────────────────────────────────────────────────────────────────────

router.post('/transactions/import', (req, res) => {
  try {
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
    const { category_id, period, limit, rollover } = req.body;
    const budget = store.createBudget(category_id, period, limit, rollover);
    res.status(201).json({ budget });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/budgets/:id', (req, res) => {
  try {
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
    const { account_id, symbol, shares, cost_basis, current_price } = req.body;
    const holding = store.createHolding(account_id, symbol, shares, cost_basis, current_price);
    res.status(201).json({ holding });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/holdings/:id', (req, res) => {
  try {
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
    const data = store.readData();
    const recurring = store.detectRecurring(data.transactions, data.recurring);
    res.json({ recurring });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Cashflow projection
// ────────────────────────────────────────────────────────────────────────────

router.get('/cashflow', (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 90;
    const data = store.readData();
    const recurring = store.detectRecurring(data.transactions, data.recurring);
    const projection = store.projectCashflow(data.accounts, recurring, days);
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
    const { name, target, current, linked_account_id, target_date, template, monthly_contribution, custom } = req.body;
    const goal = store.createGoal(name, target, current, linked_account_id, target_date, template, monthly_contribution, custom);
    res.status(201).json({ goal });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/goals/:id', (req, res) => {
  try {
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
    const insights = store.computeGoalInsights(data.accounts, data.transactions);
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
    const { match, category_id, tag } = req.body;
    const rule = store.createRule(match, category_id, tag);
    res.status(201).json({ rule });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/rules/:id', (req, res) => {
  try {
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
// Glossary
// ────────────────────────────────────────────────────────────────────────────

router.get('/glossary', (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const glossaryPath = path.join(__dirname, '..', 'store', 'money', 'glossary.json');
    const glossary = JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));
    res.json(glossary);
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
