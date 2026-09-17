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
  cadence      TEXT    NOT NULL,            -- monthly | biweekly | weekly
  kind         TEXT    NOT NULL,            -- income | bill
  next_date    TEXT,
  note         TEXT    DEFAULT '',
  account_id   TEXT                         -- when set, due items auto-post as transactions
);
