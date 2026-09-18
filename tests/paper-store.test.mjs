// Paper-trading ledger — real SQLite (temp DB from tests/setup.mjs). Focus:
// exact-cent open/close reconciliation, gate enforcement on open(), 404 (not
// 500) on a double-close race, and the 'app' vs 'nexus' reset scoping.
import { describe, it, expect, beforeEach } from 'vitest';
import store from '../server/money/store.js';
import repo from '../server/db/repo.js';
import { db } from '../server/db/connection.js';
import paperStore from '../server/trading/paper-store.js';

beforeEach(() => {
  store.reset(); // full writeAll(emptyData()) — resets paper_account to $100k too
});

function buy(overrides = {}) {
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

describe('getAccount', () => {
  it('starts at $100,000 capital and equity', () => {
    const acct = paperStore.getAccount();
    expect(acct.capital).toBe(100000);
    expect(acct.starting_capital).toBe(100000);
    expect(acct.equity).toBe(100000);
    expect(acct.open_positions_count).toBe(0);
  });
});

describe('open', () => {
  it('opens a gated BUY and debits capital by fillPrice*qty + $1 commission', () => {
    const r = paperStore.open(buy(), 100);
    expect(r.ok).toBe(true);
    // 10% of 100000 equity / $100 = 100 shares; fill = 100 * 1.001 = 100.1
    expect(r.position.shares).toBe(100);
    expect(r.position.entry_price).toBeCloseTo(100.1, 2);
    const cost = 100.1 * 100 + 1;
    expect(r.capital_remaining).toBeCloseTo(100000 - cost, 2);
    expect(paperStore.getAccount().capital).toBeCloseTo(100000 - cost, 2);
  });

  it('rejects a BUY that fails the strategy gate and charges nothing', () => {
    const r = paperStore.open(buy({ conviction: 1 }), 100);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/conviction/);
    expect(paperStore.getAccount().capital).toBe(100000);
    expect(paperStore.listPositions()).toHaveLength(0);
  });

  it('rejects when cost would exceed actual remaining capital (even though equity/sizing looks fine)', () => {
    // A large existing cost-basis keeps equity (mark-to-cost) high enough for
    // the gate to size a normal position, while actual cash is nearly gone —
    // the exact scenario the post-gate capital check exists to catch.
    repo.createPaperPosition(db(), {
      ticker: 'MSFT', direction: 'LONG', shares: 200, entry_price: 500,
      opened_at: new Date().toISOString(), source: 'app',
    });
    db().prepare("UPDATE paper_account SET capital_cents = 1000 WHERE id='default'").run(); // $10 left
    const r = paperStore.open(buy(), 100);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/insufficient capital/);
  });

  it('records a buy agent_event', () => {
    paperStore.open(buy(), 100);
    expect(paperStore.tradesThisWeek()).toBe(1);
  });
});

