const fs = require('fs');
const path = require('path');

const MONEY_DIR = path.join(__dirname, '..', 'store', 'money');
const DATA_FILE = path.join(MONEY_DIR, 'data.json');

// ────────────────────────────────────────────────────────────────────────────
// File I/O
// ────────────────────────────────────────────────────────────────────────────

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return getEmptyData();
  }
}

function writeData(data) {
  fs.mkdirSync(MONEY_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getEmptyData() {
  return {
    accounts: [],
    transactions: [],
    categories: getDefaultCategories(),
    budgets: [],
    networth_snapshots: [],
  };
}

function getDefaultCategories() {
  return [
    { id: 'inc', name: 'Income', group: 'income', color: '#10b981', icon: 'plus' },
    { id: 'hou', name: 'Housing', group: 'expenses', color: '#f59e0b', icon: 'home' },
    { id: 'fod', name: 'Food & Dining', group: 'expenses', color: '#ef4444', icon: 'utensils' },
    { id: 'tra', name: 'Transportation', group: 'expenses', color: '#3b82f6', icon: 'car' },
    { id: 'sho', name: 'Shopping', group: 'expenses', color: '#8b5cf6', icon: 'bag' },
    { id: 'uti', name: 'Utilities', group: 'expenses', color: '#ec4899', icon: 'zap' },
    { id: 'ent', name: 'Entertainment', group: 'expenses', color: '#06b6d4', icon: 'film' },
    { id: 'hea', name: 'Health', group: 'expenses', color: '#06b6d4', icon: 'heart' },
    { id: 'sav', name: 'Savings', group: 'transfers', color: '#14b8a6', icon: 'piggy-bank' },
    { id: 'sub', name: 'Subscriptions', group: 'expenses', color: '#a78bfa', icon: 'layers' },
    { id: 'oth', name: 'Other', group: 'expenses', color: '#6b7280', icon: 'circle' },
  ];
}

// ────────────────────────────────────────────────────────────────────────────
// ID generation & utilities
// ────────────────────────────────────────────────────────────────────────────

function newId() {
  return Math.random().toString(36).substring(2, 11);
}

// Simple CSV parser — no external dependency
function parseCSV(csvText, mapping) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }

  if (mapping) {
    return rows.map(row => ({
      date: row[mapping.date] || row['date'] || '',
      amount: row[mapping.amount] || row['amount'] || '',
      payee: row[mapping.payee] || row['payee'] || '',
      note: row[mapping.note] || row['note'] || '',
    }));
  }

  return rows.map(row => ({
    date: row.date || row['Date'] || '',
    amount: row.amount || row['Amount'] || '',
    payee: row.payee || row['Payee'] || '',
    note: row.note || row['Note'] || '',
  }));
}

// ────────────────────────────────────────────────────────────────────────────
// Auto-categorize
// ────────────────────────────────────────────────────────────────────────────

function autoCategorize(payee, amount) {
  if (!payee) return 'oth';

  const p = payee.toLowerCase();

  // Income rules
  if (/payroll|salary|deposit|transfer in|direct deposit/i.test(p)) return 'inc';

  // Housing
  if (/rent|mortgage|landlord|property/i.test(p)) return 'hou';

  // Food & Dining
  if (/whole foods|grocery|safeway|kroger|trader joe|restaurant|chipotle|pizza|mcdonalds|subway|doordash|ubereats|grubhub|dine/i.test(p)) return 'fod';

  // Transportation
  if (/uber|lyft|taxi|gas|shell|chevron|exxon|parking|metro|transit|train|bus|car wash|mechanic|honda|ford|tesla|auto|vehicle/i.test(p)) return 'tra';

  // Shopping
  if (/amazon|target|walmart|costco|target|mall|store|retail|ebay|etsy|clothing|apparel/i.test(p)) return 'sho';

  // Utilities
  if (/electric|water|gas|internet|phone|verizon|at&t|comcast|utility|power/i.test(p)) return 'uti';

  // Entertainment
  if (/movie|cinema|theater|concert|game|steam|playstation|xbox|ticket|event|museum|zoo|park/i.test(p)) return 'ent';

  // Subscriptions
  if (/netflix|spotify|hulu|disney|apple|subscription|adobe|premium|membership/i.test(p)) return 'sub';

  // Health
  if (/doctor|hospital|pharmacy|cvs|walgreens|clinic|medical|health|dental|gym|fitness|yoga/i.test(p)) return 'hea';

  // Savings (transfer to savings)
  if (/savings|transfer out|investment|brokerage/i.test(p)) return 'sav';

  return 'oth';
}

