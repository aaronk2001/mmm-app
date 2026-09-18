'use strict';

/**
 * Hard rulebook gate. Every paper order passes here before it is allowed to
 * open. Ported verbatim from nexus-app/server/trading/strategy-gate.js — the
 * only change is that the five magic constants plus the sector-failure ">=2"
 * and risk:reward "2x" thresholds now come from config.js (settings.trading.gate)
 * instead of being hardcoded.
 */

const { DEFAULT_GATE_CONFIG } = require('./config');

const ACTIONS = ['BUY', 'SELL', 'HOLD', 'TIGHTEN_STOP', 'WIDEN_STOP', 'CLOSE'];
const IND_SIGNALS = ['strong_buy', 'buy', 'neutral', 'sell', 'strong_sell'];

const ALLOWED_KEYS = new Set([
  'action', 'symbol', 'conviction', 'thesis_id', 'thesis', 'catalyst', 'entry_price',
  'stop_pct', 'target_pct', 'position_pct', 'sentiment_score', 'indicator_signal',
  'sector', 'risk_factors',
]);

/**
 * Validate a TradeDecision object.
 */
function validateDecision(input) {
  const errors = [];
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['decision is not an object'] };
  }

  const o = input;

  for (const k of Object.keys(o)) {
    if (!ALLOWED_KEYS.has(k)) errors.push(`unknown property: ${k}`);
  }
  if (!ACTIONS.includes(o.action)) errors.push(`action must be one of ${ACTIONS.join('|')}`);
  if (typeof o.symbol !== 'string' || !/^[A-Z.]{1,6}$/.test(o.symbol)) {
    errors.push('symbol must match ^[A-Z.]{1,6}$');
  }
  if (
    typeof o.conviction !== 'number' ||
    !Number.isInteger(o.conviction) ||
    o.conviction < 1 ||
    o.conviction > 10
  ) {
    errors.push('conviction must be int 1-10');
  }
  if (typeof o.thesis_id !== 'string' || !o.thesis_id) errors.push('thesis_id required');
  if (typeof o.thesis !== 'string' || o.thesis.length > 300) {
    errors.push('thesis required, max 300 chars');
  }
  if (o.catalyst != null && (typeof o.catalyst !== 'string' || o.catalyst.length > 200)) {
    errors.push('catalyst max 200 chars');
  }
  if (o.entry_price != null && (typeof o.entry_price !== 'number' || o.entry_price < 0)) {
    errors.push('entry_price >= 0');
  }
  if (o.stop_pct != null && (typeof o.stop_pct !== 'number' || o.stop_pct < 0 || o.stop_pct > 15)) {
    errors.push('stop_pct 0-15');
  }
  if (o.target_pct != null && (typeof o.target_pct !== 'number' || o.target_pct < 0 || o.target_pct > 100)) {
    errors.push('target_pct 0-100');
  }
  if (o.position_pct != null && (typeof o.position_pct !== 'number' || o.position_pct < 0 || o.position_pct > 25)) {
    errors.push('position_pct 0-25');
  }
  if (o.sentiment_score != null && (typeof o.sentiment_score !== 'number' || o.sentiment_score < -1 || o.sentiment_score > 1)) {
    errors.push('sentiment_score -1..1');
  }
  if (o.indicator_signal != null && !IND_SIGNALS.includes(o.indicator_signal)) {
    errors.push('indicator_signal invalid');
  }
  if (o.sector != null && typeof o.sector !== 'string') errors.push('sector must be string');
  if (o.risk_factors != null && (!Array.isArray(o.risk_factors) || o.risk_factors.length > 5)) {
    errors.push('risk_factors array max 5');
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, data: o };
}

/**
 * Gate decision against hard rulebook.
 *
 * @param {unknown} input - The TradeDecision to validate
 * @param {Object} ctx - GateContext { account, positions, tradesThisWeek, sectorFailures, config? }
 * @param {number} lastPrice - Current market price
 * @returns {Object} GateResult { ok, violations[], qty? }
 */
function gateDecision(input, ctx, lastPrice) {
  const v = validateDecision(input);
  if (!v.ok) return { ok: false, violations: v.errors };

  const cfg = { ...DEFAULT_GATE_CONFIG, ...(ctx && ctx.config) };

  const d = v.data;
  const violations = [];

  if (d.action !== 'BUY') return { ok: true, violations: [] };

  if (d.conviction < cfg.minBuyConviction) {
    violations.push(`conviction ${d.conviction} < ${cfg.minBuyConviction}`);
  }

  const equity = parseFloat(ctx.account.equity);
  const held = new Set(ctx.positions.map(p => p.symbol.toUpperCase()));
  const openCount = ctx.positions.length;

  if (!held.has(d.symbol.toUpperCase()) && openCount >= cfg.maxPositions) {
    violations.push(`at ${openCount}/${cfg.maxPositions} positions`);
  }
  if (ctx.tradesThisWeek >= cfg.maxTradesPerWeek) {
    violations.push(`${ctx.tradesThisWeek}/${cfg.maxTradesPerWeek} trades this week`);
  }
  if (d.sector && (ctx.sectorFailures[d.sector] ?? 0) >= cfg.sectorFailureLimit) {
    violations.push(`sector "${d.sector}" blacklisted (${cfg.sectorFailureLimit} failed)`);
  }
  if (
    d.target_pct != null &&
    d.stop_pct != null &&
    d.stop_pct > 0 &&
    d.target_pct < cfg.riskRewardMultiple * d.stop_pct
  ) {
    violations.push(`R:R < ${cfg.riskRewardMultiple}:1 (target ${d.target_pct}% < ${cfg.riskRewardMultiple}×stop ${d.stop_pct}%)`);
  }
  if (lastPrice <= 0) {
    violations.push('no valid last price (possibly halted)');
  }

  const pct = Math.min(cfg.maxPositionPct, Math.max(cfg.minPositionPct, d.position_pct ?? cfg.minPositionPct));
  const notional = equity * (pct / 100);
  const qty = lastPrice > 0 ? Math.floor(notional / lastPrice) : 0;
  if (qty < 1) {
    violations.push(`qty ${qty} < 1 (notional $${notional.toFixed(0)} @ $${lastPrice})`);
  }

  return violations.length === 0
    ? { ok: true, violations: [], qty }
    : { ok: false, violations };
}

module.exports = { gateDecision, validateDecision };
