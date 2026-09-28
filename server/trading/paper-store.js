'use strict';

// Paper-trading ledger store. Real SQLite (server/db) — replaces NEXUS's
// portfolio.json/journal.jsonl. Paper-only forever: no brokerage SDK, no
// live-order path, nothing here auto-opens a position (that's the excluded
// loop.js). Every money figure that crosses this module's boundary is a
// float dollar amount (matching the rest of the repo layer); internally all
// arithmetic that must reconcile to the cent is done in integer cents.
//
// Deliberate deviations from the NEXUS source this was ported from
// (server/routes/paper_trading.js) — see track-3-report.md for the full
// writeup:
//   1. pnl on close is now computed as proceeds_cents - cost_cents (both
//      sides rebuilt from stored integer cents), instead of NEXUS's
//      `(fillPrice - entry) * shares - 1`, which only ever subtracted ONE of
//      the two $1 commissions actually charged against capital across an
//      open+close round trip. The old formula overstated realized pnl by
//      exactly one commission per closed trade. The new formula is pnl by
//      construction: capital_after - capital_before == pnl_cents, always.
//   2. Equity for gate sizing is capital + cost-basis of open positions
//      (mark-to-cost), not mark-to-market — there is no live quote feed in
//      this track (that's Track 2/market's `price_cache`, and the NEXUS
//      :5003 quote fetch is explicitly excluded). Revisit once Track 2 lands.
//   3. No `router.openPosition`/`getPortfolio` export hack, no reflection.db
//      `fetch('http://127.0.0.1:5003/...')` side call on close, no
//      journal.jsonl/markdown trade log.

const { db } = require('../db/connection');
const repo = require('../db/repo');
const { loadGateConfig } = require('./config');
const { gateDecision } = require('./strategy-gate');

const COMMISSION_CENTS = 100; // $1 flat, matches NEXUS
const SLIPPAGE_RATE = 0.001; // 0.1%, matches NEXUS
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SECTOR_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const toCents = (v) => Math.round((parseFloat(v) || 0) * 100);
const toDollars = (c) => Math.round(c) / 100;

function nowIso() {
  return new Date().toISOString();
}

// ── account / equity ─────────────────────────────────────────────────────────

function getAccount() {
  const d = db();
  const acct = repo.getPaperAccount(d);
  const positions = repo.getPaperPositions(d);
  const costBasisCents = positions.reduce((s, p) => s + Math.round(toCents(p.entry_price) * p.shares), 0);
  const capitalCents = toCents(acct.capital);
  return {
    capital: acct.capital,
    starting_capital: acct.starting_capital,
    equity: toDollars(capitalCents + costBasisCents), // mark-to-cost; see module header
    open_positions_count: positions.length,
  };
}

function listPositions() {
  return repo.getPaperPositions(db());
}

function listTrades() {
  return repo.getPaperTrades(db());
}

function getSummary() {
  const account = getAccount();
  const openPositions = listPositions();
  const closedTrades = listTrades();
  // Only trades this app actually executed move paper_account.capital, so
  // only those may feed total_pnl — otherwise imported NEXUS history shows a
  // P&L that cannot be reconciled against the capital figure beside it, and
  // the capital - starting_capital === total_pnl identity that close() works
  // to guarantee silently stops holding. Imported history is reported
  // separately.
  const appTrades = closedTrades.filter((t) => t.source !== 'nexus');
  const importedTrades = closedTrades.filter((t) => t.source === 'nexus');
  const totalPnl = appTrades.reduce((s, t) => s + t.pnl, 0);
  const importedPnl = importedTrades.reduce((s, t) => s + t.pnl, 0);
  const wins = appTrades.filter((t) => t.pnl > 0).length;
  const winRate = appTrades.length > 0 ? Math.round((wins / appTrades.length) * 100) : 0;
  return {
    capital: account.capital,
    starting_capital: account.starting_capital,
    equity: account.equity,
    total_pnl: Math.round(totalPnl * 100) / 100,
    total_return_pct: account.starting_capital
      ? Math.round((totalPnl / account.starting_capital) * 10000) / 100
      : 0,
    imported_pnl: Math.round(importedPnl * 100) / 100,
    imported_trades: importedTrades.length,
    open_positions: openPositions,
    closed_trades: closedTrades.slice(0, 20),
    win_rate: winRate,
    total_trades: closedTrades.length,
  };
}

// ── gate context (agent_events-derived) ─────────────────────────────────────

function tradesThisWeek() {
  const since = new Date(Date.now() - WEEK_MS).toISOString();
  return repo.getAgentEvents(db(), { since, event: 'buy' }).length;
}

