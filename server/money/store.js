'use strict';

const fs = require('fs');
const { db } = require('../db/connection');
const repo = require('../db/repo');
const calc = require('./calc');
const parsers = require('./parsers');
const { computeRunway } = require('./runway');
const { isLiquid } = require('./account-types');

// Store v2 — thin data-access orchestration over the per-row repo API. Every
// exported name and signature matches v1 so routes.js and the tests keep
// working. Money math lives in calc.js; file parsing in parsers.js. Account
// balances are DERIVED by the repo (opening balance + transaction sum), so
// nothing here mutates balances anymore.

const newId = repo.newId;

// ── full-blob I/O (export / import / seed / reset only) ───────────────────────

function readData() {
  return repo.readAll(db());
}

// { partial: true } keeps non-ledger table groups the blob doesn't carry
// (see repo.writeAll) — used by import and restore.
function writeData(data, opts) {
  repo.writeAll(db(), data, opts);
}

// The money ledger only — what the request-path reads need. readData() also
// reads every market, backtest, cache and learn table: 342-357 ms and ~26 MB
// per call once price bars accumulate, on /overview, /advice, /goals and the
// Learn variables.
function readLedger() {
  const d = db();
  return {
    accounts: repo.getAccounts(d),
    transactions: repo.getTransactions(d),
    categories: repo.getCategories(d),
    budgets: repo.getBudgets(d),
    goals: repo.getGoals(d),
    rules: repo.getRules(d),
    holdings: repo.getHoldings(d),
    recurring: repo.getRecurring(d),
    networth_snapshots: repo.getSnapshots(d),
  };
}

function getSettings() {
  return repo.getSettings(db()) || {};
}
function saveSettings(patch) {
  return repo.setSettings(db(), patch);
}

// No accounts and no transactions: the only state in which a full replace
// (loading the sample) can't destroy anything.
function isEmpty() {
  return db().prepare('SELECT (SELECT COUNT(*) FROM accounts) + (SELECT COUNT(*) FROM transactions) AS n').get().n === 0;
}

function getEmptyData() {
  return repo.emptyData();
}

function getDefaultCategories() {
  return repo.defaultCategories();
}

// ── currency ──────────────────────────────────────────────────────────────────

function getCurrencyConfig() {
  const s = repo.getSettings(db()) || {};
  return {
    baseCurrency: s.baseCurrency || 'USD',
    fxRates: { ...calc.DEFAULT_FX_RATES, ...(s.fxRates || {}) },
    availableCurrencies: calc.AVAILABLE_CURRENCIES,
  };
}

// ── accounts ──────────────────────────────────────────────────────────────────

function getAccounts() {
  return repo.getAccounts(db());
}

function createAccount(name, type, balance, institution, currency = 'USD', status = 'active', custom = {}, { apr = null, min_payment = null } = {}) {
  if (!name || !type) throw new Error('name and type required');
  return repo.createAccount(db(), {
    name, type,
    balance: parseFloat(balance) || 0,
    institution: institution || '',
    currency, status,
    custom: custom && typeof custom === 'object' ? custom : {},
    apr, min_payment,
  });
}

function updateAccount(id, updates) {
  return repo.updateAccount(db(), id, updates);
}

function deleteAccount(id) {
  repo.deleteAccount(db(), id);
}

// ── transactions ──────────────────────────────────────────────────────────────

function getTransactions(filters = {}) {
  return repo.getTransactions(db(), filters);
}

function createTransaction(account_id, date, amount, payee, category_id, tags = [], note = '', source = 'manual', cleared = false, custom = {}) {
  if (!account_id || !date || amount === undefined) {
    throw new Error('account_id, date, amount required');
  }
  if (!repo.getAccount(db(), account_id)) throw new Error('Account not found');

  return repo.createTransaction(db(), {
    account_id,
    date,
    amount: parseFloat(amount),
    payee: payee || '',
    category_id: category_id || calc.autoCategorize(payee, amount),
    tags: tags || [],
    note: note || '',
    source,
    cleared: cleared || false,
    custom: custom && typeof custom === 'object' ? custom : {},
  });
}

function updateTransaction(id, updates) {
  return repo.updateTransaction(db(), id, updates);
}

function deleteTransaction(id) {
  repo.deleteTransaction(db(), id);
}

function updateTransactionsBulk(ids, updates) {
  if (!Array.isArray(ids) || !ids.length || !updates || typeof updates !== 'object') return 0;
  return repo.updateTransactionsBulk(db(), ids, updates);
}

function deleteTransactionsBulk(ids) {
  if (!Array.isArray(ids) || !ids.length) return 0;
  return repo.deleteTransactionsBulk(db(), ids);
}

