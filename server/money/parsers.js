'use strict';

// Import-file parsing and bank-format normalization.
//
// Files come in three shapes — CSV (papaparse, or raw rows the client already
// split into mapped columns), OFX and QIF — and every row goes through the same
// normalizeRows() before it reaches the ledger. That step is where bank
// formats become the data layer's formats: 'YYYY-MM-DD' dates and plain
// decimal amount strings, which server/money/amounts.js then turns into cents.
//
// What used to go wrong here, and the rule that replaces it:
//  - Amounts were parseFloat()ed: "2,500.00" became $2, "$4.50", "(12.34)" and
//    "-$56.78" were dropped, and an OFX "-25,90" (the OFX spec allows a decimal
//    comma) became -2590. Now currency symbols/codes are stripped, "(x)", a
//    trailing minus and a DR suffix mean negative, thousands separators are
//    checked (groups of three, or Indian 2-2-3 grouping) and the decimal mark
//    is decided once per file — or passed explicitly — so "1.234,56" and
//    "1,234.56" both mean 1234.56 and "12,50" can't silently become 1250.
//  - Dates the regexes didn't know (2026/01/15, 15-Jan-2026, 20260115,
//    Quicken's "1/ 5'26") became TODAY, and 31/01/2026 was stored as the
//    invalid 2026-31-01. Now month-first vs day-first is decided once per file
//    (a day above 12 settles it), can be passed explicitly, and a date that
//    doesn't parse or doesn't exist rejects its row with a reason. Nothing is
//    ever dated "today" because it couldn't be read.
//  - A bad row now skips itself and is reported; it never sinks the batch.

const Papa = require('papaparse');
const { parseMoney } = require('./amounts');

// Same bounds as validators.isDate: a 2-digit year typed into a date input
// yields year 0026, which must not become a transaction.
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const DATE_ORDERS = ['MDY', 'DMY', 'YMD'];
const DECIMAL_MARKS = ['.', ','];

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const pad2 = (n) => String(n).padStart(2, '0');

// ── dates ─────────────────────────────────────────────────────────────────────

function daysInMonth(y, m) {
  // Day 0 of the next month; y >= 1900 here, so the 0-99 => 19xx quirk of the
  // Date constructor can't apply.
  return new Date(y, m, 0).getDate();
}

function ymdOf(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

// 2-digit years pivot at 70 (00-69 => 20xx, 70-99 => 19xx). Quicken writes a
// year after an apostrophe only for 2000 and later ("1/ 5'26", "12/31' 5").
function expandYear(text, afterApostrophe) {
  const n = Number(text);
  if (text.length === 4) return n;
  if (text.length > 2) return NaN;
  if (afterApostrophe) return 2000 + n;
  return n >= 70 ? 1900 + n : 2000 + n;
}

function monthFromName(word) {
  const w = String(word).toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return null;
  const m = MONTHS[w.slice(0, 3)];
  // "sept", "january" ... but not "marx" or "junk": the rest must spell the month.
  if (!m) return null;
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][m - 1];
  return full.startsWith(w) || w === 'sept' ? m : null;
}

// Strip a trailing time / timezone: "2026-01-15T10:30:00Z", "01/15/2026 10:30 AM",
// OFX's "20260115120000.000[-5:EST]" is handled by the compact form below.
function stripTime(s) {
  return s
    .replace(/[T\s]+\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:[AaPp]\.?[Mm]\.?)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/, '')
    .trim();
}