// Ported verbatim from NEXUS's server/trading/journal.js sectorFailures():
// consecutive-loss-per-sector within a 14-day rolling window, reset on a win.
function sectorFailures() {
  const since = new Date(Date.now() - SECTOR_WINDOW_MS).toISOString();
  const events = repo
    .getAgentEvents(db(), { since })
    .filter((e) => (e.event === 'close' || e.event === 'sell') && e.sector && e.outcome)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  const consec = {};
  for (const e of events) {
    if (e.outcome === 'loss') consec[e.sector] = (consec[e.sector] ?? 0) + 1;
    else if (e.outcome === 'win') consec[e.sector] = 0;
  }
  const out = {};
  for (const [s, n] of Object.entries(consec)) if (n > 0) out[s] = n;
  return out;
}

function buildGateContext(extra = {}) {
  const account = getAccount();
  const positions = listPositions();
  const settings = repo.getSettings(db());
  return {
    account: { equity: String(toCents(account.equity) / 100) },
    positions: positions.map((p) => ({ symbol: p.ticker })),
    tradesThisWeek: tradesThisWeek(),
    sectorFailures: sectorFailures(),
    config: loadGateConfig(settings),
    ...extra,
  };
}

// ── open / close ─────────────────────────────────────────────────────────────

// decision: the strategy-gate TradeDecision shape (action must be 'BUY').
// lastPrice: current market price (dollars) used for fill simulation.
function open(decision, lastPrice) {
  const d = db();
  const run = d.transaction(() => {
    const ctx = buildGateContext();
    const gate = gateDecision(decision, ctx, lastPrice);
    if (!gate.ok) return { ok: false, violations: gate.violations };

    // The gate passes SELL/HOLD/CLOSE decisions as valid but returns no qty
    // for them — it only sizes BUYs. Without this guard qty is undefined,
    // costCents becomes NaN, the `costCents > capitalCents` check silently
    // passes (NaN > n is false), and the UPDATE binds NaN into a NOT NULL
    // column: a raw SQLite error at HTTP 500 for a plausible payload.
    if (!Number.isInteger(gate.qty) || gate.qty < 1) {
      return { ok: false, violations: ['only BUY decisions can open a paper position'] };
    }
    const qty = gate.qty;
    const entryPriceCents = Math.round(toCents(lastPrice));
    const slippageCents = Math.round(entryPriceCents * SLIPPAGE_RATE);
    const fillPriceCents = entryPriceCents + slippageCents; // LONG only (gate covers BUY only)
    const costCents = fillPriceCents * qty + COMMISSION_CENTS;

    const acct = repo.getPaperAccount(d);
    const capitalCents = toCents(acct.capital);
    if (costCents > capitalCents) {
      return { ok: false, violations: [`insufficient capital: cost $${toDollars(costCents).toFixed(2)} > capital $${toDollars(capitalCents).toFixed(2)}`] };
    }

    const stopPriceCents = decision.stop_pct != null ? Math.round(fillPriceCents * (1 - decision.stop_pct / 100)) : null;
    const target1Cents = decision.target_pct != null ? Math.round(fillPriceCents * (1 + decision.target_pct / 100)) : null;
    const riskAmountCents = stopPriceCents != null ? Math.abs(fillPriceCents - stopPriceCents) * qty : null;

    db().prepare("UPDATE paper_account SET capital_cents = capital_cents - ? WHERE id = 'default'").run(costCents);

    const position = repo.createPaperPosition(d, {
      ticker: decision.symbol,
      direction: 'LONG',
      shares: qty,
      entry_price: toDollars(fillPriceCents),
      stop_price: stopPriceCents != null ? toDollars(stopPriceCents) : null,
      target1: target1Cents != null ? toDollars(target1Cents) : null,
      target2: null,
      thesis: decision.thesis || '',
      decision_id: decision.decision_id ?? null,
      sector: decision.sector || null,
      risk_amount: riskAmountCents != null ? toDollars(riskAmountCents) : null,
      opened_at: nowIso(),
      source: 'app',
    });

    repo.appendAgentEvent(d, {
      ts: position.opened_at, event: 'buy', ticker: position.ticker, sector: position.sector,
      data: { position_id: position.id, qty, fill_price: position.entry_price, cost: toDollars(costCents) },
    });

    return { ok: true, position, capital_remaining: toDollars(capitalCents - costCents) };
  });
  return run();
}