function getPayeeStats(limit = 100) {
  return repo.getPayeeStats(db(), limit);
}

// ── categories ────────────────────────────────────────────────────────────────

function getCategories() {
  return repo.getCategories(db());
}

function createCategory(name, group, color = '#6b7280', icon = 'circle') {
  if (!name || !group) throw new Error('name and group required');
  return repo.createCategory(db(), { name, group, color, icon });
}

// ── budgets ───────────────────────────────────────────────────────────────────

function getBudgets() {
  return repo.getBudgets(db());
}

function createBudget(category_id, period, limit, rollover = false) {
  if (!category_id || !period || !limit) {
    throw new Error('category_id, period, limit required');
  }
  return repo.createBudget(db(), { category_id, period, limit: parseFloat(limit), rollover });
}

function updateBudget(id, updates) {
  return repo.updateBudget(db(), id, updates);
}

function deleteBudget(id) {
  repo.deleteBudget(db(), id);
}

// ── goals ─────────────────────────────────────────────────────────────────────

function getGoals() {
  return repo.getGoals(db());
}

function createGoal(name, target, current = 0, linked_account_id = null, target_date = null, template = null, monthly_contribution = null, custom = {}) {
  if (!name || !target) throw new Error('name and target required');
  return repo.createGoal(db(), {
    name,
    target: parseFloat(target),
    current: parseFloat(current) || 0,
    linked_account_id, target_date, template,
    monthly_contribution: monthly_contribution ? parseFloat(monthly_contribution) : null,
    custom: custom && typeof custom === 'object' ? custom : {},
  });
}

function updateGoal(id, updates) {
  return repo.updateGoal(db(), id, updates);
}

function deleteGoal(id) {
  repo.deleteGoal(db(), id);
}

// ── rules ─────────────────────────────────────────────────────────────────────

function getRules() {
  return repo.getRules(db());
}

function createRule(match, category_id, tag = null) {
  if (!match || !category_id) throw new Error('match and category_id required');
  return repo.createRule(db(), { match, category_id, tag: tag || null });
}

function updateRule(id, updates) {
  return repo.updateRule(db(), id, updates);
}

function deleteRule(id) {
  repo.deleteRule(db(), id);
}

// Re-file matching transactions. Same contract as v1: returns the ids that
// changed; writes happen in one SQL transaction.
function applyRules(transactions, rules) {
  const pairs = [];

  transactions.forEach(t => {
    let matchedCategoryId = null;

    for (const rule of rules) {
      if (t.payee.toLowerCase().includes(rule.match.toLowerCase())) {
        matchedCategoryId = rule.category_id;
        break;
      }
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
      pairs.push({ id: t.id, category_id: matchedCategoryId });
    }
  });

  if (pairs.length) repo.setTransactionCategories(db(), pairs);
  return pairs.map(p => p.id);
}

// ── holdings ──────────────────────────────────────────────────────────────────

function getHoldings(account_id = null) {
  return repo.getHoldings(db(), account_id);
}

function createHolding(account_id, symbol, shares, cost_basis, current_price) {
  if (!symbol) throw new Error('symbol required');
  return repo.createHolding(db(), { account_id: account_id || null, symbol, shares, cost_basis, current_price });
}

function updateHolding(id, updates) {
  return repo.updateHolding(db(), id, updates);
}

function deleteHolding(id) {
  repo.deleteHolding(db(), id);
}

// ── net worth & snapshots ─────────────────────────────────────────────────────

// Today's point is upserted, so it ends the day on the day's closing value
// (insert-once froze the first read — including, before the currency fix,
// yen summed as dollars — into the history for good). Past days never change.
function getNetWorthSnapshots() {
  const d = db();
  const cc = getCurrencyConfig();
  const nw = calc.computeNetWorth(repo.getAccounts(d), cc.baseCurrency, cc.fxRates);
  repo.upsertSnapshot(d, { date: calc.localDate(), ...nw });
  return repo.getSnapshots(d);
}

// ── declared recurring ────────────────────────────────────────────────────────

function getDeclaredRecurring() {
  return repo.getRecurring(db());
}

function createRecurring(payload) {
  return repo.createRecurring(db(), payload);
}

function updateRecurring(id, updates) {
  return repo.updateRecurring(db(), id, updates);
}

function deleteRecurring(id) {
  repo.deleteRecurring(db(), id);
}

