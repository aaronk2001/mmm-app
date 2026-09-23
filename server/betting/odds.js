'use strict';

// Pure odds math for /api/betting. No I/O, no dates, no money-at-rest — these
// are all unit-free ratios and probabilities, so nothing here touches cents or
// day keys. Ported from NEXUS's bettingUtils.js, but every formula was
// re-derived rather than trusted; see arbProfitPct for the one NEXUS got wrong.
//
// MIRRORED in src/lib/odds.js (ESM, for the Betting tab's value calculator) —
// same contract as src/lib/cadence.js mirroring server/money/runway.js. Both
// copies are pinned to the same table by tests/betting-odds.test.mjs; change
// one and you must change the other.

// null/undefined/'' are "not priced", NOT zero — Number(null) is 0, which
// would silently turn a missing line into a real (and wrong) number.
function n(v) {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

// American → decimal (total return per 1 staked, stake included).
function americanToDecimal(american) {
  const a = n(american);
  if (a === null || a === 0) return null;
  return a > 0 ? a / 100 + 1 : 100 / Math.abs(a) + 1;
}

// Decimal → American. At/above evens the underdog form (+) is used, below it
// the favourite form (-), which is how every US book renders the same price.
function decimalToAmerican(decimal) {
  const d = n(decimal);
  if (d === null || d <= 1) return null;
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}

// Break-even probability baked into a price, vig included.
function impliedProb(american) {
  const d = americanToDecimal(american);
  return d === null ? null : 1 / d;
}

// Strip the bookmaker's hold by normalising the implied probabilities so they
// sum to 1 (the multiplicative method — proportional to each price, which is
// the standard default and the only one that needs no extra parameters).
function removeVig(americanOdds) {
  if (!Array.isArray(americanOdds) || americanOdds.length === 0) return null;
  const probs = americanOdds.map(impliedProb);
  if (probs.some((p) => p === null)) return null;
  const sum = probs.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return null;
  return probs.map((p) => p / sum);
}

// Expected profit per 1 unit staked, given YOUR probability estimate.
function expectedValue(prob, decimalOdds) {
  const p = n(prob);
  const d = n(decimalOdds);
  if (p === null || d === null || d <= 1) return null;
  return p * (d - 1) - (1 - p);
}

// Kelly stake as a fraction of bankroll. fraction=0.25 (quarter Kelly) by
// default because full Kelly assumes a perfectly calibrated probability.
function kelly(prob, decimalOdds, fraction = 0.25) {
  const p = n(prob);
  const d = n(decimalOdds);
  if (p === null || d === null || d <= 1) return null;
  const b = d - 1;
  const full = (b * p - (1 - p)) / b;
  return Math.max(0, full * fraction);
}

// Guaranteed return, as a percentage of the total stake, from backing both
// sides at these two prices. NEXUS returned (1 - sumImplied) * 100; that is
// the margin, not the return. Stakes are sized so every outcome pays
// total/sumImplied back, so the profit on money risked is (1/sum - 1).
function arbProfitPct(oddsA, oddsB) {
  const pA = impliedProb(oddsA);
  const pB = impliedProb(oddsB);
  if (pA === null || pB === null) return null;
  const sum = pA + pB;
  return (1 / sum - 1) * 100;
}

// Split `totalStake` across the two legs so both outcomes return the same.
function optimalStakes(totalStake, oddsA, oddsB) {
  const total = n(totalStake);
  const pA = impliedProb(oddsA);
  const pB = impliedProb(oddsB);
  if (total === null || pA === null || pB === null) return null;
  const sum = pA + pB;
  const payout = total / sum;
  return {
    stakeA: (total * pA) / sum,
    stakeB: (total * pB) / sum,
    payout,
    profit: payout - total,
  };
}

// Cross-book two-way arbitrage. `books` is [{ name, home, away }] in American
// odds; every unordered pair of DIFFERENT books is checked both ways round.
function findArbitrage(books, { totalStake = 1000, minProfitPct = 0 } = {}) {
  if (!Array.isArray(books)) return [];
  const out = [];
  for (let i = 0; i < books.length; i += 1) {
    for (let j = i + 1; j < books.length; j += 1) {
      const A = books[i];
      const B = books[j];
      const pairs = [
        { side: 'home-away', a: { book: A.name, outcome: 'home', odds: A.home }, b: { book: B.name, outcome: 'away', odds: B.away } },
        { side: 'away-home', a: { book: A.name, outcome: 'away', odds: A.away }, b: { book: B.name, outcome: 'home', odds: B.home } },
      ];
      for (const p of pairs) {
        const profitPct = arbProfitPct(p.a.odds, p.b.odds);
        if (profitPct === null || profitPct <= minProfitPct) continue;
        const stakes = optimalStakes(totalStake, p.a.odds, p.b.odds);
        out.push({
          side: p.side,
          a: { ...p.a, impliedProb: impliedProb(p.a.odds), stake: stakes.stakeA },
          b: { ...p.b, impliedProb: impliedProb(p.b.odds), stake: stakes.stakeB },
          profitPct,
          totalStake,
          payout: stakes.payout,
          profit: stakes.profit,
        });
      }
    }
  }
  return out.sort((x, y) => y.profitPct - x.profitPct);
}

// Fair two-way probabilities implied by the whole board: de-vig each book,
// then average. One outlier book therefore can't define "fair" by itself.
function consensusProbs(books) {
  if (!Array.isArray(books)) return null;
  const rows = books.map((b) => removeVig([b.home, b.away])).filter(Boolean);
  if (rows.length === 0) return null;
  const home = rows.reduce((a, r) => a + r[0], 0) / rows.length;
  return { home, away: 1 - home, books: rows.length };
}

// How much better than fair a single quoted price is.
function valueEdge(fairProb, american) {
  const p = n(fairProb);
  const d = americanToDecimal(american);
  if (p === null || d === null) return null;
  return { decimal: d, impliedProb: 1 / d, edge: p - 1 / d, ev: expectedValue(p, d) };
}

module.exports = {
  americanToDecimal,
  decimalToAmerican,
  impliedProb,
  removeVig,
  expectedValue,
  kelly,
  arbProfitPct,
  optimalStakes,
  findArbitrage,
  consensusProbs,
  valueEdge,
};