// Returns { ok:false, status:404 } if the position is already gone (e.g. a
// second concurrent close on the same id) rather than throwing, so routes.js
// can map it to a 404 without a try/catch-driven 500.
function close(positionId, exitPrice, { what_happened = '', lesson = '' } = {}) {
  const d = db();
  const run = d.transaction(() => {
    const pos = repo.getPaperPosition(d, positionId);
    if (!pos) return { ok: false, status: 404, error: 'Position not found' };

    const short = pos.direction === 'SHORT';
    const exitPriceCents = Math.round(toCents(exitPrice));
    const slippageCents = Math.round(exitPriceCents * SLIPPAGE_RATE);
    // Closing a LONG sells (slippage lowers the fill); covering a SHORT buys
    // the shares back (slippage raises it).
    const fillPriceCents = short ? exitPriceCents + slippageCents : exitPriceCents - slippageCents;
    const entryPriceCents = Math.round(toCents(pos.entry_price));

    // Rebuild both legs from integer cents so pnl == the actual capital
    // delta by construction (see module header, deviation #1). Every figure
    // is rounded to a whole cent before it is stored: `shares` is REAL, and a
    // fractional position (restorable from a backup) used to write a
    // fractional capital_cents.
    const entryGrossCents = Math.round(entryPriceCents * pos.shares);
    const exitGrossCents = Math.round(fillPriceCents * pos.shares);
    // What the position tied up at open: its notional plus the opening
    // commission. For a LONG that is what the shares cost. A SHORT (only
    // reachable through a restore — open() is LONG-only) is treated as
    // cash-secured: the same notional set aside as collateral, which is also
    // how getAccount()'s mark-to-cost equity counts it.
    const costCents = entryGrossCents + COMMISSION_CENTS;
    // A SHORT profits when the price falls. It used to get the LONG formula:
    // a winning short (100 @ $100 covered at $90) booked -$993, a "loss"
    // that could blacklist its sector, and credited capital with the cost of
    // buying the shares back as if it were sale proceeds.
    const pnlCents = (short ? entryGrossCents - exitGrossCents : exitGrossCents - entryGrossCents) - 2 * COMMISSION_CENTS;
    // Released back to capital: what was tied up plus the realized P&L. For
    // a LONG this is exactly the sale proceeds (exit notional - commission).
    const creditCents = costCents + pnlCents;
    const pnlPct = costCents !== 0 ? Math.round((pnlCents / costCents) * 10000) / 100 : 0;

    repo.deletePaperPosition(d, positionId);

    const trade = repo.createPaperTrade(d, {
      ticker: pos.ticker,
      direction: pos.direction,
      shares: pos.shares,
      entry_price: pos.entry_price,
      exit_price: toDollars(fillPriceCents),
      pnl: toDollars(pnlCents),
      pnl_pct: pnlPct,
      thesis: pos.thesis,
      sector: pos.sector,
      decision_id: pos.decision_id,
      opened_at: pos.opened_at,
      closed_at: nowIso(),
      what_happened: String(what_happened).slice(0, 200),
      lesson: String(lesson).slice(0, 200),
      source: pos.source,
    });

    db().prepare("UPDATE paper_account SET capital_cents = capital_cents + ? WHERE id = 'default'").run(creditCents);

    repo.appendAgentEvent(d, {
      ts: trade.closed_at, event: 'close', ticker: trade.ticker, sector: trade.sector,
      outcome: pnlCents >= 0 ? 'win' : 'loss',
      data: { trade_id: trade.id, pnl: trade.pnl },
    });

    return { ok: true, trade, capital: repo.getPaperAccount(d).capital };
  });
  return run();
}

// Resets only 'app'-sourced state (open positions + closed trades) back to
// starting_capital. NEXUS-imported history (source: 'nexus') is left intact
// so an import is never silently erased by a reset.
function reset() {
  const d = db();
  const run = d.transaction(() => {
    for (const p of repo.getPaperPositions(d)) if (p.source === 'app') repo.deletePaperPosition(d, p.id);
    for (const t of repo.getPaperTrades(d)) {
      if (t.source === 'app') db().prepare('DELETE FROM paper_trades WHERE id = ?').run(t.id);
    }
    // The strategy gate's rolling memory — trades this week, per-sector loss
    // streaks — is derived from agent_events, which only this module writes
    // (open/close). Left behind, a freshly reset portfolio was still refused
    // new BUYs for up to a week ("3/3 trades this week") and kept sector
    // blacklists for up to 14 days, over trades that no longer exist.
    d.prepare('DELETE FROM agent_events').run();
    const acct = repo.getPaperAccount(d);
    db().prepare("UPDATE paper_account SET capital_cents = ? WHERE id = 'default'").run(toCents(acct.starting_capital));
    return { ok: true, account: repo.getPaperAccount(d) };
  });
  return run();
}

module.exports = {
  getAccount, listPositions, listTrades, getSummary,
  tradesThisWeek, sectorFailures, buildGateContext,
  open, close, reset,
};
