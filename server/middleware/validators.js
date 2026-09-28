'use strict';

// Hand-rolled request validators — the shapes are simple enough that a schema
// library isn't worth the dependency. Each returns { valid, errors: string[] }.
// Dates must be 'YYYY-MM-DD' (the whole data layer compares date strings).

const { ACCOUNT_TYPES } = require('../money/account-types');
const { parseMoney } = require('../money/amounts');
const PERIODS = ['monthly', 'weekly', 'biweekly', 'annual'];
const CADENCES = ['monthly', 'biweekly', 'weekly', 'quarterly', 'annual'];
const KINDS = ['income', 'bill'];

// Round-trip check: Date.parse alone silently normalizes impossible dates
// (2026-02-30 parses as 2026-03-02), so require the parsed date to map back
// to the exact input string. The year is bounded too: typing a 2-digit year
// into a date input yields "0026-10-01", which as a recurring next_date
// back-posted a thousand years of rent.
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;
const isDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const year = Number(s.slice(0, 4));
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  const parsed = new Date(s);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === s;
};
// Strict: a plain decimal within ±$100B (server/money/amounts.js). parseFloat
// used to accept "12abc" and "5e16".
const isMoney = (v) => parseMoney(v) !== null;
const isBlank = (v) => v === undefined || v === null || v === '';
const isShortText = (v, max) => typeof v === 'string' && v.length <= max;

const MAX_CUSTOM_BYTES = 16 * 1024; // custom{} is metadata, not a blob store
function checkCustom(e, custom) {
  if (custom === undefined) return;
  if (typeof custom !== 'object' || custom === null || Array.isArray(custom)) {
    e.push('custom must be an object');
    return;
  }
  try {
    if (JSON.stringify(custom).length > MAX_CUSTOM_BYTES) e.push('custom field too large (max 16 KB)');
  } catch {
    e.push('custom must be JSON-serializable');
  }
}

function result(errors) {
  return { valid: errors.length === 0, errors };
}

function validateAccount(body, { partial = false } = {}) {
  const e = [];
  if (!partial || body.name !== undefined) {
    if (!body.name || !isShortText(body.name, 120) || !body.name.trim()) e.push('name is required (max 120 chars)');
  }
  if (!partial || body.type !== undefined) {
    if (!ACCOUNT_TYPES.includes(body.type)) e.push(`type must be one of: ${ACCOUNT_TYPES.join(', ')}`);
  }
  if (body.balance !== undefined && !isMoney(body.balance)) e.push('balance must be a finite number');
  if (body.currency !== undefined && !isShortText(body.currency, 3)) e.push('currency must be a 3-letter code');
  // apr is a fraction (0.2 = 20%); 5 (500%) bounds payday-loan territory and
  // catches "20" typed as a percent.
  if (!isBlank(body.apr) && (!isMoney(body.apr) || Number(body.apr) < 0 || Number(body.apr) > 5)) {
    e.push('apr must be a fraction between 0 and 5 (0.2 = 20%)');
  }
  if (!isBlank(body.min_payment) && (!isMoney(body.min_payment) || Number(body.min_payment) < 0)) {
    e.push('min_payment must be a non-negative number');
  }
  checkCustom(e, body.custom);
  return result(e);
}

function validateTransaction(body, { partial = false } = {}) {
  const e = [];
  if (!partial) {
    if (!body.account_id) e.push('account_id is required');
    if (!isDate(body.date)) e.push('date must be YYYY-MM-DD');
    if (!isMoney(body.amount)) e.push('amount must be a finite number');
  } else {
    if (body.date !== undefined && !isDate(body.date)) e.push('date must be YYYY-MM-DD');
    if (body.amount !== undefined && !isMoney(body.amount)) e.push('amount must be a finite number');
    // Setting account_id to null detached the transaction: its account's
    // balance jumped while it still counted as spending.
    if (body.account_id !== undefined && !body.account_id) e.push('account_id cannot be empty');
  }
  if (body.payee !== undefined && !isShortText(String(body.payee), 300)) e.push('payee too long (max 300 chars)');
  if (body.tags !== undefined && !Array.isArray(body.tags)) e.push('tags must be an array');
  checkCustom(e, body.custom);
  return result(e);
}