describe('close — exact-cent reconciliation', () => {
  it('an open/close round trip reconciles to the cent: capital delta === reported pnl', () => {
    const before = repo.getPaperAccount(db()).capital;
    const opened = paperStore.open(buy(), 100);
    expect(opened.ok).toBe(true);

    const closed = paperStore.close(opened.position.id, 110);
    expect(closed.ok).toBe(true);

    const after = repo.getPaperAccount(db()).capital;
    const actualDeltaCents = Math.round((after - before) * 100);
    const reportedPnlCents = Math.round(closed.trade.pnl * 100);
    expect(actualDeltaCents).toBe(reportedPnlCents);
  });

  it('a losing round trip also reconciles exactly', () => {
    const before = repo.getPaperAccount(db()).capital;
    const opened = paperStore.open(buy(), 100);
    const closed = paperStore.close(opened.position.id, 90);
    const after = repo.getPaperAccount(db()).capital;
    expect(Math.round((after - before) * 100)).toBe(Math.round(closed.trade.pnl * 100));
    expect(closed.trade.pnl).toBeLessThan(0);
  });

  it('moves the position from open to closed', () => {
    const opened = paperStore.open(buy(), 100);
    paperStore.close(opened.position.id, 105);
    expect(paperStore.listPositions()).toHaveLength(0);
    expect(paperStore.listTrades()).toHaveLength(1);
  });

  it('records a close agent_event with a win/loss outcome', () => {
    const opened = paperStore.open(buy({ sector: 'tech' }), 100);
    paperStore.close(opened.position.id, 200);
    const failures = paperStore.sectorFailures();
    // a win resets/never increments the sector counter
    expect(failures.tech || 0).toBe(0);
  });

  it('two closes on the same position: one succeeds, the second is a 404 (not a throw/500)', () => {
    const opened = paperStore.open(buy(), 100);
    const first = paperStore.close(opened.position.id, 105);
    const second = paperStore.close(opened.position.id, 105);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.status).toBe(404);
  });

  it('closing an unknown id returns a 404 result, not a thrown error', () => {
    expect(() => paperStore.close('nope', 100)).not.toThrow();
    const r = paperStore.close('nope', 100);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
  });
});

describe('sectorFailures', () => {
  it('blacklists a sector after 2 consecutive losses', () => {
    for (let i = 0; i < 2; i++) {
      const o = paperStore.open(buy({ symbol: 'AAPL', sector: 'tech' }), 100);
      paperStore.close(o.position.id, 50); // loss
    }
    expect(paperStore.sectorFailures().tech).toBe(2);
  });

  it('a win resets the consecutive-loss counter for that sector', () => {
    const l1 = paperStore.open(buy({ sector: 'tech' }), 100);
    paperStore.close(l1.position.id, 50); // loss
    const w = paperStore.open(buy({ sector: 'tech' }), 100);
    paperStore.close(w.position.id, 200); // win
    expect(paperStore.sectorFailures().tech || 0).toBe(0);
  });

  it('a blacklisted sector then blocks a new BUY via the gate', () => {
    for (let i = 0; i < 2; i++) {
      const o = paperStore.open(buy({ symbol: 'AAPL', sector: 'tech' }), 100);
      paperStore.close(o.position.id, 50);
    }
    const r = paperStore.open(buy({ symbol: 'MSFT', sector: 'tech' }), 100);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/blacklisted/);
  });
});

describe('reset', () => {
  it('restores capital to starting_capital and clears app-sourced open positions', () => {
    paperStore.open(buy(), 100);
    expect(paperStore.getAccount().capital).toBeLessThan(100000);
    const r = paperStore.reset();
    expect(r.ok).toBe(true);
    expect(paperStore.getAccount().capital).toBe(100000);
    expect(paperStore.listPositions()).toHaveLength(0);
  });

  it('does not touch nexus-sourced positions/trades', () => {
    repo.createPaperPosition(db(), { ticker: 'MSFT', direction: 'LONG', shares: 10, entry_price: 50, opened_at: new Date().toISOString(), source: 'nexus' });
    repo.createPaperTrade(db(), { ticker: 'GOOG', direction: 'LONG', shares: 5, entry_price: 100, exit_price: 110, pnl: 50, pnl_pct: 10, opened_at: new Date().toISOString(), closed_at: new Date().toISOString(), source: 'nexus' });
    paperStore.reset();
    expect(paperStore.listPositions()).toHaveLength(1);
    expect(paperStore.listTrades()).toHaveLength(1);
  });
});

describe('getSummary', () => {
  it('aggregates capital, open positions, closed trades, and win rate', () => {
    const win = paperStore.open(buy(), 100);
    paperStore.close(win.position.id, 150);
    const summary = paperStore.getSummary();
    expect(summary.total_trades).toBe(1);
    expect(summary.win_rate).toBe(100);
    expect(summary.closed_trades).toHaveLength(1);
    expect(summary.open_positions).toHaveLength(0);
  });
});
