-- MMM 2.0 data layer (Phase 0). Normalized tables mirror the legacy data.json
-- blob shape 1:1 so the existing store.js functions keep working unchanged.
-- Reserved words (group, limit) are quoted. Pragmas are set in connection.js.

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  type        TEXT,
  balance     REAL    DEFAULT 0,
  institution TEXT    DEFAULT '',
  currency    TEXT    DEFAULT 'USD',
  status      TEXT    DEFAULT 'active',
  created_at  TEXT,
  custom      TEXT    DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS categories (
  id      TEXT PRIMARY KEY,
  name    TEXT,
  "group" TEXT,
  color   TEXT,
  icon    TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id          TEXT PRIMARY KEY,
  account_id  TEXT,
  date        TEXT,
  amount      REAL,
  payee       TEXT    DEFAULT '',
  category_id TEXT,
  tags        TEXT    DEFAULT '[]',  -- JSON array
  note        TEXT    DEFAULT '',
  source      TEXT    DEFAULT 'manual',
  cleared     INTEGER DEFAULT 0,
  custom      TEXT    DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_txn_account  ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_txn_date     ON transactions(date);

CREATE TABLE IF NOT EXISTS budgets (
  id          TEXT PRIMARY KEY,
  category_id TEXT,
  period      TEXT,
  "limit"     REAL,
  rollover    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS goals (
  id                   TEXT PRIMARY KEY,
  name                 TEXT,
  target               REAL,
  current              REAL,
  linked_account_id    TEXT,
  target_date          TEXT,
  template             TEXT,
  monthly_contribution REAL,
  custom               TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS rules (
  id          TEXT PRIMARY KEY,
  match       TEXT,
  category_id TEXT,
  tag         TEXT
);

CREATE TABLE IF NOT EXISTS holdings (
  id            TEXT PRIMARY KEY,
  account_id    TEXT,
  symbol        TEXT,
  shares        REAL    DEFAULT 0,
  cost_basis    REAL    DEFAULT 0,
  current_price REAL    DEFAULT 0,
  price_source  TEXT    DEFAULT 'manual',
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id);

CREATE TABLE IF NOT EXISTS networth_snapshots (
  date        TEXT PRIMARY KEY,
  assets      REAL,
  liabilities REAL,
  net         REAL
);