function validateBudget(body, { partial = false } = {}) {
  const e = [];
  if (!partial || body.category_id !== undefined) {
    if (!body.category_id) e.push('category_id is required');
  }
  if (!partial || body.period !== undefined) {
    if (!PERIODS.includes(body.period)) e.push(`period must be one of: ${PERIODS.join(', ')}`);
  }
  if (!partial) {
    if (!isMoney(body.limit) || parseFloat(body.limit) < 0) e.push('limit must be a non-negative number');
  } else if (body.limit !== undefined && (!isMoney(body.limit) || parseFloat(body.limit) < 0)) {
    e.push('limit must be a non-negative number');
  }
  return result(e);
}

function validateGoal(body, { partial = false } = {}) {
  const e = [];
  if (!partial || body.name !== undefined) {
    if (!body.name || !isShortText(body.name, 120)) e.push('name is required (max 120 chars)');
  }
  if (!partial) {
    if (!isMoney(body.target) || parseFloat(body.target) <= 0) e.push('target must be a positive number');
  } else if (body.target !== undefined && (!isMoney(body.target) || parseFloat(body.target) <= 0)) {
    e.push('target must be a positive number');
  }
  for (const k of ['current', 'monthly_contribution']) {
    if (body[k] !== undefined && body[k] !== null && !isMoney(body[k])) e.push(`${k} must be a number`);
  }
  if (body.target_date !== undefined && body.target_date !== null && body.target_date !== '' && !isDate(body.target_date)) e.push('target_date must be YYYY-MM-DD');
  checkCustom(e, body.custom);
  return result(e);
}

function validateRule(body, { partial = false } = {}) {
  const e = [];
  if (!partial || body.match !== undefined) {
    if (!body.match || !isShortText(body.match, 200) || !String(body.match).trim()) e.push('match is required (max 200 chars)');
  }
  if (!partial || body.category_id !== undefined) {
    if (!body.category_id) e.push('category_id is required');
  }
  return result(e);
}

function validateHolding(body, { partial = false } = {}) {
  const e = [];
  if (!partial || body.symbol !== undefined) {
    if (!body.symbol || !isShortText(String(body.symbol), 12)) e.push('symbol is required (max 12 chars)');
  }
  for (const k of ['shares', 'cost_basis', 'current_price']) {
    if (body[k] !== undefined && (!isMoney(body[k]) || parseFloat(body[k]) < 0)) e.push(`${k} must be a non-negative number`);
  }
  return result(e);
}

function validateRecurring(body, { partial = false } = {}) {
  const e = [];
  if (!partial || body.payee !== undefined) {
    if (!body.payee || !isShortText(String(body.payee), 200) || !String(body.payee).trim()) e.push('payee is required (max 200 chars)');
  }
  if (!partial) {
    if (!isMoney(body.amount)) e.push('amount must be a finite number');
  } else if (body.amount !== undefined && !isMoney(body.amount)) {
    e.push('amount must be a finite number');
  }
  if (!partial || body.cadence !== undefined) {
    if (!CADENCES.includes(body.cadence)) e.push(`cadence must be one of: ${CADENCES.join(', ')}`);
  }
  if (!partial || body.kind !== undefined) {
    if (!KINDS.includes(body.kind)) e.push(`kind must be one of: ${KINDS.join(', ')}`);
  }
  if (body.next_date !== undefined && body.next_date !== null && body.next_date !== '' && !isDate(body.next_date)) e.push('next_date must be YYYY-MM-DD');
  if (body.account_id !== undefined && body.account_id !== null && body.account_id !== '' && !isShortText(String(body.account_id), 100)) e.push('account_id must be a short string');
  return result(e);
}

function validateCategory(body) {
  const e = [];
  if (!body.name || !isShortText(body.name, 80)) e.push('name is required (max 80 chars)');
  if (!body.group || !isShortText(body.group, 40)) e.push('group is required');
  return result(e);
}

const MAX_IMPORT_CHARS = 2 * 1024 * 1024;
const MAX_IMPORT_ROWS = 20000;

