// Strategy gate — the hard rulebook every paper BUY passes through.
// Ported verbatim from NEXUS (server/trading/strategy-gate.js); these cases
// pin the five magic constants + the sector ">=2" and R:R "2x" thresholds
// that now live in config.js.
import { describe, it, expect } from 'vitest';
import gateModule from '../server/trading/strategy-gate.js';
import configModule from '../server/trading/config.js';

const { gateDecision, validateDecision } = gateModule;
const { DEFAULT_GATE_CONFIG } = configModule;

function decision(overrides = {}) {
  return {
    action: 'BUY',
    symbol: 'AAPL',
    conviction: 8,
    thesis_id: 't1',
    thesis: 'Strong earnings momentum.',
    position_pct: 10,
    ...overrides,
  };
}

function ctx(overrides = {}) {
  return {
    account: { equity: '100000' },
    positions: [],
    tradesThisWeek: 0,
    sectorFailures: {},
    ...overrides,
  };
}

describe('validateDecision', () => {
  it('accepts a well-formed decision', () => {
    expect(validateDecision(decision()).ok).toBe(true);
  });

  it('rejects a non-object', () => {
    expect(validateDecision(null).ok).toBe(false);
    expect(validateDecision('nope').ok).toBe(false);
  });

  it('rejects an unknown property', () => {
    const r = validateDecision(decision({ leverage: 5 }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/unknown property/);
  });

  it('rejects an invalid action', () => {
    const r = validateDecision(decision({ action: 'YOLO' }));
    expect(r.ok).toBe(false);
  });

  it('rejects a symbol that does not match the ticker pattern', () => {
    expect(validateDecision(decision({ symbol: 'toolong123' })).ok).toBe(false);
  });

  it('rejects a non-integer or out-of-range conviction', () => {
    expect(validateDecision(decision({ conviction: 7.5 })).ok).toBe(false);
    expect(validateDecision(decision({ conviction: 0 })).ok).toBe(false);
    expect(validateDecision(decision({ conviction: 11 })).ok).toBe(false);
  });

  it('rejects a missing thesis_id', () => {
    expect(validateDecision(decision({ thesis_id: '' })).ok).toBe(false);
  });

  it('rejects a thesis over 300 chars', () => {
    expect(validateDecision(decision({ thesis: 'x'.repeat(301) })).ok).toBe(false);
  });

  it('rejects stop_pct outside 0-15', () => {
    expect(validateDecision(decision({ stop_pct: 16 })).ok).toBe(false);
  });

  it('rejects position_pct outside 0-25', () => {
    expect(validateDecision(decision({ position_pct: 26 })).ok).toBe(false);
  });

  it('rejects an invalid indicator_signal', () => {
    expect(validateDecision(decision({ indicator_signal: 'moon' })).ok).toBe(false);
  });

  it('rejects more than 5 risk_factors', () => {
    expect(validateDecision(decision({ risk_factors: ['a', 'b', 'c', 'd', 'e', 'f'] })).ok).toBe(false);
  });
});

describe('gateDecision — non-BUY actions pass through', () => {
  it('always allows SELL/HOLD/CLOSE regardless of rulebook state', () => {
    const r = gateDecision(decision({ action: 'HOLD' }), ctx({ tradesThisWeek: 99 }), 150);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });
});

describe('gateDecision — BUY rulebook', () => {
  it('passes a clean BUY and computes qty from equity/position_pct/price', () => {
    const r = gateDecision(decision({ position_pct: 10 }), ctx(), 100);
    expect(r.ok).toBe(true);
    // 10% of 100000 = 10000 notional / $100 = 100 shares
    expect(r.qty).toBe(100);
  });

  it(`blocks conviction below the minBuyConviction (${DEFAULT_GATE_CONFIG.minBuyConviction})`, () => {
    const r = gateDecision(decision({ conviction: DEFAULT_GATE_CONFIG.minBuyConviction - 1 }), ctx(), 100);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/conviction/);
  });

  it(`allows conviction exactly at the minBuyConviction threshold`, () => {
    const r = gateDecision(decision({ conviction: DEFAULT_GATE_CONFIG.minBuyConviction }), ctx(), 100);
    expect(r.ok).toBe(true);
  });

  it(`blocks a new symbol at maxPositions (${DEFAULT_GATE_CONFIG.maxPositions})`, () => {
    const positions = Array.from({ length: DEFAULT_GATE_CONFIG.maxPositions }, (_, i) => ({ symbol: `T${i}` }));
    const r = gateDecision(decision({ symbol: 'NEWCO' }), ctx({ positions }), 100);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/positions/);
  });

  it('allows adding to an already-held symbol even at maxPositions', () => {
    const positions = Array.from({ length: DEFAULT_GATE_CONFIG.maxPositions }, (_, i) => ({ symbol: i === 0 ? 'AAPL' : `T${i}` }));
    const r = gateDecision(decision({ symbol: 'AAPL' }), ctx({ positions }), 100);
    expect(r.ok).toBe(true);
  });

  it(`blocks at maxTradesPerWeek (${DEFAULT_GATE_CONFIG.maxTradesPerWeek})`, () => {
    const r = gateDecision(decision(), ctx({ tradesThisWeek: DEFAULT_GATE_CONFIG.maxTradesPerWeek }), 100);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/trades this week/);
  });

  it(`blocks a sector with >= sectorFailureLimit (${DEFAULT_GATE_CONFIG.sectorFailureLimit}) failures`, () => {
    const r = gateDecision(decision({ sector: 'tech' }), ctx({ sectorFailures: { tech: DEFAULT_GATE_CONFIG.sectorFailureLimit } }), 100);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/blacklisted/);
  });

  it('allows a sector one failure below the limit', () => {
    const r = gateDecision(decision({ sector: 'tech' }), ctx({ sectorFailures: { tech: DEFAULT_GATE_CONFIG.sectorFailureLimit - 1 } }), 100);
    expect(r.ok).toBe(true);
  });

  it(`blocks when target_pct < riskRewardMultiple (${DEFAULT_GATE_CONFIG.riskRewardMultiple}x) * stop_pct`, () => {
    const r = gateDecision(decision({ stop_pct: 5, target_pct: 9 }), ctx(), 100);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/R:R/);
  });

  it('allows target_pct exactly at riskRewardMultiple * stop_pct', () => {
    const r = gateDecision(decision({ stop_pct: 5, target_pct: 10 }), ctx(), 100);
    expect(r.ok).toBe(true);
  });

  it('blocks a halted symbol (lastPrice <= 0)', () => {
    const r = gateDecision(decision(), ctx(), 0);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/halted/);
  });

  it('blocks when the computed qty rounds down to less than 1 share', () => {
    // 5% (minPositionPct) of $100000 = $5000 notional / $10000/share = 0 shares.
    const r = gateDecision(decision({ position_pct: 5 }), ctx(), 10000);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/qty/);
  });

  it('clamps position_pct to maxPositionPct when the decision asks for more', () => {
    // 25 is the top of validateDecision's own range but still above maxPositionPct (20).
    const r = gateDecision(decision({ position_pct: 25 }), ctx(), 100);
    expect(r.ok).toBe(true);
    // clamped to maxPositionPct (20%) of 100000 = 20000 / 100 = 200 shares
    expect(r.qty).toBe(Math.floor(100000 * (DEFAULT_GATE_CONFIG.maxPositionPct / 100) / 100));
  });

  it('clamps position_pct up to minPositionPct when the decision asks for less', () => {
    const r = gateDecision(decision({ position_pct: 1 }), ctx(), 100);
    expect(r.ok).toBe(true);
    expect(r.qty).toBe(Math.floor(100000 * (DEFAULT_GATE_CONFIG.minPositionPct / 100) / 100));
  });

  it('respects an overridden config via ctx.config', () => {
    const r = gateDecision(decision({ conviction: 5 }), ctx({ config: { minBuyConviction: 5 } }), 100);
    expect(r.ok).toBe(true);
  });

  it('reports multiple violations at once', () => {
    const r = gateDecision(decision({ conviction: 1, stop_pct: 10, target_pct: 1 }), ctx({ tradesThisWeek: 5 }), 0);
    expect(r.ok).toBe(false);
    expect(r.violations.length).toBeGreaterThanOrEqual(3);
  });

  it('bubbles up validation errors before any rulebook check', () => {
    const r = gateDecision({ action: 'BUY' }, ctx(), 100);
    expect(r.ok).toBe(false);
    expect(r.qty).toBeUndefined();
  });
});
