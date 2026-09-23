// Odds math — the pure helpers behind /api/betting. Every formula here is
// checked against a hand-computed value, not against the NEXUS implementation
// it was ported from (two of those were wrong: see arbProfitPct below).
//
// The module exists twice on purpose, the same way src/lib/cadence.js mirrors
// the server's perMonth: server/betting/odds.js is CommonJS (providers/routes
// require it), src/lib/odds.js is ESM (the Betting tab's value calculator
// imports it). Every test below runs against BOTH copies so they cannot drift.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as client from '../src/lib/odds.js';
import { valueRows } from '../src/components/money/sections/parts/betting/ValueBetting.jsx';

const require = createRequire(import.meta.url);
const server = require('../server/betting/odds.js');

const IMPLS = [['server', server], ['client', client]];

function both(name, fn) {
  for (const [label, m] of IMPLS) it(`${name} (${label})`, () => fn(m));
}

describe('americanToDecimal', () => {
  both('converts a positive (underdog) line', (m) => {
    expect(m.americanToDecimal(150)).toBeCloseTo(2.5, 10);   // risk 100 to win 150
    expect(m.americanToDecimal(100)).toBeCloseTo(2, 10);
  });
  both('converts a negative (favourite) line', (m) => {
    expect(m.americanToDecimal(-200)).toBeCloseTo(1.5, 10);  // risk 200 to win 100
    expect(m.americanToDecimal(-110)).toBeCloseTo(1.909090909, 8);
  });
  both('returns null for 0 / non-finite input', (m) => {
    expect(m.americanToDecimal(0)).toBeNull();
    expect(m.americanToDecimal(null)).toBeNull();
    expect(m.americanToDecimal('abc')).toBeNull();
  });
});

describe('decimalToAmerican', () => {
  both('round-trips through americanToDecimal', (m) => {
    for (const a of [150, 250, -110, -200, 1000]) {
      expect(m.decimalToAmerican(m.americanToDecimal(a))).toBe(a);
    }
  });
  both('uses +(d-1)*100 at or above evens and -100/(d-1) below', (m) => {
    expect(m.decimalToAmerican(2.5)).toBe(150);
    expect(m.decimalToAmerican(2)).toBe(100);
    expect(m.decimalToAmerican(1.5)).toBe(-200);
  });
  both('returns null for decimals at or below 1 (no payout)', (m) => {
    expect(m.decimalToAmerican(1)).toBeNull();
    expect(m.decimalToAmerican(0.8)).toBeNull();
  });
});

describe('impliedProb', () => {
  both('is exactly 1/decimal', (m) => {
    expect(m.impliedProb(150)).toBeCloseTo(0.4, 10);         // 100/(150+100)
    expect(m.impliedProb(-200)).toBeCloseTo(2 / 3, 10);      // 200/(200+100)
    expect(m.impliedProb(-110)).toBeCloseTo(0.523809524, 8);
  });
  both('returns null for an invalid line', (m) => {
    expect(m.impliedProb(0)).toBeNull();
  });
});

