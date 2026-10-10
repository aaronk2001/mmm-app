'use strict';

const YEAR_MS = 365 * 86400e3;

function trailingTwelveMonths(dividends, now = Date.now()) {
  const cutoff = now - YEAR_MS;
  const sum = (dividends || []).reduce((acc, e) => {
    if (!e || !Number.isFinite(e.time) || !Number.isFinite(e.amount)) return acc;
    return e.time * 1000 > cutoff ? acc + e.amount : acc;
  }, 0);
  return Math.round(sum * 1e4) / 1e4;
}

module.exports = { trailingTwelveMonths };
