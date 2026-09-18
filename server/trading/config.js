'use strict';

// Strategy-gate constants, lifted out of strategy-gate.js so they are
// operator-tunable via settings.trading.gate instead of hardcoded. Defaults
// match the NEXUS rulebook (server/trading/strategy-gate.js) verbatim.

const DEFAULT_GATE_CONFIG = {
  maxPositions: 6,          // MAX_POSITIONS
  maxPositionPct: 20,       // MAX_POSITION_PCT
  minPositionPct: 5,        // MIN_POSITION_PCT
  maxTradesPerWeek: 3,      // MAX_TRADES_PER_WEEK
  minBuyConviction: 7,      // MIN_BUY_CONVICTION
  sectorFailureLimit: 2,    // the ">=2" sector-blacklist threshold
  riskRewardMultiple: 2,    // the "2x" target-vs-stop threshold
};

function loadGateConfig(settings) {
  const patch = (settings && settings.trading && settings.trading.gate) || {};
  return { ...DEFAULT_GATE_CONFIG, ...patch };
}

module.exports = { DEFAULT_GATE_CONFIG, loadGateConfig };
