'use strict';

// The one money boundary. Amounts arrive as JSON numbers or numeric strings
// and leave as INTEGER cents in SQLite. Two classes of bug lived at this seam
// while it was `Math.round((parseFloat(v) || 0) * 100)`:
//
//  - parseFloat accepted garbage and magnitudes: "12abc" was stored as $12,
//    "1e308" became Infinity cents (net worth read back as null), and two rows
//    of "5e16" overflowed SQLite's int64 SUM() — after which most of the API
//    and the daily backup failed with "integer overflow". A CSV whose card
//    number column was mapped as the amount is enough to get there.
//  - Math.round(x * 100) rounds half toward +Infinity on binary floats:
//    1.005 -> 100 cents, and -10.125 -> -1012 while 10.125 -> 1013.
//
// parseMoney is the strict grammar (a plain decimal, bounded). toCents rounds
// half away from zero and refuses anything parseMoney would. Bank-export
// formats ("$1,234.56", "(12.00)", "12,50") are normalized by the importers
// before they reach this module — the API itself only speaks plain decimals.

// $100 billion: far above any personal balance, and ~900k rows of it still sum
// inside int64 cents.
const MAX_ABS_DOLLARS = 1e11;
const DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

// -> finite number of dollars, or null when `v` isn't an acceptable amount.
function parseMoney(v) {
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && DECIMAL_RE.test(v.trim())) n = Number(v.trim());
  else return null;
  if (!Number.isFinite(n) || Math.abs(n) > MAX_ABS_DOLLARS) return null;
  return n;
}

// Dollars -> integer cents. Blank means zero (optional fields); anything else
// that isn't a valid amount throws a 400-class error instead of being stored
// as a wrong number.
function toCents(v) {
  if (v == null || v === '') return 0;
  const n = parseMoney(v);
  if (n === null) {
    const err = new Error(`Invalid amount: ${String(v).slice(0, 40)}`);
    err.status = 400;
    throw err;
  }
  // The epsilon absorbs binary representation error (1.005 * 100 is
  // 100.49999999999999) so .5 cents round away from zero on both signs.
  const cents = Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-6);
  return cents || 0; // never -0
}

module.exports = { parseMoney, toCents, MAX_ABS_DOLLARS };