// Structural parse, independent of MDY/DMY. Returns
//   { y, m, d }                       for unambiguous shapes, or
//   { a, b, c, lens, apostrophe }     for three numeric groups whose order the
//                                     file's date format decides, or null.
function dateShape(raw) {
  if (isBlank(raw)) return null;
  let s = String(raw).trim();

  // Compact YYYYMMDD, optionally followed by OFX time/zone ("20260115120000[-5:EST]").
  let m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\d{2,6}(?:\.\d+)?)?(?:\s*\[[^\]]*\])?$/);
  if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };

  s = stripTime(s);

  // Three numeric groups. Quicken pads with spaces ("1/ 5'26") and uses an
  // apostrophe before post-2000 years.
  m = s.match(/^(\d{1,4})\s*([/.\-'])\s*(\d{1,2})\s*([/.\-'])\s*(\d{1,4})$/);
  if (m) {
    const [, g1, s1, g2, s2, g3] = m;
    if (g1.length === 4) return { y: Number(g1), m: Number(g2), d: Number(g3) };
    if (g1.length > 2 || g3.length === 3) return null;
    return { a: g1, b: g2, c: g3, apostrophe: s2 === "'" || s1 === "'" };
  }

  // Month names: 15-Jan-2026, 15 Jan 26, Jan 15, 2026, January 15 2026, 2026-Jan-15.
  const tokens = s.split(/[\s,./\-']+/).filter(Boolean);
  if (tokens.length === 3) {
    const alpha = tokens.map((t) => /^[A-Za-z]+\.?$/.test(t));
    const nums = tokens.map((t) => /^\d{1,4}$/.test(t));
    if (alpha.filter(Boolean).length === 1 && nums.filter(Boolean).length === 2) {
      const mi = alpha.indexOf(true);
      const month = monthFromName(tokens[mi]);
      if (!month) return null;
      if (mi === 0) {
        const [, dd, yy] = tokens;
        return { y: expandYear(yy, false), m: month, d: Number(dd) };
      }
      if (mi === 1) {
        const [first, , last] = tokens;
        if (first.length === 4) return { y: Number(first), m: month, d: Number(last) };
        return { y: expandYear(last, false), m: month, d: Number(first) };
      }
    }
  }
  return null;
}

// -> 'YYYY-MM-DD' or null, for a shape and the file's date order.
function resolveShape(shape, order) {
  if (!shape) return null;
  if (shape.y !== undefined) return ymdOf(shape.y, shape.m, shape.d);
  const { a, b, c, apostrophe } = shape;
  if (order === 'YMD') {
    if (c.length === 4) return null; // 01/15/2026 can't be year-first
    return ymdOf(expandYear(a, false), Number(b), Number(c));
  }
  const y = expandYear(c, apostrophe);
  return order === 'DMY' ? ymdOf(y, Number(b), Number(a)) : ymdOf(y, Number(a), Number(b));
}

// One date -> { value: 'YYYY-MM-DD' } | { error }.
function normalizeDate(raw, order = 'MDY') {
  if (isBlank(raw)) return { error: 'missing date' };
  const shape = dateShape(raw);
  if (!shape) return { error: `unrecognized date "${String(raw).slice(0, 40)}"` };
  const value = resolveShape(shape, order);
  if (!value) {
    return { error: shape.a !== undefined && order === 'YMD' && shape.c.length === 4
      ? `date "${String(raw).slice(0, 40)}" is not year-first (YMD)`
      : `invalid date "${String(raw).slice(0, 40)}"` };
  }
  return { value };
}

// Month-first or day-first, decided once for the whole file: any date whose
// first group is above 12 must be day-first, any whose second group is above 12
// must be month-first. With no such date the file is genuinely ambiguous — the
// default is month-first and `guessed` says so.
function detectDateOrder(values) {
  let mdy = 0;
  let dmy = 0;
  let ambiguous = 0;
  for (const v of values) {
    const shape = dateShape(v);
    if (!shape || shape.a === undefined) continue;
    const a = Number(shape.a);
    const b = Number(shape.b);
    if (a > 12 && b <= 12) dmy += 1;
    else if (b > 12 && a <= 12) mdy += 1;
    else ambiguous += 1;
  }
  if (!mdy && !dmy) return { order: ambiguous ? 'MDY' : null, guessed: ambiguous > 0, conflict: false };
  return { order: dmy > mdy ? 'DMY' : 'MDY', guessed: false, conflict: mdy > 0 && dmy > 0 };
}

// ── amounts ───────────────────────────────────────────────────────────────────

// Sign, currency and whitespace handling. -> { neg, core } | { number } | null.
// `core` is left with only digits and the separators . , ' and space.
function amountParts(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? { number: raw } : null;
  if (isBlank(raw)) return null;
  let s = String(raw).trim()
    .replace(/[\u2212\u2012\u2013\u2014]/g, '-') // minus sign / dashes
    .replace(/[\u00a0\u2007\u202f\u2009]/g, ' '); // no-break and thin spaces
  let neg = false;

  let m = s.match(/^\((.*)\)$/);
  if (m) { neg = true; s = m[1].trim(); }

  m = s.match(/^(.*[\d)\s])\s*(CR|DR)\.?$/i);
  if (m) { if (m[2].toUpperCase() === 'DR') neg = true; s = m[1].trim(); }

  // Currency symbols anywhere, and a currency code or prefix set off by a space
  // ("USD 12.00", "12,00 EUR", "US$12" once the $ is gone, "Rs. 1,234"). Letters
  // glued to the digits ("12abc") are not a currency — that row is rejected.
  s = s.replace(/\p{Sc}/gu, ' ').trim();
  s = s.replace(/^[A-Za-z]{1,4}\.?\s+/, '').replace(/\s+[A-Za-z]{1,4}\.?$/, '').trim();

  m = s.match(/^\((.*)\)$/); // "$(12.34)" once the symbol is gone
  if (m) { neg = true; s = m[1].trim(); }
  m = s.match(/^([+-])\s*(.*)$/);
  if (m) { if (m[1] === '-') neg = true; s = m[2]; }
  m = s.match(/^(.*?)\s*([+-])$/);
  if (m) { if (m[2] === '-') neg = true; s = m[1]; }
  s = s.trim();

  if (!/^[\d.,' \u2019]+$/.test(s) || !/\d/.test(s)) return null;
  return { neg, core: s.replace(/\u2019/g, "'") };
}

// What one value says about the file's decimal mark:
// { mark, strong } or null. Both marks present -> the last one is the decimal;
// a mark repeated -> it's a thousands separator; a mark followed by anything
// but exactly three digits (or after a leading 0) -> it's the decimal. A single
// mark followed by exactly three digits ("1,234" / "1.234") is most likely a
// thousands separator, but only weakly: money rarely has three decimals.
function decimalVote(core) {
  const dots = (core.match(/\./g) || []).length;
  const commas = (core.match(/,/g) || []).length;
  if (dots && commas) return { mark: core.lastIndexOf('.') > core.lastIndexOf(',') ? '.' : ',', strong: true };
  if (!dots && !commas) return null;
  const c = dots ? '.' : ',';
  const other = c === '.' ? ',' : '.';
  if (dots + commas > 1) return { mark: other, strong: true };
  const [intPart, frac] = core.split(c);
  const digitsAfter = frac.replace(/[\s']/g, '').length;
  if (digitsAfter !== 3 || /^0?$/.test(intPart.replace(/[\s']/g, ''))) return { mark: c, strong: true };
  return { mark: other, strong: false };
}

function detectDecimalMark(values) {
  const tally = { '.': { strong: 0, weak: 0 }, ',': { strong: 0, weak: 0 } };
  for (const v of values) {
    const parts = amountParts(v);
    if (!parts || parts.number !== undefined) continue;
    const vote = decimalVote(parts.core);
    if (vote) tally[vote.mark][vote.strong ? 'strong' : 'weak'] += 1;
  }
  const strong = tally['.'].strong + tally[','].strong;
  if (strong) return { mark: tally[','].strong > tally['.'].strong ? ',' : '.', guessed: false, conflict: tally['.'].strong > 0 && tally[','].strong > 0 };
  if (tally['.'].weak || tally[','].weak) return { mark: tally[','].weak > tally['.'].weak ? ',' : '.', guessed: true, conflict: false };
  return { mark: '.', guessed: false, conflict: false };
}

// Thousands grouping must be well formed: 1,234,567 or Indian 12,34,567.
function validGrouping(intPart) {
  const seps = intPart.match(/[^\d]/g);
  if (!seps) return true;
  if (new Set(seps).size > 1) return false; // one separator style per number
  const groups = intPart.split(seps[0]);
  if (groups.some((g) => !/^\d+$/.test(g))) return false;
  const [first, ...rest] = groups;
  const western = /^\d{1,3}$/.test(first) && rest.every((g) => g.length === 3);
  const indian = rest.length >= 2 && /^\d{1,2}$/.test(first) &&
    rest.slice(0, -1).every((g) => g.length === 2) && rest[rest.length - 1].length === 3;
  return western || indian;
}

// One amount -> { value: plain decimal string } | { blank: true } | { error }.
function normalizeAmount(raw, mark = '.') {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || parseMoney(raw) === null) return { error: `amount out of range "${String(raw).slice(0, 40)}"` };
    const plain = String(raw);
    return { value: /e/i.test(plain) ? raw.toFixed(6) : plain };
  }
  if (isBlank(raw)) return { blank: true };
  const parts = amountParts(raw);
  const shown = String(raw).trim().slice(0, 40);
  if (!parts) return { error: `unrecognized amount "${shown}"` };
  const { neg, core } = parts;
  const decimals = core.split(mark);
  if (decimals.length > 2) return { error: `unrecognized amount "${shown}"` };
  const [intRaw, frac = ''] = decimals;
  if (!/^\d*$/.test(frac)) return { error: `unrecognized amount "${shown}" (decimal mark "${mark}")` };
  const intPart = intRaw.trim();
  if (!validGrouping(intPart)) return { error: `unrecognized amount "${shown}" (decimal mark "${mark}")` };
  const digits = intPart.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '') || '0';
  const value = `${neg ? '-' : ''}${digits}${frac ? `.${frac}` : ''}`;
  if (parseMoney(value) === null) return { error: `amount out of range "${shown}"` };
  return { value: value === '-0' ? '0' : value };
}

const absDecimal = (v) => String(v).replace(/^-/, '');
const isZeroDecimal = (v) => /^-?0*(\.0*)?$/.test(String(v));

// A row's amount from `amount`, or from separate debit/credit columns (money
// out / money in, whatever sign the bank printed them with).
function rowAmount(row, mark) {
  if (!isBlank(row.amount)) return normalizeAmount(row.amount, mark);
  const hasDebit = !isBlank(row.debit);
  const hasCredit = !isBlank(row.credit);
  if (!hasDebit && !hasCredit) return { error: 'missing amount' };
  const debit = hasDebit ? normalizeAmount(row.debit, mark) : { value: '0' };
  if (debit.error) return { error: `debit: ${debit.error}` };
  const credit = hasCredit ? normalizeAmount(row.credit, mark) : { value: '0' };
  if (credit.error) return { error: `credit: ${credit.error}` };
  const d = isZeroDecimal(debit.value) ? null : absDecimal(debit.value);
  const c = isZeroDecimal(credit.value) ? null : absDecimal(credit.value);
  if (d && c) return { error: 'row has both a debit and a credit' };
  if (d) return { value: `-${d}` };
  return { value: c || '0' };
}

// ── rows ──────────────────────────────────────────────────────────────────────

const text = (v, max) => (isBlank(v) ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max));

// A leading row that has neither a readable date nor a readable amount is a
// header or bank preamble ("Account: ...1234"), not a transaction.
function looksLikeHeader(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.unsupported || row.external_id) return false;
  if (dateShape(row.date)) return false;
  return ['amount', 'debit', 'credit'].every((k) => !amountParts(row[k]));
}

const isBlankRow = (row) => row && typeof row === 'object' && !row.unsupported &&
  ['date', 'amount', 'debit', 'credit', 'payee', 'note'].every((k) => isBlank(row[k]));

/**
 * Normalize raw import rows (strings straight from the file's mapped columns).
 * @param {Array<object>} rawRows  [{ date, amount?, debit?, credit?, payee, note?, category_id?,
 *   external_id?, row? (number to report; defaults to the 1-based index) }]
 * @param {{ dateFormat?: 'auto'|'MDY'|'DMY'|'YMD', decimal?: 'auto'|'.'|',' }} [opts]
 * @returns {{ rows: Array<{ row, date, amount, payee, note, category_id, external_id }>,
 *   errors: Array<{ row, reason }>, headers: number,
 *   detected: { dateFormat, dateFormatGuessed, decimal, decimalGuessed } }}
 */
function normalizeRows(rawRows, { dateFormat = 'auto', decimal = 'auto' } = {}) {
  const list = Array.isArray(rawRows) ? rawRows : [];
  const numbered = list.map((r, i) => ({ r, n: (r && Number.isInteger(r.row)) ? r.row : i + 1 }));

  // Blank rows are dropped anywhere; header/preamble rows only before the first data row.
  const body = [];
  let headers = 0;
  let seenData = false;
  for (const item of numbered) {
    if (isBlankRow(item.r)) continue;
    if (!seenData && looksLikeHeader(item.r)) { headers += 1; continue; }
    seenData = true;
    body.push(item);
  }

  const objects = body.filter(({ r }) => r && typeof r === 'object' && !Array.isArray(r));
  const order = DATE_ORDERS.includes(dateFormat)
    ? { order: dateFormat, guessed: false }
    : detectDateOrder(objects.map(({ r }) => r.date));
  const mark = DECIMAL_MARKS.includes(decimal)
    ? { mark: decimal, guessed: false }
    : detectDecimalMark(objects.flatMap(({ r }) => [r.amount, r.debit, r.credit]));

  const rows = [];
  const errors = [];
  for (const { r, n } of body) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) { errors.push({ row: n, reason: 'row is not an object' }); continue; }
    if (r.unsupported) { errors.push({ row: n, reason: r.unsupported }); continue; }
    const date = normalizeDate(r.date, order.order || 'MDY');
    if (date.error) { errors.push({ row: n, reason: date.error }); continue; }
    const amount = rowAmount(r, mark.mark);
    if (amount.error) { errors.push({ row: n, reason: amount.error }); continue; }
    rows.push({
      row: n,
      date: date.value,
      amount: amount.value,
      payee: text(r.payee, 300),
      note: text(r.note, 1000),
      category_id: isBlank(r.category_id) ? null : String(r.category_id),
      external_id: isBlank(r.external_id) ? null : String(r.external_id),
    });
  }

  return {
    rows,
    errors,
    headers,
    detected: {
      dateFormat: order.order || null,
      dateFormatGuessed: !!order.guessed,
      decimal: mark.mark,
      decimalGuessed: !!mark.guessed,
    },
  };
}

// ── file formats ──────────────────────────────────────────────────────────────

// Bank CSVs often put account details above the real header. With a mapping,
// start at the first line that carries the mapped date column's header.
function dropPreamble(csvText, mapping) {
  if (!mapping || isBlank(mapping.date)) return csvText;
  const lines = csvText.split(/\r?\n/);
  const want = String(mapping.date).trim().toLowerCase();
  const idx = lines.findIndex((line) => Papa.parse(line).data[0]?.some((cell) => String(cell).trim().toLowerCase() === want));
  return idx > 0 ? lines.slice(idx).join('\n') : csvText;
}

// CSV -> raw rows (strings). The header row names the columns; `mapping` says
// which header is the date / amount / debit / credit / payee / note / category.
function parseCSV(csvText, mapping) {
  const source = dropPreamble(String(csvText).trim(), mapping);
  const result = Papa.parse(source, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => String(h).trim(),
    transform: (v) => String(v).trim(),
  });
  const rows = result.data || [];
  const pick = (row, key, ...fallbacks) => {
    const names = [mapping && mapping[key], ...fallbacks].filter((n) => !isBlank(n));
    for (const name of names) if (row[name] !== undefined && row[name] !== '') return row[name];
    return undefined;
  };
  return rows.map((row) => {
    const out = {
      date: pick(row, 'date', 'date', 'Date') || '',
      amount: pick(row, 'amount', 'amount', 'Amount') || '',
      payee: pick(row, 'payee', 'payee', 'Payee') || '',
      note: pick(row, 'note', 'note', 'Note') || '',
    };
    const debit = pick(row, 'debit', 'debit', 'Debit');
    const credit = pick(row, 'credit', 'credit', 'Credit');
    const category = mapping && !isBlank(mapping.category_id) ? row[mapping.category_id] : undefined;
    if (debit !== undefined) out.debit = debit;
    if (credit !== undefined) out.credit = credit;
    if (!isBlank(category)) out.category_id = category;
    return out;
  });
}

