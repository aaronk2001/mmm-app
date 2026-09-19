// Backup integrity regression (Sprint E, Track 2): seeds one row into EVERY
// table in the schema, runs the real backup scheduler, wipes the DB, restores
// from the produced backup, and diffs readAll() before vs after per table.
// A table silently missing from this list is a real data-loss bug — see
// server/db/repo.js BLOB_KEYS / readAll / writeAll.
import { describe, it, expect, beforeEach } from 'vitest';
import repo from '../server/db/repo.js';
import { db } from '../server/db/connection.js';
import store from '../server/money/store.js';
import { runBackup, restoreBackup } from '../server/backup/scheduler.js';

beforeEach(() => {
  store.reset();
});

// Every BLOB_KEYS table from server/db/repo.js — keep this list in sync with
// that array; a table added there without a row here defeats the point of
// this test.
const TABLES = [
  'accounts', 'transactions', 'categories', 'budgets', 'goals', 'rules', 'holdings',
  'networth_snapshots', 'recurring', 'http_cache',
  'paper_account', 'paper_positions', 'paper_trades', 'paper_journal', 'agent_events',
  'decisions', 'closes', 'watchlist', 'import_log',
  'price_cache', 'alert_rules', 'price_bars', 'strategies', 'backtest_runs',
  'learn_progress', 'learn_step_progress', 'learn_cards', 'learn_reviews', 'learn_applied_actions',
  'learn_settings', 'learn_streak', 'learn_events', 'activity_log',
];

function seedOneRowPerTable(d) {
  const acc = repo.createAccount(d, { name: 'Checking', type: 'checking', balance: 100 });
  repo.createTransaction(d, { account_id: acc.id, date: '2026-01-01', amount: -10, payee: 'Test' });
  repo.createCategory(d, { id: 'seedcat', name: 'SeedCat', group: 'expenses' });
  repo.createBudget(d, { category_id: 'seedcat', period: 'monthly', limit: 100 });
  repo.createGoal(d, { name: 'Seed Goal', target: 1000, current: 10 });
  repo.createRule(d, { match: 'seed', category_id: 'seedcat' });
  repo.createHolding(d, { account_id: acc.id, symbol: 'AAPL', shares: 1, cost_basis: 100, current_price: 110 });
  repo.insertSnapshotIfMissing(d, { date: '2026-01-01', assets: 100, liabilities: 0, net: 100 });
  repo.createRecurring(d, { payee: 'Rent', amount: 1000, cadence: 'monthly', kind: 'bill' });
  repo.upsertHttpCache(d, { cache_key: 'seedkey', feature: 'markets', url: 'http://x', data: { a: 1 }, cached_at: new Date().toISOString() });
  repo.adjustPaperAccountCapital(d, 500);
  repo.createPaperPosition(d, { ticker: 'TSLA', direction: 'long', shares: 1, entry_price: 100, opened_at: new Date().toISOString() });
  repo.createPaperTrade(d, { ticker: 'TSLA', direction: 'long', shares: 1, entry_price: 100, exit_price: 110, pnl: 10, opened_at: '2026-01-01', closed_at: '2026-01-02' });
  repo.createPaperJournalEntry(d, { trade_id: null, note: 'seed note' });
  repo.appendAgentEvent(d, { event: 'seed_event', ts: new Date().toISOString() });
  repo.createDecision(d, { ticker: 'TSLA', direction: 'long', thesis: 'seed' });
  const dec = repo.getDecisions(d)[0];
  repo.createClose(d, { decision_id: dec.id, exit_price: 110, pnl: 10 });
  repo.createWatchlistItem(d, { symbol: 'MSFT' });
  repo.markImported(d, 'seedsource', 'seedid1');
  repo.upsertPriceCache(d, { id: 'seedpc', kind: 'index', symbol: 'SPY', price: 500, data: {} });
  repo.createAlertRule(d, { symbol: 'AAPL', condition: 'above', target: 200 });
  repo.upsertPriceBars(d, 'AAPL', [{ date: '2026-01-01', open: 100, high: 110, low: 90, close: 105, volume: 1000 }]);
  const strat = repo.createStrategy(d, { name: 'seed strategy', kind: 'sma', params: { fast: 10, slow: 20 } });
  repo.createBacktestRun(d, { config_hash: 'seedhash', strategy_id: strat.id, config: {}, outcome: 'complete', result: {}, metrics: {} });
  repo.upsertLearnProgress(d, 'seed-lesson', { status: 'completed', score_pct: 90 });
  repo.upsertLearnStepProgress(d, 'seed-lesson', 0, { status: 'done', answer: { a: 1 } });
  repo.upsertLearnCard(d, { lesson_id: 'seed-lesson', step_index: 0, due: new Date().toISOString(), stability: 1, difficulty: 1 });
  const card = repo.getAllLearnCards(d)[0];
  repo.appendLearnReview(d, { card_id: card.id, rating: 3, state: 1, due: new Date().toISOString() });
  const logEntry = repo.createActivityLogEntry(d, { source: 'seed', action: 'test', entity_type: 'x', entity_id: 'y' });
  repo.createLearnAppliedAction(d, { lesson_id: 'seed-lesson', action: 'seed-action', params: {}, entity_type: 'x', entity_id: 'y', activity_log_id: logEntry.id });
  repo.setLearnSettings(d, { daily_card_cap: 42 });
  repo.setLearnStreak(d, { current_streak: 5, longest_streak: 9 });
  repo.upsertLearnEvent(d, { reason: 'seed', source_type: 'test', source_id: 'seedid', data: { x: 1 } });
}

describe('backup round-trip (Sprint E)', () => {
  it('every schema table survives runBackup -> reset -> restoreBackup unchanged', async () => {
    const d = db();
    seedOneRowPerTable(d);

    const before = repo.readAll(d);
    for (const t of TABLES) {
      const count = Array.isArray(before[t]) ? before[t].length : (before[t] == null ? 0 : 1);
      expect(count, `expected a seeded row in "${t}"`).toBeGreaterThan(0);
    }

    const { date } = await runBackup({ force: true });
    store.reset(); // simulate data loss / a fresh machine before restore
    restoreBackup(date);
    const after = repo.readAll(db());

    // learn_events.id is an AUTOINCREMENT surrogate that importLearnEvent()
    // deliberately does not preserve — the row's real identity is the unique
    // (reason, source_type, source_id) triple, which does round-trip, and
    // nothing else in the schema has a foreign key to this id. Strip it
    // before comparing so the test tracks real data loss, not the surrogate.
    const stripId = (rows) => (Array.isArray(rows) ? rows.map(({ id, ...rest }) => rest) : rows);

    for (const t of TABLES) {
      const b = t === 'learn_events' ? stripId(before[t]) : before[t];
      const a = t === 'learn_events' ? stripId(after[t]) : after[t];
      expect(a, `table "${t}" did not round-trip`).toEqual(b);
    }
  });
});
