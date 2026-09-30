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

-- Idempotency ledger for one-time data imports — re-running an import must be
-- a no-op keyed on (source, source_id). Retained for existing databases.
CREATE TABLE IF NOT EXISTS import_log (
  source      TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (source, source_id)
);

-- Markets section (Sprint A, Track 2). Structured "last known" price data,
-- written only by server/market/snapshots.js's interval job (opt-in, 30 min,
-- market hours only) or an explicit Refresh — never by a UI render. This is
-- deliberately separate from `http_cache`: http_cache is the online seam's
-- generic raw-response cache keyed by request URL, while price_cache is the
-- normalized, typed shape the Markets UI reads directly with zero network
-- risk (id = `${kind}:${symbol}`, e.g. "quote:AAPL", "index:^GSPC").
CREATE TABLE IF NOT EXISTS price_cache (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,               -- quote | index | future | crypto | fx | macro
  symbol      TEXT NOT NULL,
  price_cents INTEGER,
  change_pct  REAL,
  data        TEXT    DEFAULT '{}',        -- JSON-encoded full quote/series payload
  source      TEXT    DEFAULT 'yahoo',     -- yahoo | fred | coingecko | frankfurter
  fetched_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_cache_kind ON price_cache(kind);

-- Price alert thresholds for a watched symbol. Storage-only in Sprint A — no
-- evaluator/notification engine is in scope for this track; that's future
-- work once the online seam grows a notification path.
CREATE TABLE IF NOT EXISTS alert_rules (
  id            TEXT PRIMARY KEY,
  symbol        TEXT NOT NULL,
  condition     TEXT NOT NULL,             -- above | below
  target_cents  INTEGER NOT NULL,
  active        INTEGER DEFAULT 1,
  created_at    TEXT,
  triggered_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_alert_rules_symbol ON alert_rules(symbol);

-- Backtester (Sprint B, Wave 2). Bars come from either an offline CSV upload
-- (source='csv', works with zero API keys) or a Yahoo pull through Sprint A's
-- online.fetch seam (source='yahoo') — both land here so the run endpoint
-- reads one table regardless of origin. Dates are local 'YYYY-MM-DD' strings,
-- never a Date object (see server/backtest/engine.js header).
CREATE TABLE IF NOT EXISTS price_bars (
  symbol         TEXT    NOT NULL,
  date           TEXT    NOT NULL,
  open_cents     INTEGER NOT NULL,
  high_cents     INTEGER NOT NULL,
  low_cents      INTEGER NOT NULL,
  close_cents    INTEGER NOT NULL,
  volume         INTEGER,
  split          REAL    DEFAULT 1,
  dividend_cents INTEGER DEFAULT 0,
  source         TEXT    DEFAULT 'csv',        -- csv | yahoo
  PRIMARY KEY (symbol, date)
);
CREATE INDEX IF NOT EXISTS idx_price_bars_symbol ON price_bars(symbol);

-- Named, reusable strategy presets — `kind` maps to a factory in
-- server/backtest/strategies.js, `params` is that factory's JSON-encoded args.
CREATE TABLE IF NOT EXISTS strategies (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  params     TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

-- One row per backtest run. `config_hash` lets an identical run (same
-- symbols/dates/strategy/params/costs) be recognised across repeats.
-- `outcome` is the enum the routes layer and the UI both key off of.
CREATE TABLE IF NOT EXISTS backtest_runs (
  id          TEXT PRIMARY KEY,
  config_hash TEXT NOT NULL,
  strategy_id TEXT REFERENCES strategies(id) ON DELETE SET NULL,
  config      TEXT NOT NULL,                   -- JSON snapshot of the request
  outcome     TEXT NOT NULL,                   -- completed | no_data | invalid_config | failed
  error       TEXT,
  result      TEXT,                            -- JSON: engine.js output (outcome=completed only)
  metrics     TEXT,                            -- JSON: metrics.js output (outcome=completed only)
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_hash ON backtest_runs(config_hash);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_created ON backtest_runs(created_at);

-- Learn engine (Sprint D, Track 1). Single local user, same spirit as
-- paper_account's singleton row — no user_id columns. Lesson CONTENT lives in
-- content/learn/**/*.md (Track 2), never in these tables; every figure a
-- lesson quotes is computed live by server/learn/variables.js.

CREATE TABLE IF NOT EXISTS learn_progress (
  lesson_id          TEXT PRIMARY KEY,
  status             TEXT    NOT NULL DEFAULT 'not_started', -- not_started | in_progress | completed | mastered
  score_pct          REAL,
  apply_action_done  INTEGER NOT NULL DEFAULT 0,
  started_at         TEXT,
  completed_at       TEXT,
  updated_at         TEXT    NOT NULL
);

-- Per-step position within a lesson (the "Esc saves position" resume point
-- and closed-book check answers). One row per (lesson, step).
CREATE TABLE IF NOT EXISTS learn_step_progress (
  id          TEXT PRIMARY KEY,
  lesson_id   TEXT    NOT NULL,
  step_index  INTEGER NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending', -- pending | correct | wrong | skipped
  answer      TEXT    DEFAULT '{}',
  updated_at  TEXT    NOT NULL,
  UNIQUE (lesson_id, step_index)
);
CREATE INDEX IF NOT EXISTS idx_learn_step_progress_lesson ON learn_step_progress(lesson_id);

-- 1:1 with ts-fsrs's Card shape (server/learn/fsrs.js). A card is created the
-- first time a lesson's ::check step is answered Wrong/Hard and enters the
-- spaced-repetition review queue.
CREATE TABLE IF NOT EXISTS learn_cards (
  id              TEXT    PRIMARY KEY,
  lesson_id       TEXT    NOT NULL,
  step_index      INTEGER NOT NULL,
  due             TEXT    NOT NULL,
  stability       REAL    NOT NULL DEFAULT 0,
  difficulty      REAL    NOT NULL DEFAULT 0,
  elapsed_days    INTEGER NOT NULL DEFAULT 0,
  scheduled_days  INTEGER NOT NULL DEFAULT 0,
  learning_steps  INTEGER NOT NULL DEFAULT 0,
  reps            INTEGER NOT NULL DEFAULT 0,
  lapses          INTEGER NOT NULL DEFAULT 0,
  state           INTEGER NOT NULL DEFAULT 0,   -- ts-fsrs State enum (0 New .. 3 Relearning)
  last_review     TEXT,
  created_at      TEXT    NOT NULL,
  UNIQUE (lesson_id, step_index)
);
CREATE INDEX IF NOT EXISTS idx_learn_cards_due ON learn_cards(due);

-- Append-only ts-fsrs review history, one row per grading.
CREATE TABLE IF NOT EXISTS learn_reviews (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id            TEXT    NOT NULL REFERENCES learn_cards(id) ON DELETE CASCADE,
  rating             INTEGER NOT NULL,          -- ts-fsrs Rating enum (1 Again .. 4 Easy)
  state              INTEGER NOT NULL,
  due                TEXT,
  stability          REAL,
  difficulty         REAL,
  elapsed_days       INTEGER,
  last_elapsed_days  INTEGER,
  scheduled_days     INTEGER,
  reviewed_at        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learn_reviews_card ON learn_reviews(card_id);

-- Apply-action registry ledger (server/learn/apply.js). Every write a lesson
-- triggers goes through the existing validators/store functions and is
-- recorded here; undo replays the `before` snapshot in activity_log.
CREATE TABLE IF NOT EXISTS learn_applied_actions (
  id                TEXT PRIMARY KEY,
  lesson_id         TEXT,
  action            TEXT    NOT NULL,
  params            TEXT    DEFAULT '{}',
  entity_type       TEXT,
  entity_id         TEXT,
  activity_log_id   INTEGER REFERENCES activity_log(id) ON DELETE SET NULL,
  applied_at        TEXT    NOT NULL,
  undone_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_learn_applied_actions_lesson ON learn_applied_actions(lesson_id);

CREATE TABLE IF NOT EXISTS learn_settings (
  id                   TEXT PRIMARY KEY DEFAULT 'default',
  daily_card_cap       INTEGER NOT NULL DEFAULT 20,
  session_minutes_cap  INTEGER NOT NULL DEFAULT 7,
  core_retention       REAL    NOT NULL DEFAULT 0.90,
  trivia_retention     REAL    NOT NULL DEFAULT 0.85,
  updated_at           TEXT
);

CREATE TABLE IF NOT EXISTS learn_streak (
  id                TEXT PRIMARY KEY DEFAULT 'default',
  current_streak    INTEGER NOT NULL DEFAULT 0,
  longest_streak    INTEGER NOT NULL DEFAULT 0,
  last_active_date  TEXT,
  updated_at        TEXT
);

-- Generic idempotent event log for the Learn engine — unique on
-- (reason, source_type, source_id); re-processing the same source updates
-- `data`/`updated_at` in place rather than duplicating a row. Used by
-- content.js's content-sync idempotency and by lesson-completion events.
CREATE TABLE IF NOT EXISTS learn_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reason        TEXT    NOT NULL,
  source_type   TEXT    NOT NULL,
  source_id     TEXT    NOT NULL,
  data          TEXT    DEFAULT '{}',
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  UNIQUE (reason, source_type, source_id)
);

-- General-purpose undo ledger. apply.js is the first writer; the shape is
-- generic on purpose (source/action/entity + before/after JSON snapshots) so
-- any future "apply a change, allow undo" surface can reuse it.
CREATE TABLE IF NOT EXISTS activity_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT    NOT NULL,               -- e.g. 'learn'
  action        TEXT    NOT NULL,
  entity_type   TEXT    NOT NULL,
  entity_id     TEXT,
  before        TEXT,                           -- JSON snapshot pre-write (null = row didn't exist)
  after         TEXT,                           -- JSON snapshot post-write (null = row was deleted)
  created_at    TEXT    NOT NULL,
  undone_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_log_source ON activity_log(source);