// Kept for callers of the old helper: a QIF/bank date in month-first order, or
// null when it can't be read (it used to fall back to today's date).
function normalizeQifDate(s) {
  return normalizeDate(s, 'MDY').value || null;
}

// QIF sections that hold cash-account transactions. Account lists, category
// and class lists and memorized transactions are skipped silently; investment
// sections are reported (their T amounts are trade values, not cash moves).
const QIF_TXN_TYPES = new Set(['bank', 'cash', 'ccard', 'oth a', 'oth l']);

// QIF -> raw rows (strings; normalizeRows reads them).
function parseQIF(content) {
  const rows = [];
  let section = 'bank'; // files without a !Type header are plain bank registers
  let n = 0;
  let cur = {};
  const flush = () => {
    const hasData = cur.date !== undefined || cur.amount !== undefined || cur.payee !== undefined;
    if (hasData && section === 'invst') {
      n += 1;
      rows.push({ row: n, unsupported: 'investment (!Type:Invst) records are not imported' });
    } else if (hasData && QIF_TXN_TYPES.has(section)) {
      n += 1;
      rows.push({ row: n, ...cur });
    }
    cur = {};
  };
  for (const raw of String(content).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('!')) {
      flush();
      const type = line.match(/^!Type:(.*)$/i);
      if (type) section = type[1].trim().toLowerCase();
      else if (/^!Account/i.test(line)) section = 'account';
      else if (/^!Option|^!Clear/i.test(line)) { /* switches, not sections */ } else section = 'other';
      continue;
    }
    const code = line[0];
    const val = line.slice(1).trim();
    if (code === '^') flush();
    else if (section !== 'invst' && !QIF_TXN_TYPES.has(section)) continue; // account/category/class lists, memorized txns
    else if (code === 'D') cur.date = val;
    else if (code === 'T') cur.amount = val;
    else if (code === 'U' && cur.amount === undefined) cur.amount = val;
    else if (code === 'P') cur.payee = val;
    else if (code === 'M') cur.note = val;
  }
  flush();
  return rows;
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeEntities = (s) => s
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => XML_ENTITIES[e])
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

