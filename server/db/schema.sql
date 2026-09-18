-- MMM data layer v2. Money is stored as INTEGER cents (exact math, no float
-- drift); the repo layer converts to dollars at its boundary so JS/API/UI keep
-- dollar amounts. Account balances are DERIVED (opening_balance_cents + sum of
-- transactions), never mutated. Reserved words (group, limit) are quoted.
-- Pragmas are set in connection.js.

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
  id                    TEXT PRIMARY KEY,
  name                  TEXT    NOT NULL,
  type                  TEXT    NOT NULL,
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  institution           TEXT    DEFAULT '',
  currency              TEXT    DEFAULT 'USD',
  status                TEXT    DEFAULT 'active',
  created_at            TEXT,
  custom                TEXT    DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS categories (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  "group" TEXT,
  color   TEXT,
  icon    TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id           TEXT PRIMARY KEY,
  account_id   TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  date         TEXT    NOT NULL,           -- YYYY-MM-DD
  amount_cents INTEGER NOT NULL,
  payee        TEXT    DEFAULT '',
  category_id  TEXT,
  tags         TEXT    DEFAULT '[]',       -- JSON array
  note         TEXT    DEFAULT '',
  source       TEXT    DEFAULT 'manual',
  cleared      INTEGER DEFAULT 0,
  custom       TEXT    DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_txn_account  ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_txn_date     ON transactions(date);

CREATE TABLE IF NOT EXISTS budgets (
  id          TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  period      TEXT NOT NULL,
  limit_cents INTEGER NOT NULL DEFAULT 0,
  rollover    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS goals (
  id                         TEXT PRIMARY KEY,
  name                       TEXT NOT NULL,
  target_cents               INTEGER NOT NULL DEFAULT 0,
  current_cents              INTEGER NOT NULL DEFAULT 0,
  linked_account_id          TEXT,
  target_date                TEXT,
  template                   TEXT,
  monthly_contribution_cents INTEGER,
  custom                     TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS rules (
  id          TEXT PRIMARY KEY,
  match       TEXT NOT NULL,
  category_id TEXT NOT NULL,
  tag         TEXT
);

CREATE TABLE IF NOT EXISTS holdings (
  id                  TEXT PRIMARY KEY,
  account_id          TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  symbol              TEXT NOT NULL,
  shares              REAL    DEFAULT 0,
  cost_basis_cents    INTEGER DEFAULT 0,
  current_price_cents INTEGER DEFAULT 0,
  price_source        TEXT    DEFAULT 'manual',
  updated_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id);

CREATE TABLE IF NOT EXISTS networth_snapshots (
  date              TEXT PRIMARY KEY,
  assets_cents      INTEGER NOT NULL DEFAULT 0,
  liabilities_cents INTEGER NOT NULL DEFAULT 0,
  net_cents         INTEGER NOT NULL DEFAULT 0
);

-- Declared recurring income/bills (user-managed; detection merges on top).
CREATE TABLE IF NOT EXISTS recurring (
  id           TEXT PRIMARY KEY,
  payee        TEXT    NOT NULL,
  amount_cents INTEGER NOT NULL,
  cadence      TEXT    NOT NULL,            -- monthly | biweekly | weekly | quarterly | annual
  kind         TEXT    NOT NULL,            -- income | bill
  next_date    TEXT,
  note         TEXT    DEFAULT '',
  account_id   TEXT                         -- when set, due items auto-post as transactions
);

-- Online seam (Sprint A, Track 1). Cache for server/online/index.js's
-- fetch() envelope, keyed by the caller's cacheKey (defaults to the request
-- URL). A cooldown or a disabled feature serves whatever row is here (or
-- nothing) instead of ever opening a socket.
CREATE TABLE IF NOT EXISTS http_cache (
  cache_key TEXT PRIMARY KEY,
  feature   TEXT,
  url       TEXT,
  data      TEXT    NOT NULL,               -- JSON-encoded response body
  cached_at TEXT    NOT NULL                -- ISO 8601 timestamp of the fetch that produced this row
);

-- Paper-trading ledger (Sprint A, Track 3). Paper-only forever — no brokerage
-- SDK, no live-order path. Money is INTEGER cents; repo.js converts at its
-- boundary like every other table here.

-- Singleton row (id='default') tracking virtual cash. Equity is derived at
-- read time as capital_cents + SUM(open positions' unrealized P&L), same
-- "derived, never mutated for that part" spirit as accounts.balance.
CREATE TABLE IF NOT EXISTS paper_account (
  id                      TEXT PRIMARY KEY DEFAULT 'default',
  capital_cents           INTEGER NOT NULL DEFAULT 10000000,
  starting_capital_cents  INTEGER NOT NULL DEFAULT 10000000,
  created_at              TEXT
);

CREATE TABLE IF NOT EXISTS paper_positions (
  id                 TEXT PRIMARY KEY,
  ticker             TEXT NOT NULL,
  direction          TEXT NOT NULL,          -- LONG | SHORT
  shares             REAL NOT NULL,
  entry_price_cents  INTEGER NOT NULL,
  stop_price_cents   INTEGER,
  target1_cents      INTEGER,
  target2_cents      INTEGER,
  thesis             TEXT DEFAULT '',
  decision_id        INTEGER,
  sector             TEXT,
  risk_amount_cents  INTEGER,
  opened_at          TEXT NOT NULL,
  source             TEXT DEFAULT 'app',     -- app | nexus (import)
  source_id          TEXT
);
CREATE INDEX IF NOT EXISTS idx_paper_positions_ticker ON paper_positions(ticker);

-- Closed trades — the paper-trading history / P&L journal. journal.json from
-- NEXUS imports here.
CREATE TABLE IF NOT EXISTS paper_trades (
  id                 TEXT PRIMARY KEY,
  ticker             TEXT NOT NULL,
  direction          TEXT NOT NULL,
  shares             REAL NOT NULL,
  entry_price_cents  INTEGER NOT NULL,
  exit_price_cents   INTEGER NOT NULL,
  pnl_cents          INTEGER NOT NULL,
  pnl_pct            REAL NOT NULL,
  thesis             TEXT DEFAULT '',
  sector             TEXT,
  decision_id        INTEGER,
  opened_at          TEXT NOT NULL,
  closed_at          TEXT NOT NULL,
  what_happened      TEXT DEFAULT '',
  lesson             TEXT DEFAULT '',
  source             TEXT DEFAULT 'app',     -- app | nexus (import)
  source_id          TEXT
);
CREATE INDEX IF NOT EXISTS idx_paper_trades_closed_at ON paper_trades(closed_at);

-- Free-form journal notes, optionally tied to a closed trade (the "Lesson
-- learned" field lives on paper_trades directly; this is the broader diary).
CREATE TABLE IF NOT EXISTS paper_journal (
  id          TEXT PRIMARY KEY,
  trade_id    TEXT REFERENCES paper_trades(id) ON DELETE CASCADE,
  note        TEXT NOT NULL,
  tag         TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paper_journal_trade ON paper_journal(trade_id);

-- Append-only event log — replaces NEXUS's journal.jsonl. tradesThisWeek()
-- and sectorFailures() in paper-store.js are indexed SQL over this table.
CREATE TABLE IF NOT EXISTS agent_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL,
  event   TEXT NOT NULL,                     -- buy | close | sell
  ticker  TEXT,
  sector  TEXT,
  outcome TEXT,                              -- win | loss
  data    TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_agent_events_ts    ON agent_events(ts);
CREATE INDEX IF NOT EXISTS idx_agent_events_event ON agent_events(event);

-- Reflection memory (from NEXUS's reflection.db). No embeddings — the
-- semantic thesis search that column backed is an LLM feature out of scope
-- for the paper ledger; drop it if it needs to come back later.
CREATE TABLE IF NOT EXISTS decisions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker             TEXT NOT NULL,
  direction          TEXT NOT NULL,
  entry_price_cents  INTEGER,
  thesis             TEXT DEFAULT '',
  consensus          TEXT DEFAULT '',
  pm                 TEXT DEFAULT '',
  context            TEXT DEFAULT '',
  created_at         TEXT,
  status             TEXT DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS closes (
  decision_id       INTEGER REFERENCES decisions(id) ON DELETE CASCADE,
  exit_price_cents  INTEGER,
  pnl_cents         INTEGER,
  return_pct        REAL,
  alpha_vs_spy      REAL,
  lesson            TEXT DEFAULT '',
  closed_at         TEXT
);

-- Symbol watchlist. Track 3 creates it to land the NEXUS watchlist.json
-- import; Track 2 (Markets, Wave 2) is expected to extend it additively
-- (e.g. ALTER for alert thresholds) rather than redefine it.
CREATE TABLE IF NOT EXISTS watchlist (
  id        TEXT PRIMARY KEY,
  symbol    TEXT NOT NULL UNIQUE,
  note      TEXT DEFAULT '',
  source    TEXT DEFAULT 'manual',           -- manual | nexus (import)
  added_at  TEXT
);

-- Idempotency ledger for scripts/import-nexus.mjs — re-running the import
-- must be a no-op keyed on (source, source_id).
CREATE TABLE IF NOT EXISTS import_log (
  source      TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (source, source_id)
);