describe('removeVig', () => {
  both('normalises a balanced -110/-110 two-way market to 50/50', (m) => {
    const out = m.removeVig([-110, -110]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBeCloseTo(0.5, 10);
    expect(out[1]).toBeCloseTo(0.5, 10);
  });
  both('keeps the favourite the favourite and always sums to 1', (m) => {
    const out = m.removeVig([-200, 150]);                    // 0.6667 + 0.4 = 1.0667
    expect(out[0]).toBeCloseTo(0.625, 6);                    // 0.6667 / 1.0667
    expect(out[1]).toBeCloseTo(0.375, 6);
    expect(out[0] + out[1]).toBeCloseTo(1, 10);
  });
  both('handles a three-way market (soccer h2h with a draw)', (m) => {
    const out = m.removeVig([150, 220, 260]);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
  both('returns null when any leg is unpriced', (m) => {
    expect(m.removeVig([-110, null])).toBeNull();
    expect(m.removeVig([])).toBeNull();
  });
});

describe('expectedValue', () => {
  both('is zero at a fair price', (m) => {
    expect(m.expectedValue(0.5, 2)).toBeCloseTo(0, 10);
  });
  both('is profit per 1 unit staked', (m) => {
    // 55% shot at even money: win 1 unit 55% of the time, lose 1 unit 45%.
    expect(m.expectedValue(0.55, 2)).toBeCloseTo(0.1, 10);
    expect(m.expectedValue(0.4, 2.5)).toBeCloseTo(0, 10);
    expect(m.expectedValue(0.3, 2.5)).toBeCloseTo(-0.25, 10);
  });
  both('returns null for an unusable decimal price', (m) => {
    expect(m.expectedValue(0.5, 1)).toBeNull();
    expect(m.expectedValue(null, 2)).toBeNull();
  });
});

describe('kelly', () => {
  both('full Kelly on a 55% shot at even money is 10% of bankroll', (m) => {
    expect(m.kelly(0.55, 2, 1)).toBeCloseTo(0.1, 10);        // (b*p - q)/b = (0.55-0.45)/1
  });
  both('defaults to quarter Kelly', (m) => {
    expect(m.kelly(0.55, 2)).toBeCloseTo(0.025, 10);
  });
  both('never returns a negative stake for a -EV bet', (m) => {
    expect(m.kelly(0.3, 2, 1)).toBe(0);
  });
});

describe('arbProfitPct', () => {
  // NEXUS computed (1 - sumImplied) * 100, which understates the return: the
  // stakes are sized so EVERY outcome pays total/sumImplied, so the profit on
  // the money actually risked is (1/sum - 1), not (1 - sum).
  both('returns the guaranteed return on total stake', (m) => {
    // +110 / +110 → implied 0.47619 each, sum 0.95238, payout factor 1.05
    expect(m.arbProfitPct(110, 110)).toBeCloseTo(5, 6);
  });
  both('is negative when the book has a normal hold', (m) => {
    expect(m.arbProfitPct(-110, -110)).toBeCloseTo(-4.545454, 5);
  });
  both('returns null when a leg is unpriced', (m) => {
    expect(m.arbProfitPct(110, null)).toBeNull();
  });
});

describe('optimalStakes', () => {
  both('splits the stake so both legs return the same amount', (m) => {
    const s = m.optimalStakes(1000, 110, 110);
    expect(s.stakeA).toBeCloseTo(500, 6);
    expect(s.stakeB).toBeCloseTo(500, 6);
    expect(s.stakeA * m.americanToDecimal(110)).toBeCloseTo(s.payout, 6);
    expect(s.stakeB * m.americanToDecimal(110)).toBeCloseTo(s.payout, 6);
    expect(s.profit).toBeCloseTo(50, 6);                     // 5% of 1000
  });
  both('sizes an uneven pair so the payouts still match', (m) => {
    const s = m.optimalStakes(1000, -120, 140);
    expect(s.stakeA + s.stakeB).toBeCloseTo(1000, 6);
    expect(s.stakeA * m.americanToDecimal(-120)).toBeCloseTo(s.stakeB * m.americanToDecimal(140), 6);
  });
  both('returns null for an unpriced leg', (m) => {
    expect(m.optimalStakes(1000, -120, null)).toBeNull();
  });
});

describe('findArbitrage', () => {
  const books = [
    { name: 'Book A', home: -130, away: 115 },
    { name: 'Book B', home: 125, away: -140 },
    { name: 'Book C', home: -105, away: -105 },
  ];

  both('finds the cross-book pair with a positive guaranteed return', (m) => {
    const arbs = m.findArbitrage(books, { totalStake: 1000 });
    expect(arbs.length).toBeGreaterThan(0);
    const best = arbs[0];
    expect(best.profitPct).toBeGreaterThan(0);
    expect(best.a.book).not.toBe(best.b.book);
    // sorted best-first
    for (let i = 1; i < arbs.length; i += 1) expect(arbs[i - 1].profitPct).toBeGreaterThanOrEqual(arbs[i].profitPct);
  });

  both('never pairs the same book with itself', (m) => {
    const arbs = m.findArbitrage(books, { totalStake: 1000 });
    for (const a of arbs) expect(a.a.book).not.toBe(a.b.book);
  });

  both('finds nothing when every book holds a margin', (m) => {
    const held = [
      { name: 'A', home: -110, away: -110 },
      { name: 'B', home: -115, away: -105 },
    ];
    expect(m.findArbitrage(held)).toEqual([]);
  });

  both('ignores books with a missing side', (m) => {
    expect(m.findArbitrage([{ name: 'A', home: -130, away: null }, { name: 'B', home: 125, away: null }])).toEqual([]);
  });
});

describe('consensusProbs / valueEdge', () => {
  both('consensus is the mean of each book de-vigged', (m) => {
    const c = m.consensusProbs([
      { home: -110, away: -110 },
      { home: -110, away: -110 },
    ]);
    expect(c.home).toBeCloseTo(0.5, 10);
    expect(c.away).toBeCloseTo(0.5, 10);
  });
  both('consensus is null with no usable book', (m) => {
    expect(m.consensusProbs([{ home: null, away: -110 }])).toBeNull();
  });
  both('valueEdge is fair probability minus the price\'s implied probability', (m) => {
    // consensus 50%, offered +120 (implied 45.45%) → edge 4.55pts, EV +0.10/unit
    const v = m.valueEdge(0.5, 120);
    expect(v.edge).toBeCloseTo(0.0454545, 6);
    expect(v.ev).toBeCloseTo(0.1, 10);
    expect(v.impliedProb).toBeCloseTo(0.4545454, 6);
  });
  both('valueEdge is null for an unpriced leg', (m) => {
    expect(m.valueEdge(0.5, null)).toBeNull();
  });
});

// The Value table's row builder — pure, so it is pinned here rather than
// needing a DOM. It is the one place the client mirror is actually wired up.
describe('valueRows (Betting → Value tab)', () => {
  const events = [{
    id: 'e1', homeTeam: 'Suns', awayTeam: 'Lakers',
    consensus: { home: 0.5, away: 0.5 },
    bookmakers: [
      { key: 'a', name: 'Book A', markets: { h2h: { homeOdds: 120, awayOdds: -110 } } },  // home +120 → implied 45.45%, edge 4.55pts
      { key: 'b', name: 'Book B', markets: { h2h: { homeOdds: -130, awayOdds: -105 } } },
    ],
  }];

  it('keeps only prices beating the consensus by at least the threshold, best edge first', () => {
    const rows = valueRows(events, 0.02);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ team: 'Suns', book: 'Book A', odds: 120 });
    expect(rows[0].edge).toBeCloseTo(0.0454545, 6);
    expect(rows[0].ev).toBeCloseTo(0.1, 10);
  });

  it('raising the threshold drops the row', () => {
    expect(valueRows(events, 0.05)).toEqual([]);
  });

  it('skips a game with no consensus (no book quoting both sides)', () => {
    expect(valueRows([{ id: 'x', bookmakers: [{ name: 'A', markets: { h2h: { homeOdds: 120 } } }] }], 0)).toEqual([]);
  });
});