// OFX (SGML without closing tags, or XML) -> raw rows. TRNAMT: the OFX spec
// allows a period or a comma as the decimal mark and no thousands separators,
// so a comma here is always the decimal ("-25,90" is -25.90). FITID is the
// bank's id for the transaction — it becomes the row's external_id, with a
// suffix when a bank repeats one inside the same file.
function parseOFX(content) {
  const rows = [];
  const seenFitid = new Map();
  const blocks = String(content).split(/<STMTTRN>/i).slice(1);
  let n = 0;
  for (const b of blocks) {
    const block = b.split(/<\/STMTTRN>/i)[0];
    const tag = (name) => {
      const m = block.match(new RegExp('<' + name + '>([^<\\r\\n]*)', 'i'));
      return m ? decodeEntities(m[1].trim()) : '';
    };
    const amtRaw = tag('TRNAMT');
    const dt = tag('DTPOSTED');
    if (!amtRaw && !dt) continue; // not a transaction block
    n += 1;
    const amount = /^[+-]?\d*(?:[.,]\d*)?$/.test(amtRaw) && /\d/.test(amtRaw) ? amtRaw.replace(',', '.') : amtRaw;
    const fitid = tag('FITID');
    let externalId = null;
    if (fitid) {
      const seen = (seenFitid.get(fitid) || 0) + 1;
      seenFitid.set(fitid, seen);
      externalId = `fitid:${fitid}${seen > 1 ? `#${seen}` : ''}`;
    }
    rows.push({
      row: n,
      date: dt,
      amount,
      payee: tag('NAME') || tag('PAYEE'),
      note: tag('MEMO'),
      external_id: externalId,
    });
  }
  return rows;
}

module.exports = {
  parseCSV, parseQIF, parseOFX, normalizeRows,
  normalizeDate, normalizeAmount, detectDateOrder, detectDecimalMark,
  normalizeQifDate,
};