// Local YYYY-MM-DD (matches the string-date convention used elsewhere).
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// One period later, pinned to the schedule's anchor day for month-based
// cadences (see calc.addMonthsClamped) — so the 31st returns to the 31st after
// a short month instead of drifting to the 28th for good.
function advanceDate(dateStr, cadence, anchorDay = null) {
  const [y, m, dd] = String(dateStr).slice(0, 10).split('-').map(Number);
  const next = calc.advanceCadence(new Date(y, m - 1, dd), cadence, anchorDay) ||
    calc.advanceCadence(new Date(y, m - 1, dd), 'monthly', anchorDay);
  return ymd(next);
}

// Catch-ups up to this many periods post on their own. Anything longer (the
// app was closed for months, or next_date was set far in the past) is
// returned as `needsConfirm` and waits for the user, instead of silently
// back-posting a pile of transactions.
const AUTOPOST_AUTO_LIMIT = 12;
// Hard ceiling per item per call even when confirmed; the rest is reported in
// `truncated` and finishes on the next call.
const AUTOPOST_CAP = 500;

// Auto-post every recurring item whose next_date has arrived into a real
// transaction on its linked account, catching up each missed period. Each
// item's posts and its next_date advance commit in ONE transaction: before,
// every post committed on its own and next_date was written after the loop,
// so a crash (or a full disk, or Windows killing the server on quit) mid-item
// re-posted the same dates on the next launch. Items without an account_id are
// skipped (forecast-only). `confirmIds` approves long catch-ups.
function postDueRecurring({ confirmIds = [] } = {}) {
  const today = ymd(new Date());
  const confirmed = new Set(confirmIds);
  const items = repo.getRecurring(db());
  let posted = 0;
  const truncated = [];
  const needsConfirm = [];

  for (const r of items) {
    if (!r.account_id || !r.next_date) continue;
    if (!repo.getAccount(db(), r.account_id)) continue; // account deleted — skip

    const anchor = r.anchor_day || Number(String(r.next_date).slice(8, 10)) || null;
    const amount = r.kind === 'income' ? Math.abs(r.amount) : -Math.abs(r.amount);
    const due = [];
    let next = String(r.next_date).slice(0, 10);
    while (next <= today && due.length <= AUTOPOST_CAP) {
      due.push(next);
      next = advanceDate(next, r.cadence, anchor);
    }
    if (!due.length) continue;

    if (due.length > AUTOPOST_AUTO_LIMIT && !confirmed.has(r.id)) {
      needsConfirm.push({ id: r.id, payee: r.payee, periods: due.length, from: due[0], to: due[due.length - 1], amount });
      continue;
    }

    const batch = due.slice(0, AUTOPOST_CAP);
    const resume = batch.length < due.length ? due[batch.length] : next;
    db().transaction(() => {
      for (const date of batch) {
        createTransaction(r.account_id, date, amount, r.payee, null, [], 'Auto-posted from recurring', 'recurring');
      }
      repo.updateRecurring(db(), r.id, { next_date: resume, anchor_day: anchor });
    })();
    posted += batch.length;
    if (resume <= today) {
      truncated.push({ id: r.id, payee: r.payee });
      console.warn(`[MMM recurring] catch-up for "${r.payee}" capped at ${AUTOPOST_CAP}; the rest posts on the next run`);
    }
  }

  const result = { posted, truncated, needsConfirm };
  // Only persist when something actually happened — a posted:0 call (e.g. the
  // Cash Flow mount effect firing with nothing due) must not overwrite a real
  // earlier record with a fresher, emptier one.
  if (posted > 0 || truncated.length > 0 || needsConfirm.length > 0) {
    repo.setMeta(db(), 'last_autopost', { at: new Date().toISOString(), ...result });
  }
  return result;
}

function getLastAutopost() {
  return repo.getMeta(db(), 'last_autopost');
}

// ── cashflow ──────────────────────────────────────────────────────────────────

function projectCashflow(accounts, recurring, days = 90) {
  // Average daily DISCRETIONARY spend over the last 60 days: outflows that
  // aren't transfers and aren't one of the recurring bills the projection
  // subtracts on their own dates. It used to average every outflow, so rent
  // was subtracted twice — $10k with $2k rent forecast -$2,067 instead of
  // $4,000 and raised a critical "balance going negative" alert.
  const cutoff = calc.localDate(-60);
  const transferIds = calc.transferCategoryIds(getCategories());
  const recurringPayees = new Set((recurring || []).map((r) => String(r.payee || '').trim().toLowerCase()));
  const cc = getCurrencyConfig();
  const byAccount = new Map(accounts.map((a) => [a.id, a.currency]));
  const recentExpenses = repo.getTransactions(db(), { from: cutoff })
    .filter(t => t.amount < 0 && !calc.isTransferTxn(t, transferIds) &&
      !recurringPayees.has(String(t.payee || '').trim().toLowerCase()))
    .reduce((sum, t) => sum + Math.abs(calc.amountInBase(t, byAccount, cc)), 0);
  return calc.projectCashflow(accounts, recurring, days, recentExpenses / 60, { cc });
}