// ────────────────────────────────────────────────────────────────────────────
// Net worth calculation
// ────────────────────────────────────────────────────────────────────────────

function computeNetWorth(accounts) {
  let assets = 0;
  let liabilities = 0;

  accounts.forEach(acc => {
    const balance = parseFloat(acc.balance) || 0;
    const type = acc.type;

    if (type === 'loan' || type === 'credit') {
      liabilities += Math.abs(balance); // Treat as positive liabilities
    } else {
      assets += Math.max(0, balance); // Only count positive balances
    }
  });

  return {
    assets: Math.round(assets * 100) / 100,
    liabilities: Math.round(liabilities * 100) / 100,
    net: Math.round((assets - liabilities) * 100) / 100,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Budget computation
// ────────────────────────────────────────────────────────────────────────────

function computeBudgetStatus(budgets, transactions) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return budgets
    .filter(b => b.period === 'monthly')
    .map(budget => {
      const spent = transactions
        .filter(t => {
          const tDate = new Date(t.date);
          return t.category_id === budget.category_id &&
                 t.amount < 0 && // Only expenses
                 tDate >= monthStart &&
                 tDate <= monthEnd;
        })
        .reduce((sum, t) => sum + Math.abs(parseFloat(t.amount) || 0), 0);

      const limit = parseFloat(budget.limit) || 0;
      const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;

      return {
        budget_id: budget.id,
        category_id: budget.category_id,
        limit: Math.round(limit * 100) / 100,
        spent: Math.round(spent * 100) / 100,
        pct,
      };
    });
}

// ────────────────────────────────────────────────────────────────────────────
// Recurring detection (from transactions + declared data)
// ────────────────────────────────────────────────────────────────────────────

function detectRecurring(transactions, declaredRecurring = []) {
  if (transactions.length === 0) return declaredRecurring || [];

  // Group transactions by payee and amount (with 10% tolerance)
  const groups = {};
  transactions.forEach(t => {
    const key = t.payee.toLowerCase();
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });

  const recurring = [];
  const now = new Date();

  Object.entries(groups).forEach(([payee, txns]) => {
    // Need at least 2 transactions to detect pattern
    if (txns.length < 2) return;

    txns.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Check if amounts are similar (within 10%)
    const amounts = txns.map(t => Math.abs(parseFloat(t.amount) || 0));
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const tolerance = avgAmount * 0.1;
    const amountVariance = amounts.every(a => Math.abs(a - avgAmount) <= tolerance);

    if (!amountVariance) return;

    // Detect cadence (monthly, biweekly, weekly)
    const dates = txns.map(t => new Date(t.date).getTime());
    const intervals = [];
    for (let i = 1; i < dates.length; i++) {
      intervals.push(Math.round((dates[i] - dates[i - 1]) / 86400000)); // days
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    let cadence = 'other';
    if (avgInterval >= 28 && avgInterval <= 35) cadence = 'monthly';
    else if (avgInterval >= 13 && avgInterval <= 15) cadence = 'biweekly';
    else if (avgInterval >= 6 && avgInterval <= 8) cadence = 'weekly';

    if (cadence === 'other') return;

    const kind = parseFloat(txns[0].amount) > 0 ? 'income' : 'bill';
    const lastTxn = txns[txns.length - 1];
    const lastDate = new Date(lastTxn.date);

    // Project next date
    let nextDate = new Date(lastDate);
    if (cadence === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1);
    else if (cadence === 'biweekly') nextDate.setDate(nextDate.getDate() + 14);
    else if (cadence === 'weekly') nextDate.setDate(nextDate.getDate() + 7);

    recurring.push({
      payee,
      amount: Math.round(avgAmount * 100) / 100,
      cadence,
      kind,
      last_date: lastTxn.date,
      next_date: nextDate.toISOString().split('T')[0],
    });
  });

  // Merge with declared recurring (declared takes precedence)
  const declaredPayees = new Set((declaredRecurring || []).map(r => r.payee.toLowerCase()));
  const merged = [...declaredRecurring || [], ...recurring.filter(r => !declaredPayees.has(r.payee.toLowerCase()))];

  return merged;
}

// ────────────────────────────────────────────────────────────────────────────
// Cashflow projection
// ────────────────────────────────────────────────────────────────────────────

function projectCashflow(accounts, recurring, days = 90) {
  const startBalance = accounts
    .filter(a => a.type === 'checking' || a.type === 'savings' || a.type === 'cash')
    .reduce((sum, a) => sum + (parseFloat(a.balance) || 0), 0);

  // Compute average daily discretionary spend (last 60 days of transactions)
  const data = readData();
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const recentExpenses = data.transactions
    .filter(t => new Date(t.date) >= sixtyDaysAgo && t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(parseFloat(t.amount) || 0), 0);

  const avgDailyDiscretionary = recentExpenses / 60;

  // Build projection
  const projection = [];
  const lowBalanceWarnings = [];
  let currentBalance = startBalance;
  const today = new Date();

  for (let d = 0; d <= days; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().split('T')[0];

    // Apply recurring transactions
    recurring.forEach(r => {
      const nextDate = new Date(r.next_date);
      let checkDate = nextDate;

      // Project forward in 90-day window
      while (checkDate <= date) {
        if (checkDate.toISOString().split('T')[0] === dateStr) {
          const delta = r.kind === 'income' ? parseFloat(r.amount) : -parseFloat(r.amount);
          currentBalance += delta;
        }

        // Advance to next occurrence
        if (r.cadence === 'monthly') checkDate.setMonth(checkDate.getMonth() + 1);
        else if (r.cadence === 'biweekly') checkDate.setDate(checkDate.getDate() + 14);
        else if (r.cadence === 'weekly') checkDate.setDate(checkDate.getDate() + 7);
      }
    });

    // Apply average daily discretionary spend
    currentBalance -= avgDailyDiscretionary;

    projection.push({
      date: dateStr,
      balance: Math.round(currentBalance * 100) / 100,
    });

    if (currentBalance < 500) {
      lowBalanceWarnings.push({
        date: dateStr,
        balance: Math.round(currentBalance * 100) / 100,
      });
    }
  }

  const lowestProjection = projection.reduce((min, p) => p.balance < min.balance ? p : min);

  return {
    startBalance: Math.round(startBalance * 100) / 100,
    days,
    projection,
    recurring: recurring.map(r => ({
      payee: r.payee,
      amount: r.amount,
      cadence: r.cadence,
      kind: r.kind,
    })),
    lowBalanceWarnings,
    summary: {
      endBalance: projection[projection.length - 1]?.balance || startBalance,
      lowestBalance: lowestProjection.balance,
      lowestDate: lowestProjection.date,
      netChange: Math.round((projection[projection.length - 1]?.balance - startBalance) * 100) / 100,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Goals CRUD
// ────────────────────────────────────────────────────────────────────────────

function getGoals() {
  const data = readData();
  return data.goals || [];
}

function createGoal(name, target, current = 0, linked_account_id = null, target_date = null, template = null, monthly_contribution = null) {
  if (!name || !target) throw new Error('name and target required');

  const data = readData();
  if (!data.goals) data.goals = [];

  const goal = {
    id: newId(),
    name,
    target: parseFloat(target),
    current: parseFloat(current),
    linked_account_id,
    target_date,
    template,
    monthly_contribution: monthly_contribution ? parseFloat(monthly_contribution) : null,
  };

  data.goals.push(goal);
  writeData(data);
  return goal;
}

function updateGoal(id, updates) {
  const data = readData();
  if (!data.goals) data.goals = [];

  const idx = data.goals.findIndex(g => g.id === id);
  if (idx === -1) throw new Error('Goal not found');

  data.goals[idx] = { ...data.goals[idx], ...updates, id };
  writeData(data);
  return data.goals[idx];
}

function deleteGoal(id) {
  const data = readData();
  if (!data.goals) data.goals = [];

  const idx = data.goals.findIndex(g => g.id === id);
  if (idx === -1) throw new Error('Goal not found');

  data.goals.splice(idx, 1);
  writeData(data);
}

function computeGoalInsights(accounts, transactions) {
  const data = readData();

  // Monthly expenses (average of last 60 days)
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const monthlyExpenses = transactions
    .filter(t => new Date(t.date) >= sixtyDaysAgo && t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(parseFloat(t.amount) || 0), 0) / 2;

  // Liquid assets (checking + savings + cash)
  const liquidAssets = accounts
    .filter(a => a.type === 'checking' || a.type === 'savings' || a.type === 'cash')
    .reduce((sum, a) => sum + (parseFloat(a.balance) || 0), 0);

  // Emergency fund
  const emergencyFundMonths = 6;
  const emergencyFundTarget = monthlyExpenses * emergencyFundMonths;
  const emergencyFundCovered = Math.floor(liquidAssets / (monthlyExpenses || 1));

  const emergencyFundAdequacy = liquidAssets >= emergencyFundTarget ? 'good' : liquidAssets >= (monthlyExpenses * 3) ? 'ok' : 'low';

  // Net worth
  const nw = computeNetWorth(accounts);

  // FIRE (annualize expenses, use 25x rule)
  const annualExpenses = monthlyExpenses * 12;
  const fireNumber = annualExpenses * 25;
  const fireProgress = (nw.net / fireNumber) * 100;

  // Years to FIRE (simple: assume 10% annual return, current savings rate = monthly surplus)
  const monthlyIncome = transactions
    .filter(t => new Date(t.date) >= sixtyDaysAgo && t.amount > 0)
    .reduce((sum, t) => sum + parseFloat(t.amount) || 0, 0) / 2;

  const monthlySavings = monthlyIncome - monthlyExpenses;
  const yearsToFire = monthlySavings > 0 ? (fireNumber - nw.net) / (monthlySavings * 12 * 0.1 + monthlySavings * 12) : null;

  return {
    emergencyFund: {
      monthlyExpenses: Math.round(monthlyExpenses * 100) / 100,
      targetMonths: emergencyFundMonths,
      targetAmount: Math.round(emergencyFundTarget * 100) / 100,
      currentSaved: Math.round(liquidAssets * 100) / 100,
      monthsCovered: emergencyFundCovered,
      adequacy: emergencyFundAdequacy,
    },
    fire: {
      annualExpenses: Math.round(annualExpenses * 100) / 100,
      fireNumber: Math.round(fireNumber),
      currentNetWorth: Math.round(nw.net * 100) / 100,
      progressPct: Math.round(fireProgress * 10) / 10,
      yearsToFire: yearsToFire ? Math.round(yearsToFire * 10) / 10 : null,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Rules engine CRUD
// ────────────────────────────────────────────────────────────────────────────

function getRules() {
  const data = readData();
  return data.rules || [];
}

function createRule(match, category_id, tag = null) {
  if (!match || !category_id) throw new Error('match and category_id required');

  const data = readData();
  if (!data.rules) data.rules = [];

  const rule = {
    id: newId(),
    match,
    category_id,
    tag: tag || null,
  };

  data.rules.push(rule);
  writeData(data);
  return rule;
}

function updateRule(id, updates) {
  const data = readData();
  if (!data.rules) data.rules = [];

  const idx = data.rules.findIndex(r => r.id === id);
  if (idx === -1) throw new Error('Rule not found');

  data.rules[idx] = { ...data.rules[idx], ...updates, id };
  writeData(data);
  return data.rules[idx];
}

function deleteRule(id) {
  const data = readData();
  if (!data.rules) data.rules = [];

  const idx = data.rules.findIndex(r => r.id === id);
  if (idx === -1) throw new Error('Rule not found');

  data.rules.splice(idx, 1);
  writeData(data);
}

function applyRules(transactions, rules) {
  const updated = [];

  transactions.forEach(t => {
    let matchedCategoryId = null;

    for (const rule of rules) {
      // Try substring match first
      if (t.payee.toLowerCase().includes(rule.match.toLowerCase())) {
        matchedCategoryId = rule.category_id;
        break;
      }

      // Try regex match
      try {
        const regex = new RegExp(rule.match, 'i');
        if (regex.test(t.payee)) {
          matchedCategoryId = rule.category_id;
          break;
        }
      } catch {
        // Invalid regex, skip
      }
    }

    if (matchedCategoryId && t.category_id !== matchedCategoryId) {
      t.category_id = matchedCategoryId;
      updated.push(t.id);
    }
  });

  if (updated.length > 0) {
    const data = readData();
    data.transactions = transactions;
    writeData(data);
  }

  return updated;
}

// ────────────────────────────────────────────────────────────────────────────
// Tax helpers (simple estimation)
// ────────────────────────────────────────────────────────────────────────────

function computeTaxEstimate(transactions) {
  const data = readData();
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);

  // YTD income (positive amounts, income category)
  const incomeCategory = data.categories.find(c => c.id === 'inc');
  const ytdIncome = transactions
    .filter(t => new Date(t.date) >= yearStart && t.category_id === 'inc' && t.amount > 0)
    .reduce((sum, t) => sum + parseFloat(t.amount) || 0, 0);

  // Estimate annual (extrapolate YTD to full year)
  const daysPassed = Math.ceil((now - yearStart) / 86400000);
  const estimatedAnnual = (ytdIncome / daysPassed) * 365;

  // Simple tax brackets (2024 US, single filer)
  const brackets = [
    { rate: 0.10, upTo: 11600 },
    { rate: 0.12, upTo: 47150 },
    { rate: 0.22, upTo: 100525 },
  ];

  let tax = 0;
  let prev = 0;
  const taxableIncome = Math.max(0, estimatedAnnual - 14600); // standard deduction

  for (const bracket of brackets) {
    if (taxableIncome <= prev) break;
    const taxable = Math.min(taxableIncome, bracket.upTo) - prev;
    tax += taxable * bracket.rate;
    prev = bracket.upTo;
  }

  // Add FICA (7.65% if self-employed context, 0 for W2)
  const ficaTax = estimatedAnnual * 0.0765;
  const totalTax = tax + ficaTax;

  // Quarterly estimates (divide by 4)
  const quarterlyEstimate = Math.round((totalTax / 4) * 100) / 100;

  return {
    ytdIncome: Math.round(ytdIncome * 100) / 100,
    estimatedAnnualIncome: Math.round(estimatedAnnual * 100) / 100,
    deductions: data.deductions || [],
    quarterlyEstimate: {
      q1: quarterlyEstimate,
      q2: quarterlyEstimate,
      q3: quarterlyEstimate,
      q4: quarterlyEstimate,
    },
    bracketInfo: 'Based on 2024 US single filer standard deduction ($14,600) and tax brackets.',
    disclaimer: 'Educational only, not tax advice. Consult a CPA.',
  };
}

function createDeduction(category, amount, note = '') {
  const data = readData();
  if (!data.deductions) data.deductions = [];

  const deduction = {
    id: newId(),
    category,
    amount: parseFloat(amount),
    note,
    date: new Date().toISOString().split('T')[0],
  };

  data.deductions.push(deduction);
  writeData(data);
  return deduction;
}

// ────────────────────────────────────────────────────────────────────────────
// Snapshot management
// ────────────────────────────────────────────────────────────────────────────

function ensureDailySnapshot(data) {
  const today = new Date().toISOString().split('T')[0];
  const hasToday = data.networth_snapshots.some(s => s.date === today);

  if (!hasToday) {
    const nw = computeNetWorth(data.accounts);
    data.networth_snapshots.push({
      date: today,
      assets: nw.assets,
      liabilities: nw.liabilities,
      net: nw.net,
    });
  }

  return data;
}

// ────────────────────────────────────────────────────────────────────────────
// CRUD: Accounts
// ────────────────────────────────────────────────────────────────────────────

function getAccounts() {
  return readData().accounts;
}

function createAccount(name, type, balance, institution, currency = 'USD', status = 'active') {
  if (!name || !type) throw new Error('name and type required');

  const data = readData();
  const account = {
    id: newId(),
    name,
    type,
    balance: parseFloat(balance) || 0,
    institution: institution || '',
    currency,
    status,
    created_at: new Date().toISOString(),
  };

  data.accounts.push(account);
  writeData(data);
  return account;
}

function updateAccount(id, updates) {
  const data = readData();
  const idx = data.accounts.findIndex(a => a.id === id);
  if (idx === -1) throw new Error('Account not found');

  data.accounts[idx] = { ...data.accounts[idx], ...updates, id };
  writeData(data);
  return data.accounts[idx];
}

function deleteAccount(id) {
  const data = readData();
  const idx = data.accounts.findIndex(a => a.id === id);
  if (idx === -1) throw new Error('Account not found');

  data.accounts.splice(idx, 1);
  // Also remove any transactions for this account
  data.transactions = data.transactions.filter(t => t.account_id !== id);
  writeData(data);
}

// ────────────────────────────────────────────────────────────────────────────
// CRUD: Transactions
// ────────────────────────────────────────────────────────────────────────────

function getTransactions(filters = {}) {
  const data = readData();
  let txns = data.transactions;

  if (filters.account_id) {
    txns = txns.filter(t => t.account_id === filters.account_id);
  }
  if (filters.category_id) {
    txns = txns.filter(t => t.category_id === filters.category_id);
  }
  if (filters.from) {
    txns = txns.filter(t => t.date >= filters.from);
  }
  if (filters.to) {
    txns = txns.filter(t => t.date <= filters.to);
  }

  return txns.sort((a, b) => new Date(b.date) - new Date(a.date));
}

function createTransaction(account_id, date, amount, payee, category_id, tags = [], note = '', source = 'manual', cleared = false) {
  if (!account_id || !date || amount === undefined) {
    throw new Error('account_id, date, amount required');
  }

  const data = readData();
  const account = data.accounts.find(a => a.id === account_id);
  if (!account) throw new Error('Account not found');

  const finalCategoryId = category_id || autoCategorize(payee, amount);

  const transaction = {
    id: newId(),
    account_id,
    date,
    amount: parseFloat(amount),
    payee: payee || '',
    category_id: finalCategoryId,
    tags: tags || [],
    note: note || '',
    source,
    cleared: cleared || false,
  };

  // Update account balance
  account.balance = Math.round((parseFloat(account.balance) + parseFloat(amount)) * 100) / 100;

  data.transactions.push(transaction);
  writeData(data);
  return transaction;
}

function updateTransaction(id, updates) {
  const data = readData();
  const idx = data.transactions.findIndex(t => t.id === id);
  if (idx === -1) throw new Error('Transaction not found');

  const oldTxn = data.transactions[idx];
  const newTxn = { ...oldTxn, ...updates, id };

  // Adjust account balance if amount changed
  if (updates.amount !== undefined && oldTxn.amount !== updates.amount) {
    const account = data.accounts.find(a => a.id === oldTxn.account_id);
    if (account) {
      const diff = parseFloat(updates.amount) - oldTxn.amount;
      account.balance = Math.round((account.balance + diff) * 100) / 100;
    }
  }

  data.transactions[idx] = newTxn;
  writeData(data);
  return newTxn;
}

function deleteTransaction(id) {
  const data = readData();
  const idx = data.transactions.findIndex(t => t.id === id);
  if (idx === -1) throw new Error('Transaction not found');

  const txn = data.transactions[idx];
  const account = data.accounts.find(a => a.id === txn.account_id);
  if (account) {
    account.balance = Math.round((account.balance - txn.amount) * 100) / 100;
  }

  data.transactions.splice(idx, 1);
  writeData(data);
}

// ────────────────────────────────────────────────────────────────────────────
// CRUD: Categories
// ────────────────────────────────────────────────────────────────────────────

function getCategories() {
  return readData().categories;
}

function createCategory(name, group, color = '#6b7280', icon = 'circle') {
  if (!name || !group) throw new Error('name and group required');

  const data = readData();
  const category = {
    id: newId(),
    name,
    group,
    color,
    icon,
  };

  data.categories.push(category);
  writeData(data);
  return category;
}

// ────────────────────────────────────────────────────────────────────────────
// CRUD: Budgets
// ────────────────────────────────────────────────────────────────────────────

function getBudgets() {
  return readData().budgets;
}

function createBudget(category_id, period, limit, rollover = false) {
  if (!category_id || !period || !limit) {
    throw new Error('category_id, period, limit required');
  }

  const data = readData();
  const budget = {
    id: newId(),
    category_id,
    period,
    limit: parseFloat(limit),
    rollover,
  };

  data.budgets.push(budget);
  writeData(data);
  return budget;
}

function updateBudget(id, updates) {
  const data = readData();
  const idx = data.budgets.findIndex(b => b.id === id);
  if (idx === -1) throw new Error('Budget not found');

  data.budgets[idx] = { ...data.budgets[idx], ...updates, id };
  writeData(data);
  return data.budgets[idx];
}

function deleteBudget(id) {
  const data = readData();
  const idx = data.budgets.findIndex(b => b.id === id);
  if (idx === -1) throw new Error('Budget not found');

  data.budgets.splice(idx, 1);
  writeData(data);
}

// ────────────────────────────────────────────────────────────────────────────
// Net worth & snapshots
// ────────────────────────────────────────────────────────────────────────────

function getNetWorthSnapshots() {
  let data = readData();
  data = ensureDailySnapshot(data);
  writeData(data);
  return data.networth_snapshots;
}

// ────────────────────────────────────────────────────────────────────────────
// Import (CSV + auto-categorize)
// ────────────────────────────────────────────────────────────────────────────

function importTransactions(account_id, rows, csvText, mapping) {
  if (!account_id) throw new Error('account_id required');

  let parsedRows = rows;
  if (!rows || rows.length === 0) {
    if (!csvText) throw new Error('rows or csvText required');
    parsedRows = parseCSV(csvText, mapping);
  }

  const imported = [];
  const sample = [];

  parsedRows.forEach((row, idx) => {
    try {
      const date = row.date || new Date().toISOString().split('T')[0];
      const amount = parseFloat(row.amount);
      const payee = row.payee || '';
      const note = row.note || '';

      if (isNaN(amount)) return;

      const txn = createTransaction(
        account_id,
        date,
        amount,
        payee,
        undefined, // auto-categorize
        [],
        note,
        'csv',
        false
      );

      imported.push(txn);
      if (idx < 5) sample.push(txn);
    } catch (e) {
      // Skip rows that fail
    }
  });

  return { imported: imported.length, sample };
}

// ────────────────────────────────────────────────────────────────────────────
// Seed & reset
// ────────────────────────────────────────────────────────────────────────────

function seedSample(sampleFile) {
  try {
    const sample = JSON.parse(fs.readFileSync(sampleFile, 'utf8'));
    // Re-anchor sample transaction dates to "now" so the most recent lands ~2 days
    // ago. Preserves relative spacing and guarantees the current-month spend/budget
    // and cash-flow views are populated (otherwise stale fixed dates look empty).
    const txs = Array.isArray(sample.transactions) ? sample.transactions : [];
    const times = txs.map(t => Date.parse(t.date)).filter(n => !Number.isNaN(n));
    if (times.length) {
      const shift = (Date.now() - 2 * 86400000) - Math.max(...times);
      for (const t of txs) {
        const d = Date.parse(t.date);
        if (!Number.isNaN(d)) t.date = new Date(d + shift).toISOString().slice(0, 10);
      }
    }
    writeData(sample);
    return true;
  } catch {
    return false;
  }
}

function reset() {
  writeData(getEmptyData());
}

module.exports = {
  readData,
  writeData,
  getEmptyData,
  getDefaultCategories,
  parseCSV,
  autoCategorize,
  computeNetWorth,
  computeBudgetStatus,
  ensureDailySnapshot,

  getAccounts,
  createAccount,
  updateAccount,
  deleteAccount,

  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,

  getCategories,
  createCategory,

  getBudgets,
  createBudget,
  updateBudget,
  deleteBudget,

  getNetWorthSnapshots,
  importTransactions,

  detectRecurring,
  projectCashflow,

  getGoals,
  createGoal,
  updateGoal,
  deleteGoal,
  computeGoalInsights,

  getRules,
  createRule,
  updateRule,
  deleteRule,
  applyRules,

  computeTaxEstimate,
  createDeduction,

  seedSample,
  reset,
  newId,
};
