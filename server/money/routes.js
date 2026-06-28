const express = require('express');
const store = require('./store');

const router = express.Router();

// ────────────────────────────────────────────────────────────────────────────
// GET /api/money/overview
// ────────────────────────────────────────────────────────────────────────────

router.get('/overview', (req, res) => {
  try {
    const data = store.readData();
    const nw = store.computeNetWorth(data.accounts);

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
    const { name, type, balance, institution, currency, status } = req.body;
    const account = store.createAccount(name, type, balance, institution, currency, status);
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
    const { account_id, date, amount, payee, category_id, tags, note, source, cleared } = req.body;
    const transaction = store.createTransaction(
      account_id,
      date,
      amount,
      payee,
      category_id,
      tags,
      note,
      source,
      cleared
    );
    res.status(201).json({ transaction });
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
    const { name, target, current, linked_account_id, target_date, template, monthly_contribution } = req.body;
    const goal = store.createGoal(name, target, current, linked_account_id, target_date, template, monthly_contribution);
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
// Tax
// ────────────────────────────────────────────────────────────────────────────

router.get('/tax', (req, res) => {
  try {
    const data = store.readData();
    const taxEstimate = store.computeTaxEstimate(data.transactions);
    res.json(taxEstimate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tax/deduction', (req, res) => {
  try {
    const { category, amount, note } = req.body;
    if (!category || !amount) {
      return res.status(400).json({ error: 'category and amount required' });
    }
    const deduction = store.createDeduction(category, amount, note);
    res.status(201).json({ deduction });
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
// AI Coach
// ────────────────────────────────────────────────────────────────────────────

const { callLocalModel } = require('../nexus/local-model-client');
const Anthropic = require('@anthropic-ai/sdk');

function getAIClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

router.post('/coach', async (req, res) => {
  try {
    const { message, persona } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    const data = store.readData();
    const recurring = store.detectRecurring(data.transactions, data.recurring);
    const nw = store.computeNetWorth(data.accounts);
    const budgetStatus = store.computeBudgetStatus(data.budgets, data.transactions);

    // Build context
    const context = `
Net Worth: $${nw.net}
Liquid Assets: ${data.accounts.filter(a => a.type === 'checking' || a.type === 'savings' || a.type === 'cash').reduce((s, a) => s + (parseFloat(a.balance) || 0), 0)}
Liabilities: $${nw.liabilities}
Monthly Budget Status: ${budgetStatus.length > 0 ? budgetStatus.map(b => `${b.pct}% of budget`).join(', ') : 'No budgets'}
Recurring Income & Bills: ${recurring.length > 0 ? recurring.map(r => `${r.payee} (${r.cadence})`).join(', ') : 'None detected'}
Goals: ${store.getGoals().length > 0 ? store.getGoals().map(g => `${g.name} ($${g.target})`).join(', ') : 'None set'}
`.trim();

    // Persona prompt
    const personaMap = {
      ramsey: 'You are Dave Ramsey, the debt destroyer. Focus on cash flow, eliminating debt, and building wealth through disciplined saving. Answer with tough-love, direct advice.',
      buffett: 'You are Warren Buffett, the compounder. Focus on long-term wealth building, understanding value, and staying patient. Answer with wisdom about compounding and intrinsic value.',
      cuban: 'You are Mark Cuban, the equity builder. Focus on cash flow, controlling debt, and building assets you control. Answer with blunt, high-energy, action-oriented advice.',
      kiyosaki: 'You are Robert Kiyosaki, the cash flow architect. Focus on assets that produce passive income and building wealth. Answer with contrarian wisdom about the rich.',
    };

    const systemPrompt = personaMap[persona] || 'You are a personal finance coach. Provide actionable, friendly financial guidance based on the user\'s situation.';

    const fullMessage = `User financial context:\n${context}\n\nUser message: ${message}`;

    let reply = null;
    let usedModel = null;

    // Try Claude first
    const anthropic = getAIClient();
    if (anthropic) {
      try {
        const response = await anthropic.messages.create({
          model: process.env.MONEY_COACH_MODEL || 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          system: systemPrompt,
          messages: [{ role: 'user', content: fullMessage }],
        });
        reply = response.content.find(b => b.type === 'text')?.text || null;
        usedModel = 'claude-api';
      } catch (e) {
        // Fall back to local
        const result = await callLocalModel('coach', {
          system: systemPrompt,
          user: fullMessage,
          temperature: 0.7,
          timeoutMs: 30000,
        });
        reply = result.parsed?.response || result.raw || null;
        usedModel = 'local-ollama';
      }
    } else {
      // No Claude key, try Ollama
      const result = await callLocalModel('coach', {
        system: systemPrompt,
        user: fullMessage,
        temperature: 0.7,
        timeoutMs: 30000,
      });
      reply = result.parsed?.response || result.raw || null;
      usedModel = 'local-ollama';
    }

    if (!reply) {
      reply = 'Coach is temporarily unavailable. Try again or check your API/Ollama setup.';
    }

    res.json({
      reply: reply.slice(0, 1000), // cap at 1000 chars
      persona: persona || 'balanced',
      usedModel,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/coach/nudges', (req, res) => {
  try {
    const data = store.readData();
    const budgetStatus = store.computeBudgetStatus(data.budgets, data.transactions);
    const insights = store.computeGoalInsights(data.accounts, data.transactions);

    const nudges = [];

    // Over-budget categories
    budgetStatus.forEach(b => {
      if (b.pct > 100) {
        nudges.push({
          level: 'warn',
          title: 'Over Budget',
          detail: `You've exceeded your budget by ${b.pct - 100}%.`,
          section: 'budget',
        });
      }
    });

    // Low emergency fund
    if (insights.emergencyFund.adequacy === 'low') {
      nudges.push({
        level: 'warn',
        title: 'Low Emergency Fund',
        detail: `You have ${insights.emergencyFund.monthsCovered} months of expenses saved. Target is ${insights.emergencyFund.targetMonths}.`,
        section: 'goals',
      });
    }

    // Debt warning
    const debts = data.accounts.filter(a => a.type === 'loan' || a.type === 'credit' && parseFloat(a.balance) > 0);
    if (debts.length > 0) {
      const totalDebt = debts.reduce((s, a) => s + Math.abs(parseFloat(a.balance) || 0), 0);
      nudges.push({
        level: 'info',
        title: `${totalDebt > 10000 ? 'High Debt' : 'Debt Detected'}`,
        detail: `You have $${Math.round(totalDebt)} in debt. Consider a payoff plan.`,
        section: 'debt',
      });
    }

    // Low savings rate
    const monthlyExpenses = insights.emergencyFund.monthlyExpenses;
    if (monthlyExpenses > 0) {
      nudges.push({
        level: 'info',
        title: 'Track Your Savings Rate',
        detail: `Your monthly expenses are ~$${Math.round(monthlyExpenses)}. Aim to save 20%+ of income.`,
        section: 'savings',
      });
    }

    // Upcoming large bills
    const recurring = store.detectRecurring(data.transactions, data.recurring);
    const largeBills = recurring.filter(r => r.kind === 'bill' && parseFloat(r.amount) > monthlyExpenses * 0.25);
    if (largeBills.length > 0) {
      nudges.push({
        level: 'info',
        title: 'Upcoming Large Bills',
        detail: `${largeBills.map(b => b.payee).join(', ')} are significant monthly expenses.`,
        section: 'cashflow',
      });
    }

    res.json({ nudges: nudges.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

module.exports = router;