function getRunway() {
  const data = readData();
  const recurring = calc.detectRecurring(data.transactions, getDeclaredRecurring(), { categories: data.categories });
  return computeRunway({ accounts: data.accounts, transactions: data.transactions, recurring, categories: data.categories });
}

// ── metrics (formula-engine variables) ────────────────────────────────────────

function cfSlug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field'; }
function cfValues(field) {
  if (field.type === 'checkbox') return [{ v: true, s: 'yes' }, { v: false, s: 'no' }];
  return (field.options || []).map((o) => ({ v: o, s: cfSlug(o) }));
}

function getMetrics() {
  const d = db();
  const accounts = repo.getAccounts(d);
  const transactions = repo.getTransactions(d);
  const goals = repo.getGoals(d);
  const cc = getCurrencyConfig();
  const nw = calc.computeNetWorth(accounts, cc.baseCurrency, cc.fxRates);

  const cutoff = calc.localDate(-60);
  const transferIds = calc.transferCategoryIds(repo.getCategories(d));
  const byAccount = new Map(accounts.map((a) => [a.id, a.currency]));
  const recent = transactions.filter(t => String(t.date).slice(0, 10) >= cutoff && !calc.isTransferTxn(t, transferIds));
  const monthly_income = recent.filter(t => t.amount > 0)
    .reduce((s, t) => s + calc.amountInBase(t, byAccount, cc), 0) / 2;
  const monthly_expenses = recent.filter(t => t.amount < 0)
    .reduce((s, t) => s + Math.abs(calc.amountInBase(t, byAccount, cc)), 0) / 2;
  const liquid_savings = accounts
    .filter(a => isLiquid(a.type))
    .reduce((s, a) => s + calc.balanceInBase(a, cc), 0);

  const monthly_surplus = monthly_income - monthly_expenses;
  const annual_income = monthly_income * 12;
  const annual_expenses = monthly_expenses * 12;
  const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // Custom-field aggregates: cf_<slug>_<value>_count / _sum
  const settings = repo.getSettings(d) || {};
  const cf = {};
  for (const field of Array.isArray(settings.customFields) ? settings.customFields : []) {
    const rows = field.entity === 'transaction' ? transactions
      : field.entity === 'account' ? accounts
      : field.entity === 'goal' ? goals : [];
    const amountOf = field.entity === 'transaction' ? (r) => parseFloat(r.amount) || 0
      : field.entity === 'account' ? (r) => parseFloat(r.balance) || 0
      : (r) => parseFloat(r.target) || 0;
    const fslug = field.slug || cfSlug(field.name);
    for (const { v, s } of cfValues(field)) {
      let count = 0, sum = 0;
      for (const r of rows) {
        const rv = (r.custom || {})[field.id];
        const hit = field.type === 'checkbox' ? (!!rv === v) : (String(rv ?? '') === String(v));
        if (hit) { count++; sum += amountOf(r); }
      }
      cf[`cf_${fslug}_${s}_count`] = count;
      cf[`cf_${fslug}_${s}_sum`] = round(sum);
    }
  }

  return {
    ...cf,
    net_worth: round(nw.net),
    assets: round(nw.assets),
    liabilities: round(nw.liabilities),
    debt_total: round(nw.liabilities),
    liquid_savings: round(liquid_savings),
    monthly_income: round(monthly_income),
    monthly_expenses: round(monthly_expenses),
    monthly_surplus: round(monthly_surplus),
    annual_income: round(annual_income),
    annual_expenses: round(annual_expenses),
    savings_rate: round(monthly_income > 0 ? monthly_surplus / monthly_income : 0),
    runway_months: round(monthly_expenses > 0 ? liquid_savings / monthly_expenses : 0),
    debt_to_income: round(annual_income > 0 ? nw.liabilities / annual_income : 0),
    accounts_count: accounts.length,
    transactions_count: transactions.length,
  };
}

// ── import ────────────────────────────────────────────────────────────────────

