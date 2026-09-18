// NEXUS import — idempotency is the whole point: running it twice must leave
// the database in the same state as running it once (import_log keyed on
// source+source_id). Uses a synthetic NEXUS store fixture, not Aaron's real
// nexus-app directory, so the test is deterministic and portable.
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import store from '../server/money/store.js';
import repo from '../server/db/repo.js';
import { db } from '../server/db/connection.js';
import { runNexusImport } from '../server/trading/import-nexus.js';

let fixtureDir;

beforeAll(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-fixture-'));

  fs.writeFileSync(path.join(fixtureDir, 'journal.json'), JSON.stringify({
    entries: [
      {
        id: '1782190324673', ticker: 'AAPL', direction: 'LONG', shares: 2,
        entry_price: 297.31, thesis: '', decision_id: null, opened_at: '2026-06-23T04:52:04.673Z',
        risk_amount: null, exit_price: 296.71, pnl: -2.19, pnl_pct: -0.37,
        closed_at: '2026-06-23T04:52:04.941Z', what_happened: '', lesson: '',
      },
      {
        id: '1782190536156', ticker: 'AAPL', direction: 'LONG', shares: 2,
        entry_price: 297.31, thesis: '', decision_id: null, opened_at: '2026-06-23T04:55:36.156Z',
        risk_amount: null, exit_price: 296.71, pnl: -2.19, pnl_pct: -0.37,
        closed_at: '2026-06-23T04:55:36.408Z', what_happened: '', lesson: '',
      },
    ],
  }));

  fs.writeFileSync(path.join(fixtureDir, 'watchlist.json'), JSON.stringify({
    tickers: ['AAPL', 'MSFT'], autoEnabled: false, cron: '0 */30 9-16 * * 1-5',
  }));

  fs.writeFileSync(path.join(fixtureDir, 'snapshot.json'), JSON.stringify({}));

  const rdb = new Database(path.join(fixtureDir, 'reflection.db'));
  rdb.exec(`
    CREATE TABLE decisions(id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT, direction TEXT, entry_price REAL,
      thesis TEXT, consensus TEXT, pm TEXT, context TEXT, created_at TEXT, status TEXT DEFAULT 'open');
    CREATE TABLE closes(decision_id INTEGER, exit_price REAL, pnl REAL, return_pct REAL, alpha_vs_spy REAL, lesson TEXT, closed_at TEXT);
  `);
  rdb.prepare(`INSERT INTO decisions (id, ticker, direction, entry_price, thesis, consensus, pm, context, created_at, status)
    VALUES (1, 'TSLA', 'LONG', 210.5, 'EV demand recovery', 'buy', 'PM notes', 'context', '2026-05-01T00:00:00.000Z', 'closed')`).run();
  rdb.prepare(`INSERT INTO closes (decision_id, exit_price, pnl, return_pct, alpha_vs_spy, lesson, closed_at)
    VALUES (1, 225.0, 145.0, 6.9, 2.1, 'Sized right, held through noise.', '2026-05-10T00:00:00.000Z')`).run();
  rdb.close();
});

afterAll(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

beforeEach(() => {
  store.reset(); // full writeAll(emptyData()) — clears paper_trades/watchlist/decisions/closes/import_log too
});

describe('runNexusImport', () => {
  it('imports paper trades, watchlist, decisions, and closes on the first run', () => {
    const result = runNexusImport({ dataDir: fixtureDir });
    expect(result.dryRun).toBe(false);
    expect(result.counts.paper_trades).toEqual({ imported: 2, skipped: 0 });
    expect(result.counts.watchlist).toEqual({ imported: 2, skipped: 0 });
    expect(result.counts.decisions).toEqual({ imported: 1, skipped: 0 });
    expect(result.counts.closes).toEqual({ imported: 1, skipped: 0 });

    const trades = repo.getPaperTrades(db());
    expect(trades).toHaveLength(2);
    expect(trades.every((t) => t.source === 'nexus')).toBe(true);

    const watchlist = repo.getWatchlist(db());
    expect(watchlist.map((w) => w.symbol).sort()).toEqual(['AAPL', 'MSFT']);

    const decisions = repo.getDecisions(db());
    expect(decisions).toHaveLength(1);
    expect(decisions[0].ticker).toBe('TSLA');

    const closes = repo.getCloses(db());
    expect(closes).toHaveLength(1);
    expect(closes[0].decision_id).toBe(decisions[0].id);
  });

  it('running twice yields identical row counts — the second run is a no-op', () => {
    runNexusImport({ dataDir: fixtureDir });

    const before = {
      trades: repo.getPaperTrades(db()).length,
      watchlist: repo.getWatchlist(db()).length,
      decisions: repo.getDecisions(db()).length,
      closes: repo.getCloses(db()).length,
    };

    const second = runNexusImport({ dataDir: fixtureDir });

    expect(second.counts.paper_trades).toEqual({ imported: 0, skipped: 2 });
    expect(second.counts.watchlist).toEqual({ imported: 0, skipped: 2 });
    expect(second.counts.decisions).toEqual({ imported: 0, skipped: 1 });
    expect(second.counts.closes).toEqual({ imported: 0, skipped: 1 });

    const after = {
      trades: repo.getPaperTrades(db()).length,
      watchlist: repo.getWatchlist(db()).length,
      decisions: repo.getDecisions(db()).length,
      closes: repo.getCloses(db()).length,
    };
    expect(after).toEqual(before);
  });

  it('sets settings.profile from snapshot.json only when currently empty', () => {
    const withProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-fixture-profile-'));
    fs.writeFileSync(path.join(withProfile, 'journal.json'), JSON.stringify({ entries: [] }));
    fs.writeFileSync(path.join(withProfile, 'watchlist.json'), JSON.stringify({ tickers: [] }));
    fs.writeFileSync(path.join(withProfile, 'snapshot.json'), JSON.stringify({ gross_salary: 90000, state: 'AZ' }));
    try {
      const result = runNexusImport({ dataDir: withProfile });
      expect(result.counts.profile.imported).toBe(1);
      expect(repo.getSettings(db()).profile).toEqual({ gross_salary: 90000, state: 'AZ' });

      // Second run: profile already set (and now import_log has 'snapshot') — no-op.
      const second = runNexusImport({ dataDir: withProfile });
      expect(second.counts.profile).toEqual({ imported: 0, skipped: 1 });
    } finally {
      fs.rmSync(withProfile, { recursive: true, force: true });
    }
  });

  it('does not write anything on --dry-run but reports the counts it would have', () => {
    const result = runNexusImport({ dataDir: fixtureDir, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.counts.paper_trades.imported).toBe(2);
    expect(repo.getPaperTrades(db())).toHaveLength(0);
    expect(repo.getWatchlist(db())).toHaveLength(0);
    expect(repo.getDecisions(db())).toHaveLength(0);

    // A real run afterward still sees everything as new.
    const real = runNexusImport({ dataDir: fixtureDir });
    expect(real.counts.paper_trades).toEqual({ imported: 2, skipped: 0 });
  });
});
