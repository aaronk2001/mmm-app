'use strict';
// One-time-per-record import from nexus-app's flat-file store into MMM's paper
// ledger. Idempotent via import_log keyed on (source='nexus', source_id) —
// re-running is always safe and a no-op for anything already imported.
//
// Shared core used by both scripts/import-nexus.mjs (CLI) and the "Import
// NEXUS data" button in Settings.jsx (POST /api/trading/import-nexus).
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { db } = require('../db/connection');
const repo = require('../db/repo');

const DEFAULT_NEXUS_DIR = path.join('C:', 'Users', 'you', 'projects', 'Finance agent', 'nexus-app', 'server', 'store');

function readJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function readReflectionDb(file) {
  if (!fs.existsSync(file)) return { decisions: [], closes: [] };
  const rdb = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return {
      decisions: rdb.prepare('SELECT * FROM decisions').all(),
      closes: rdb.prepare('SELECT * FROM closes').all(),
    };
  } finally {
    rdb.close();
  }
}

// Thrown internally to unwind (and thus roll back) the better-sqlite3
// transaction for a --dry-run — counts computed so far are kept, no rows land.
class DryRunAbort extends Error {}

function runNexusImport({ dataDir = DEFAULT_NEXUS_DIR, dryRun = false } = {}) {
  const d = db();
  const journal = readJsonSafe(path.join(dataDir, 'journal.json'), { entries: [] });
  const watchlist = readJsonSafe(path.join(dataDir, 'watchlist.json'), { tickers: [] });
  const snapshot = readJsonSafe(path.join(dataDir, 'snapshot.json'), {});
  const { decisions: nexusDecisions, closes: nexusCloses } = readReflectionDb(path.join(dataDir, 'reflection.db'));

  const counts = {
    decisions: { imported: 0, skipped: 0 },
    closes: { imported: 0, skipped: 0 },
    paper_trades: { imported: 0, skipped: 0 },
    watchlist: { imported: 0, skipped: 0 },
    profile: { imported: 0, skipped: 0 },
  };

  const body = () => {
    // reflection.db decisions — imported first so paper_trades/closes below can
    // remap NEXUS's local decision_id to the freshly-assigned mmm id.
    const decisionIdMap = new Map();
    for (const dec of nexusDecisions) {
      const sourceId = `decision:${dec.id}`;
      if (repo.hasImported(d, 'nexus', sourceId)) { counts.decisions.skipped++; continue; }
      const created = repo.createDecision(d, {
        ticker: dec.ticker, direction: dec.direction, entry_price: dec.entry_price,
        thesis: dec.thesis, consensus: dec.consensus, pm: dec.pm, context: dec.context,
        created_at: dec.created_at, status: dec.status,
      });
      decisionIdMap.set(dec.id, created.id);
      repo.markImported(d, 'nexus', sourceId);
      counts.decisions.imported++;
    }

    // reflection.db closes
    for (const c of nexusCloses) {
      const sourceId = `close:${c.decision_id}:${c.closed_at || ''}`;
      if (repo.hasImported(d, 'nexus', sourceId)) { counts.closes.skipped++; continue; }
      const mappedDecisionId = decisionIdMap.get(c.decision_id) ?? c.decision_id;
      repo.createClose(d, {
        decision_id: mappedDecisionId, exit_price: c.exit_price, pnl: c.pnl,
        return_pct: c.return_pct, alpha_vs_spy: c.alpha_vs_spy, lesson: c.lesson, closed_at: c.closed_at,
      });
      repo.markImported(d, 'nexus', sourceId);
      counts.closes.imported++;
    }

    // journal.json -> paper_trades
    for (const entry of journal.entries || []) {
      const sourceId = String(entry.id);
      if (repo.hasImported(d, 'nexus', sourceId)) { counts.paper_trades.skipped++; continue; }
      const mappedDecisionId = entry.decision_id != null ? (decisionIdMap.get(entry.decision_id) ?? null) : null;
      repo.createPaperTrade(d, {
        id: `nexus-${entry.id}`, ticker: entry.ticker, direction: entry.direction, shares: entry.shares,
        entry_price: entry.entry_price, exit_price: entry.exit_price, pnl: entry.pnl, pnl_pct: entry.pnl_pct,
        thesis: entry.thesis, decision_id: mappedDecisionId,
        opened_at: entry.opened_at, closed_at: entry.closed_at,
        what_happened: entry.what_happened, lesson: entry.lesson,
        source: 'nexus', source_id: sourceId,
      });
      repo.markImported(d, 'nexus', sourceId);
      counts.paper_trades.imported++;
    }

    // watchlist.json -> watchlist
    for (const symbolRaw of watchlist.tickers || []) {
      const symbol = String(symbolRaw).toUpperCase();
      const sourceId = `watchlist:${symbol}`;
      if (repo.hasImported(d, 'nexus', sourceId)) { counts.watchlist.skipped++; continue; }
      try {
        repo.createWatchlistItem(d, { symbol, source: 'nexus' });
        counts.watchlist.imported++;
      } catch (e) {
        // Symbol already present (added manually) — settle the import without
        // erroring; the ticker is on the list either way.
        if (!/UNIQUE/i.test(e.message)) throw e;
        counts.watchlist.skipped++;
      }
      repo.markImported(d, 'nexus', sourceId);
    }

    // snapshot.json -> settings.profile, only when nothing is there yet
    const snapshotSourceId = 'snapshot';
    if (repo.hasImported(d, 'nexus', snapshotSourceId)) {
      counts.profile.skipped++;
    } else {
      const existingProfile = repo.getSettings(d).profile || {};
      const hasSnapshotData = snapshot && typeof snapshot === 'object' && Object.keys(snapshot).length > 0;
      const profileEmpty = Object.keys(existingProfile).length === 0;
      if (hasSnapshotData && profileEmpty) {
        repo.setSettings(d, { profile: snapshot });
        counts.profile.imported = 1;
      } else {
        counts.profile.skipped = 1;
      }
      repo.markImported(d, 'nexus', snapshotSourceId);
    }

    if (dryRun) throw new DryRunAbort();
  };

  try {
    d.transaction(body)();
  } catch (e) {
    if (!(e instanceof DryRunAbort)) throw e;
  }

  return { dryRun, counts };
}

module.exports = { runNexusImport, DEFAULT_NEXUS_DIR };