function importTransactions(account_id, rows, csvText, mapping) {
  if (!account_id) throw new Error('account_id required');
  if (!repo.getAccount(db(), account_id)) throw new Error('Account not found');

  let parsedRows = rows;
  if (!rows || rows.length === 0) {
    if (!csvText) throw new Error('rows or csvText required');
    parsedRows = parsers.parseCSV(csvText, mapping);
  }

  const toInsert = [];
  for (const row of parsedRows) {
    const amount = parseFloat(row.amount);
    if (isNaN(amount)) continue;
    const payee = row.payee || '';
    // Normalize whatever date format the file used (ISO, M/D/YY, M/D/YYYY) to
    // YYYY-MM-DD — the data layer compares date strings, so a raw '07/04/2026'
    // would silently vanish from month filters. Unparseable dates become today.
    toInsert.push({
      account_id,
      date: row.date ? parsers.normalizeQifDate(row.date) : calc.localDate(),
      amount,
      payee,
      category_id: calc.autoCategorize(payee, amount),
      tags: [],
      note: row.note || '',
      source: 'csv',
      cleared: false,
      custom: {},
    });
  }

  const imported = repo.insertTransactions(db(), toInsert);
  return { imported: imported.length, sample: imported.slice(0, 5) };
}

function importFile(account_id, format, content) {
  if (!account_id) throw new Error('account_id required');
  if (!content) throw new Error('file content required');
  const rows = format === 'ofx' ? parsers.parseOFX(content) : format === 'qif' ? parsers.parseQIF(content) : [];
  if (!rows.length) throw new Error(`No transactions found in the ${String(format).toUpperCase()} file`);
  return importTransactions(account_id, rows);
}

// ── seed & reset ──────────────────────────────────────────────────────────────

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
        // LOCAL calendar day of the shifted instant, not toISOString() (UTC) —
        // the shift anchors the newest transaction to "now minus 2 days" and
        // Date.now() carries a time-of-day component, so a UTC-keyed result
        // would land a day off from local "today" west of Greenwich.
        if (!Number.isNaN(d)) t.date = calc.ymdLocal(new Date(d + shift));
      }
    }
    // Synthesize a daily net-worth history over the last 30 days (ending at the
    // current value) so the trend chart is populated on a fresh seed.
    {
      const nw = calc.computeNetWorth(sample.accounts || []);
      const days = 30;
      const now = Date.now();
      const snaps = [];
      for (let i = days; i >= 0; i--) {
        const t = (days - i) / days;
        const d = new Date(now - i * 86400000);
        const wobble = i === 0 ? 0 : Math.sin(i * 1.3) * 0.012;
        const assets = Math.round(nw.assets * (0.94 + 0.06 * t + wobble) * 100) / 100;
        const liabilities = Math.round(nw.liabilities * (1.04 - 0.04 * t) * 100) / 100;
        // LOCAL calendar day, matching the note above — `d` is built straight
        // from Date.now() so its UTC date can already be "tomorrow" locally.
        snaps.push({ date: calc.ymdLocal(d), assets, liabilities, net: Math.round((assets - liabilities) * 100) / 100 });
      }
      sample.networth_snapshots = snaps;
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
  readLedger,
  writeData,
  isEmpty,
  getSettings,
  saveSettings,
  getEmptyData,
  getDefaultCategories,
  newId,

  // pure math + parsers, re-exported for routes/tests
  parseCSV: parsers.parseCSV,
  autoCategorize: calc.autoCategorize,
  computeNetWorth: calc.computeNetWorth,
  computeBudgetStatus: calc.computeBudgetStatus,
  detectRecurring: (transactions, declared, opts = {}) =>
    calc.detectRecurring(transactions, declared, { categories: getCategories(), ...opts }),
  computeGoalInsights: (accounts, transactions, recurring) =>
    calc.computeGoalInsights(accounts, transactions, recurring, { categories: getCategories(), cc: getCurrencyConfig() }),
  computeInvestmentMetrics: calc.computeInvestmentMetrics,

  getCurrencyConfig,

  getAccounts,
  createAccount,
  updateAccount,
  deleteAccount,

  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  updateTransactionsBulk,
  deleteTransactionsBulk,
  getPayeeStats,

  getCategories,
  createCategory,

  getBudgets,
  createBudget,
  updateBudget,
  deleteBudget,

  getNetWorthSnapshots,
  getMetrics,

  getHoldings,
  createHolding,
  updateHolding,
  deleteHolding,

  importFile,
  importTransactions,

  getDeclaredRecurring,
  createRecurring,
  updateRecurring,
  deleteRecurring,
  postDueRecurring,
  advanceDate,
  getLastAutopost,
  projectCashflow,
  getRunway,

  getGoals,
  createGoal,
  updateGoal,
  deleteGoal,

  getRules,
  createRule,
  updateRule,
  deleteRule,
  applyRules,

  seedSample,
  reset,
};