const IMPORT_DATE_FORMATS = ['auto', 'MDY', 'DMY', 'YMD'];
const IMPORT_DECIMAL_MARKS = ['auto', '.', ','];
const IMPORT_FILE_FORMATS = ['ofx', 'qif'];

// Request-level checks only. Individual rows are NOT validated here: import
// normalizes each row (bank formats like "$1,234.56" or "15-Jan-2026" are
// expected) and skips-and-reports a bad one — one bad row must never reject
// the batch.
function validateImport(body) {
  const e = [];
  if (!body.account_id) e.push('account_id is required');
  if (body.rows !== undefined && (!Array.isArray(body.rows) || body.rows.length > MAX_IMPORT_ROWS)) e.push(`rows must be an array of at most ${MAX_IMPORT_ROWS}`);
  if (body.dateFormat !== undefined && !IMPORT_DATE_FORMATS.includes(body.dateFormat)) e.push(`dateFormat must be one of: ${IMPORT_DATE_FORMATS.join(', ')}`);
  if (body.decimal !== undefined && !IMPORT_DECIMAL_MARKS.includes(body.decimal)) e.push(`decimal must be one of: ${IMPORT_DECIMAL_MARKS.map((m) => `"${m}"`).join(', ')}`);
  if (body.format !== undefined && !IMPORT_FILE_FORMATS.includes(String(body.format).toLowerCase())) e.push(`format must be one of: ${IMPORT_FILE_FORMATS.join(', ')}`);
  if (body.mapping !== undefined && body.mapping !== null && (typeof body.mapping !== 'object' || Array.isArray(body.mapping))) e.push('mapping must be an object');
  const text = body.csv ?? body.content;
  if (text !== undefined && (typeof text !== 'string' || text.length > MAX_IMPORT_CHARS)) e.push('file content too large (max 2 MB)');
  return result(e);
}

// PUT /api/settings deep-merges into one shared object that many features
// read, so a wrong shape breaks routes far from the write: {"customFields": 5}
// made /metrics, /advice and /digest 500, and a non-numeric fxRates entry
// turned net worth into null. Known keys are shape-checked; unknown keys pass
// (features add their own sections).
const SETTINGS_OBJECT_KEYS = ['appearance', 'coach', 'dashboards', 'profile', 'online', 'trading', 'nav', 'shared', 'customMetric'];
const SETTINGS_BOOLEAN_KEYS = ['insightsSeeded', 'insightsGrown'];
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function validateSettings(body, { currencies = null } = {}) {
  const e = [];
  if (!isPlainObject(body)) return result(['settings must be an object']);
  if (body.baseCurrency !== undefined &&
      (typeof body.baseCurrency !== 'string' || (currencies && !currencies.includes(body.baseCurrency)))) {
    e.push(`baseCurrency must be one of: ${(currencies || []).join(', ')}`);
  }
  if (body.fxRates !== undefined) {
    if (!isPlainObject(body.fxRates)) e.push('fxRates must be an object of currency -> rate');
    else {
      for (const [code, rate] of Object.entries(body.fxRates)) {
        if (!/^[A-Z]{3}$/.test(code) || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
          e.push(`fxRates.${code} must be a positive number`);
          break;
        }
      }
    }
  }
  if (body.customFields !== undefined &&
      (!Array.isArray(body.customFields) || !body.customFields.every(isPlainObject))) {
    e.push('customFields must be an array of field definitions');
  }
  for (const k of SETTINGS_OBJECT_KEYS) {
    if (body[k] !== undefined && body[k] !== null && !isPlainObject(body[k])) e.push(`${k} must be an object`);
  }
  for (const k of SETTINGS_BOOLEAN_KEYS) {
    if (body[k] !== undefined && typeof body[k] !== 'boolean') e.push(`${k} must be true or false`);
  }
  return result(e);
}

function validateBulkIds(body) {
  const e = [];
  if (!Array.isArray(body.ids) || body.ids.length === 0) e.push('ids must be a non-empty array');
  return result(e);
}

module.exports = {
  ACCOUNT_TYPES, PERIODS, CADENCES, KINDS,
  validateAccount, validateTransaction, validateBudget, validateGoal,
  validateRule, validateHolding, validateRecurring, validateCategory, validateImport, validateBulkIds,
  validateSettings,
};
