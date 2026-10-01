'use strict';

// Enforces Research's contract: the model may only quote numbers a tool
// returned in this request. Precision-aware — "$72B" is grounded by 71.6e9
// because the writer only claimed whole billions, but "$75B" is not. A ratio
// also grounds its percentage (0.688 ↔ 68.8%). IDs, URLs and the day/month
// parts of dates are not figures anyone should quote, so they can't ground one.

const UNITS = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, trillion: 1e12 };
const FIGURE_RE = /(\$)?(-|−)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(%|percent\b|trillion\b|billion\b|million\b|thousand\b|bn\b|mn\b|[kmbt]\b)?/gi;
const SKIP_KEY = /(^|_)(id|url|accn|cik|t|time)$|filing/i;
const DATE_RE = /^(\d{4})-\d{2}-\d{2}/;

function figures(text) {
  const out = [];
  for (const m of String(text || '').replace(/\[\d+\]/g, ' ').matchAll(FIGURE_RE)) {
    const [raw, dollar, neg, int, frac = '', unitRaw] = m;
    const unit = unitRaw ? unitRaw.toLowerCase() : '';
    const scale = !unit || unit === '%' || unit === 'percent' ? 1 : UNITS[unit];
    const base = Number(`${int.replace(/,/g, '')}${frac ? `.${frac}` : ''}`);
    // Bare small integers are counts ("3 segments"), not financial figures.
    if (!unit && !dollar && !frac && base <= 10) continue;
    out.push({ raw: raw.trim(), value: (neg ? -1 : 1) * base * scale, tol: 0.5 * 10 ** -frac.length * scale });
  }
  return out;
}

function collect(v, acc) {
  if (typeof v === 'number' && Number.isFinite(v)) acc.push(v);
  else if (typeof v === 'string') {
    const d = v.match(DATE_RE);
    if (d) acc.push(Number(d[1]));
    else for (const f of figures(v)) acc.push(f.value);
  } else if (Array.isArray(v)) v.forEach((x) => collect(x, acc));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) if (!SKIP_KEY.test(k)) collect(x, acc);
  }
  return acc;
}

function checkGrounding(answer, sources, question = '') {
  const known = collect([sources, question], []);
  const ungrounded = figures(answer)
    .filter((f) => !known.some((t) => [t, t * 100].some((c) => Math.abs(Math.abs(f.value) - Math.abs(c)) <= f.tol + 1e-9)))
    .map((f) => f.raw);
  return { grounded: ungrounded.length === 0, ungrounded };
}

module.exports = { checkGrounding, figures };
