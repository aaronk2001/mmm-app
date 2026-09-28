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

function getNetWorthSnapshots() {
  const d = db();
  const nw = calc.computeNetWorth(repo.getAccounts(d));
  repo.insertSnapshotIfMissing(d, { date: calc.localDate(), ...nw });
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

// Adds n months to Date `d`, clamping the day-of-month to the target month's
// last day instead of letting it roll into the following month (setMonth on
// Jan 31 + 1 rolls to Mar 3, not Feb 28 — the clamp fixes that).
function addMonthsClamped(d, n) {
  const day = d.getDate();
  const probe = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(probe.getFullYear(), probe.getMonth() + 1, 0).getDate();
  probe.setDate(Math.min(day, lastDay));
  return probe;
}

function advanceDate(dateStr, cadence) {
  const [y, m, dd] = String(dateStr).slice(0, 10).split('-').map(Number);
  const d = new Date(y, m - 1, dd);
  if (cadence === 'weekly') { d.setDate(d.getDate() + 7); return ymd(d); }
  if (cadence === 'biweekly') { d.setDate(d.getDate() + 14); return ymd(d); }
  if (cadence === 'quarterly') return ymd(addMonthsClamped(d, 3));
  if (cadence === 'annual') return ymd(addMonthsClamped(d, 12));
  return ymd(addMonthsClamped(d, 1)); // monthly (default)
}

// Per-item cap on catch-up posts per call. A stale item (e.g. a weekly bill
// two years old) posts up to this many rows, is reported in `truncated`, and
// finishes on the next launch instead of silently stopping short.
const AUTOPOST_CAP = 100;

// Auto-post every recurring item whose next_date has arrived into a real
// transaction on its linked account, catching up each missed period. Advancing
// next_date past today is the idempotency guard — safe to call repeatedly (on
// each app launch). Items without an account_id are skipped (forecast-only).
function postDueRecurring() {
  const today = ymd(new Date());
  const items = repo.getRecurring(db());
  let posted = 0;
  const truncated = [];

  for (const r of items) {
    if (!r.account_id || !r.next_date) continue;
    if (!repo.getAccount(db(), r.account_id)) continue; // account deleted — skip

    let next = String(r.next_date).slice(0, 10);
    const original = next;
    let count = 0;

    while (next <= today && count < AUTOPOST_CAP) {
      const amount = r.kind === 'income' ? Math.abs(r.amount) : -Math.abs(r.amount);
      createTransaction(r.account_id, next, amount, r.payee, null, [], 'Auto-posted from recurring', 'recurring');
      next = advanceDate(next, r.cadence);
      posted += 1;
      count += 1;
    }

    if (next <= today) {
      // Count what is still owed without posting it.
      let remaining = 0;
      let probe = next;
      while (probe <= today && remaining < 100000) { probe = advanceDate(probe, r.cadence); remaining += 1; }
      truncated.push({ id: r.id, payee: r.payee, remaining });
      console.warn(`[MMM recurring] truncated catch-up for "${r.payee}" — ${remaining} period(s) still due, will continue next launch`);
    }

    if (next !== original) repo.updateRecurring(db(), r.id, { next_date: next });
  }

  const result = { posted, truncated };
  // Only persist when something actually happened — a posted:0 call (e.g. the
  // Cash Flow mount effect firing with nothing due) must not overwrite a real
  // earlier record with a fresher, emptier one.
  if (posted > 0 || truncated.length > 0) {
    repo.setMeta(db(), 'last_autopost', { at: new Date().toISOString(), ...result });
  }
  return result;
}

function getLastAutopost() {
  return repo.getMeta(db(), 'last_autopost');
}

// ── cashflow ──────────────────────────────────────────────────────────────────

function projectCashflow(accounts, recurring, days = 90) {
  // Average daily discretionary spend over the last 60 days.
  const cutoff = calc.localDate(-60);
  const recentExpenses = repo.getTransactions(db(), { from: cutoff })
    .filter(t => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(parseFloat(t.amount) || 0), 0);
  return calc.projectCashflow(accounts, recurring, days, recentExpenses / 60);
}

function getRunway() {
  const data = readData();
  const recurring = calc.detectRecurring(data.transactions, getDeclaredRecurring());
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
  const recent = transactions.filter(t => String(t.date).slice(0, 10) >= cutoff);
  const monthly_income = recent.filter(t => t.amount > 0)
    .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0) / 2;
  const monthly_expenses = recent.filter(t => t.amount < 0)
    .reduce((s, t) => s + Math.abs(parseFloat(t.amount) || 0), 0) / 2;
  const liquid_savings = accounts
    .filter(a => isLiquid(a.type))
    .reduce((s, a) => s + (parseFloat(a.balance) || 0), 0);

  const monthly_surplus = monthly_income - monthly_expenses;
  const annual_income = monthly_income * 12;
  const annual_expenses = monthly_expenses * 12;
  const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // Custom-field aggregates: cf_<slug>_<value>_count / _sum
  const settings = repo.getSettings(d) || {};
  const cf = {};
  for (const field of settings.customFields || []) {
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
//
// Every import — CSV rows mapped by the client, CSV text, OFX, QIF — runs
// through importRows():
//  1. parsers.normalizeRows turns bank formats into YYYY-MM-DD dates and plain
//     decimal amounts. It decides the file's date order (MDY/DMY) and decimal
//     mark once, and rejects rows it can't read with a reason. One bad row is
//     skipped and reported; it never rejects the batch, and no row is ever
//     dated "today" because its date couldn't be read.
//  2. Each row gets an external_id: the bank's OFX FITID, else a hash of
//     account + date + amount in cents + normalized payee + an occurrence
//     index. The index keeps two genuine $5.00 coffees on the same day as two
//     rows, and is stable when the same file is imported again.
//  3. A row whose external_id the account already has is a duplicate: it is
//     skipped and counted, so re-importing an overlapping statement is safe.
//  4. Recurring claim rule. A bank row claims — instead of duplicating — a
//     transaction the app auto-posted from a recurring item when it is in the
//     same account, has source 'recurring' and no external_id yet, the SAME
//     amount in cents, and a date within ±3 days (banks post a day or two
//     either side of the due date; weekends and holidays push it further).
//     The closest date wins, then the oldest row. The claimed row takes the
//     bank's date, payee, external_id and source; its previous date, payee and
//     source are kept in custom._import_claim so undoing the import restores it.
//  5. The rest is inserted with this import's batch id, all in one SQLite
//     transaction. undoImport(batch_id) — DELETE /transactions/import/:batch_id —
//     removes those rows and releases the claims.

const crypto = require('crypto');
const { toCents: importCents } = require('./amounts');

const CLAIM_WINDOW_DAYS = 3;
const MAX_REPORTED_ERRORS = 500;

const importError = (message, status = 400) => Object.assign(new Error(message), { status });
const normPayee = (p) => String(p || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const parseCustom = (s) => {
  try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
};

function shiftYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function contentExternalId(accountId, date, cents, payee, occurrence) {
  const hash = crypto.createHash('sha256')
    .update([accountId, date, cents, normPayee(payee), occurrence].join('\u001f'))
    .digest('hex');
  return `h:${hash.slice(0, 32)}`;
}

function importRows(account_id, rawRows, { dateFormat, decimal, source }) {
  const d = db();
  const { rows, errors, detected } = parsers.normalizeRows(rawRows, { dateFormat, decimal });
  const categoryIds = new Set(repo.getCategories(d).map((c) => c.id));
  const batchId = newId();
  const occurrences = new Map();
  let duplicates = 0;
  let claimed = 0;

  const hasExternal = d.prepare('SELECT 1 FROM transactions WHERE account_id = ? AND external_id = ?');
  const findClaim = d.prepare(`
    SELECT id, date, payee, source, custom FROM transactions
    WHERE account_id = ? AND source = 'recurring' AND external_id IS NULL AND amount_cents = ?
      AND date BETWEEN ? AND ?
    ORDER BY ABS(julianday(date) - julianday(?)), rowid
    LIMIT 1`);
  const claim = d.prepare('UPDATE transactions SET date = ?, payee = ?, external_id = ?, source = ?, custom = ? WHERE id = ?');

  const inserted = d.transaction(() => {
    const toInsert = [];
    for (const r of rows) {
      let cents;
      try { cents = importCents(r.amount); } catch (e) { errors.push({ row: r.row, reason: e.message }); continue; }

      let externalId = r.external_id;
      if (!externalId) {
        const key = `${r.date}\u001f${cents}\u001f${normPayee(r.payee)}`;
        const occurrence = occurrences.get(key) || 0;
        occurrences.set(key, occurrence + 1);
        externalId = contentExternalId(account_id, r.date, cents, r.payee, occurrence);
      }
      if (hasExternal.get(account_id, externalId)) { duplicates += 1; continue; }

      const match = findClaim.get(account_id, cents,
        shiftYmd(r.date, -CLAIM_WINDOW_DAYS), shiftYmd(r.date, CLAIM_WINDOW_DAYS), r.date);
      if (match) {
        const custom = parseCustom(match.custom);
        custom._import_claim = { batch_id: batchId, date: match.date, payee: match.payee, source: match.source };
        claim.run(r.date, r.payee || match.payee, externalId, source, JSON.stringify(custom), match.id);
        claimed += 1;
        continue;
      }

      toInsert.push({
        account_id,
        date: r.date,
        amount: r.amount, // plain decimal string; repo converts it to cents
        payee: r.payee,
        category_id: r.category_id && categoryIds.has(r.category_id)
          ? r.category_id
          : calc.autoCategorize(r.payee, cents / 100),
        tags: [],
        note: r.note,
        source,
        cleared: false,
        custom: {},
        external_id: externalId,
        import_batch_id: batchId,
      });
    }
    return repo.insertTransactions(d, toInsert);
  })();

  errors.sort((a, b) => a.row - b.row);
  return {
    imported: inserted.length + claimed,
    skipped: errors.length,
    duplicates,
    errors: errors.slice(0, MAX_REPORTED_ERRORS),
    batch_id: inserted.length || claimed ? batchId : null,
    // Beyond the contract, for the UI: rows that matched an auto-posted
    // recurring transaction, what the file was read as, and a preview.
    claimed,
    detected,
    sample: inserted.slice(0, 5),
  };
}

// POST /transactions/import. `rows` carry RAW strings from the mapped columns
// ({ date, amount? | debit?/credit?, payee, category_id?, note? }); without
// rows, `csvText` is parsed server-side with `mapping`.
function importTransactions(account_id, rows, csvText, mapping, { dateFormat = 'auto', decimal = 'auto' } = {}) {
  if (!account_id) throw importError('account_id required');
  if (!repo.getAccount(db(), account_id)) throw importError('Account not found', 404);

  let rawRows = rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    if (!csvText) throw importError('rows or csvText required');
    rawRows = parsers.parseCSV(csvText, mapping);
  }
  return importRows(account_id, rawRows, { dateFormat, decimal, source: 'csv' });
}

function importFile(account_id, format, content, { dateFormat = 'auto', decimal = 'auto' } = {}) {
  if (!account_id) throw importError('account_id required');
  if (!content) throw importError('file content required');
  if (!repo.getAccount(db(), account_id)) throw importError('Account not found', 404);
  const kind = String(format || '').toLowerCase();
  if (kind !== 'ofx' && kind !== 'qif') throw importError('format must be ofx or qif');
  const rows = kind === 'ofx' ? parsers.parseOFX(content) : parsers.parseQIF(content);
  if (!rows.length) throw importError(`No transactions found in the ${kind.toUpperCase()} file`);
  return importRows(account_id, rows, { dateFormat, decimal, source: kind });
}

// Undo one import: delete the rows it inserted and give claimed auto-posted
// recurring rows back their original date, payee and source. `beforeChange`
// runs once there is something to undo (the route takes a safety snapshot).
function undoImport(batchId, { beforeChange } = {}) {
  if (!batchId) throw importError('batch_id required');
  const d = db();
  // The claim marker lives in custom JSON; LIKE narrows the scan and the exact
  // batch id is checked after parsing.
  const claims = d.prepare('SELECT id, custom FROM transactions WHERE custom LIKE ?').all(`%${batchId}%`)
    .map((row) => ({ id: row.id, custom: parseCustom(row.custom) }))
    .filter((row) => row.custom._import_claim && row.custom._import_claim.batch_id === batchId);
  const rows = d.prepare('SELECT COUNT(*) AS n FROM transactions WHERE import_batch_id = ?').get(batchId).n;
  if (!rows && !claims.length) throw importError('Import batch not found', 404);
  const safety = beforeChange ? beforeChange() : undefined;

  const release = d.prepare('UPDATE transactions SET date = ?, payee = ?, source = ?, external_id = NULL, custom = ? WHERE id = ?');
  const result = d.transaction(() => {
    const deleted = d.prepare('DELETE FROM transactions WHERE import_batch_id = ?').run(batchId).changes;
    for (const { id, custom } of claims) {
      const c = custom._import_claim;
      delete custom._import_claim;
      release.run(c.date, c.payee, c.source || 'recurring', JSON.stringify(custom), id);
    }
    return { deleted, restored: claims.length };
  })();
  return { batch_id: batchId, ...result, ...(safety !== undefined ? { safety } : {}) };
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
  detectRecurring: calc.detectRecurring,
  computeGoalInsights: calc.computeGoalInsights,
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
  undoImport,

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
