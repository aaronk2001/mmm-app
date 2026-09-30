# MMM Ledger and Data Layer

## Abstract

MMM's data layer stores financial ledgers in SQLite (schema v2), organized around integer arithmetic, derived balances, and local-date semantics. Money is stored as INTEGER cents to eliminate floating-point drift; the repository boundary converts to dollars. Account balances are DERIVED—computed at read time as opening balance plus the sum of transactions—and never mutated directly, preventing a class of consistency bugs. This document describes the schema, migration strategy, the local-date rule (dates as 'YYYY-MM-DD' strings), the import pipeline (CSV/OFX/QIF with auto-categorization), backups, and the data-directory safety guard.

## Problem and Goals

Legacy data was stored in floating-point dollars, causing rounding errors. No idempotent migration path existed between schema versions. Account balances were mutated by every transaction, requiring careful synchronization. Date comparisons using `new Date('YYYY-MM-DD')` silently shifted dates by one day west of UTC.

**Goals:**
- Exact money math with no rounding or drift.
- Derived balances remove the mutual-update-consistency problem.
- Schema migrations are idempotent and data is never silently lost.
- Date handling is local-time-aware, with comparison via string keys.
- Import pipeline is fully validated before any write to the database.
- Backups survive the full schema and restore without data loss.

## Design

### Money: Integer Cents, Dollar Boundary

Money is stored as INTEGER cents in the database. The repository layer (`server/db/repo.js:11-12`) converts at the boundary:

```
toCents = (v) => Math.round((parseFloat(v) || 0) * 100)
toDollars = (c) => (c == null ? null : Math.round(c) / 100)
```

All JavaScript callers (routes, UI, store) work in dollars. Every monetary column in the schema ends in `_cents` (e.g. `amount_cents`, `opening_balance_cents`, `target_cents`). This eliminates floating-point drift in interest calculations, multi-step conversions, and export/re-import cycles. The single source of rounding is at conversion boundaries.

### Account Balances: Derived, Never Mutated

Account balance is computed as `opening_balance_cents + SUM(transactions.amount_cents)` every time it is read. The schema (`server/db/schema.sql:12-22`) stores only the opening balance; the `balance_cents` column never appears in the table:

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id                    TEXT PRIMARY KEY,
  name                  TEXT    NOT NULL,
  type                  TEXT    NOT NULL,
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  ...
);
```

The repository layer computes the derived balance via `ACCOUNT_SELECT` (`server/db/repo.js:114-118`):

```sql
SELECT a.*, (a.opening_balance_cents + COALESCE(
  (SELECT SUM(t.amount_cents) FROM transactions t WHERE t.account_id = a.id), 0
)) AS balance_cents
FROM accounts a
```

When a user edits an account balance, the `updateAccount` function adjusts `opening_balance_cents` so the derived value lands exactly on the requested number (`server/db/repo.js:150-155`). This design removes the risk of balance drift from concurrent transaction writes or duplicate imports; the balance is always consistent with what the ledger says, by construction.

### Schema and Migrations

**Schema v1 → v2** (`server/db/connection.js:67-141`): The migration function `migrateSchema()` runs once at database open. It detects the schema version (stored in the `meta` table); if the database is already v2, it is a no-op. For a v1 database, it:

1. Reads all rows from `accounts`, `transactions`, `budgets`, `goals`, etc.
2. Converts money columns from REAL dollars to INTEGER cents.
3. Computes `opening_balance_cents` for each account: `opening_balance_cents = (original_balance_cents) - (sum_of_transactions_cents)`.
4. Drops and recreates all money-related tables with the new schema.
5. Reinserts the converted data.
6. Stamps `schema_version = '2'` in the `meta` table.

Declared recurring items (stored as `extras.recurring` in v1) are moved to their own table, `recurring`. The migration is wrapped in a database transaction; either all rows migrate or none do.

**Additive migrations** (`server/db/connection.js:146-153`): For v2 databases, `applyAdditiveMigrations()` runs after schema creation. New columns are added with `ALTER TABLE` if they do not already exist (checked via `PRAGMA table_info`). Example: `recurring.account_id` was added later via `ALTER TABLE recurring ADD COLUMN account_id TEXT`, guarded by a table-info check, so re-running the migration on a database that already has the column is safe (no-op).

**Data-directory safety** (`server/db/connection.js:26-35`): The `db()` function refuses to open a database unless one of the following is true:
- `MMM_DATA_DIR` is set (the packaged app sets `%APPDATA%\mmm`).
- `MMM_ALLOW_DEV_DB=1` is set (npm run dev / npm start do this).

Without either, the function throws an error and does not fall back to the in-repo dev database (`server/store/money/mmm.db`). This guard prevents accidental data loss from scripts and one-liners that would otherwise clobber the dev database. The test `tests/data-dir-guard.test.mjs` proves this: requiring `server/db/connection.js` with neither env var set fails loudly and never touches the dev database.

### Local-Date Semantics: YYYY-MM-DD Strings

Dates are stored as 'YYYY-MM-DD' TEXT and compared as strings, never parsed to Date objects. The bug this prevents: `new Date('2026-09-23')` in JavaScript parses as UTC midnight (2026-09-23T00:00:00Z), which is September 22, 8pm in Arizona (UTC-7). So `new Date('2026-09-23').getDate()` returns 22, not 23.

The `src/lib/localDate.js` helpers enforce the rule:

```javascript
// Parse a day key to LOCAL midnight, not UTC.
export function parseYmd(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d); // local midnight
}

// Today as a 'YYYY-MM-DD' key in LOCAL time, not UTC.
export function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
```

The tests (`tests/localDate.test.mjs:1-43`) set `TZ=America/Phoenix` and demonstrate that these helpers return the correct calendar day even in time zones west of UTC. Every date string in the database uses the `todayYmd()` helper or is explicitly formatted as `YYYY-MM-DD`. The `calc.js` module (`server/money/calc.js:9`) documents the rule in its header: "Dates are compared as 'YYYY-MM-DD' STRINGS, never via new Date()." Budget month windows and transaction date filters all compare date strings, never Date objects.

### Import Pipeline: CSV, OFX, QIF

Imports go through `server/money/parsers.js`:

- **CSV** (`parseCSV`): Uses papaparse (RFC4180) with a configurable column mapping. Handles quoted fields, embedded commas, and newlines. Normalizes headers (trim, case-fold).
- **OFX** (`parseOFX`): Hand-parsed STMTTRN blocks. Extracts date (DTPOSTED as YYYYMMDD), amount, payee, and memo. Falls back to local today if the date is missing.
- **QIF** (`parseQIF`): Hand-parsed records (split by `^`), with codes D (date), T/U (amount), P (payee), M (memo). The `normalizeQifDate` function pivots two-digit years at 70 (00–69 → 20xx, 70–99 → 19xx), then normalizes to 'YYYY-MM-DD'.

All parsers return a flat list of `{ date, amount, payee, note }` objects. Dates are ALWAYS returned as 'YYYY-MM-DD' strings (or the local-calendar today if unparseable). The import route validates every row (dates, amounts, required fields) before inserting.

**Auto-categorization** via rules (`server/db/repo.js`): After import, the `applyRules()` function matches transaction payees against the rules table and assigns categories. This is a simple string-contains match, not fuzzy matching.

### Backups: Scheduler, Format, Retention

The backup scheduler (`server/backup/scheduler.js:1-116`) runs every 24 hours on startup:

1. Creates `<DATA_DIR>/backups/backup-YYYY-MM-DD.json` with a `mmm-backup@1` wrapper:
   ```json
   {
     "format": "mmm-backup@1",
     "created": "ISO-8601-timestamp",
     "data": { full data blob },
     "settings": { user settings }
   }
   ```

2. Creates `<DATA_DIR>/backups/backup-YYYY-MM-DD.db` via a live online SQLite backup (safe while the DB is in use).

3. Retains the newest 30 days (pruned by date key, not file count).

**Restore** (`server/backup/scheduler.js:86-103`): The `restoreBackup(date)` function:
- Loads the JSON backup for the given date.
- Validates the format (`mmm-backup@1` or legacy).
- Calls `store.writeData()` to repopulate the live database.
- Restores settings if present.

The test `tests/backup-roundtrip.test.mjs` seeds one row into every schema table, runs the backup, wipes the database, restores, and diffs. Every table listed in BLOB_KEYS (`server/db/repo.js`) must round-trip unchanged; adding a table to the schema without adding a seed row here is a real data-loss bug.

## Invariants

1. **Money is stored as INTEGER cents in the database and converted to dollars at the repository boundary** (`server/db/connection.js:65`, `server/db/repo.js:11-12`). All monetary columns in the schema end in `_cents`.

2. **Account balance is derived: `balance = opening_balance_cents + SUM(transactions.amount_cents)`**, computed at read time, never stored or mutated (`server/db/repo.js:114-118`). Editing a balance adjusts the opening balance so the derived value matches exactly (`server/db/repo.js:150-155`).

3. **Dates are stored as TEXT 'YYYY-MM-DD' and compared as strings**, never parsed to Date objects (`server/db/schema.sql:35`, `server/money/calc.js:9`). The helpers `parseYmd()` and `todayYmd()` enforce local-time semantics (`src/lib/localDate.js:1-16`).

4. **Schema migrations are idempotent**: the migration function is a no-op if the database is already at the target version (`server/db/connection.js:76-77`). Additive migrations check for column existence before altering (`server/db/connection.js:147-151`).

5. **The data directory is guarded**: `db()` refuses to open without `MMM_DATA_DIR` or `MMM_ALLOW_DEV_DB` explicitly set; there is no fallback to the in-repo dev database (`server/db/connection.js:26-35`).

6. **Dates in all import parsers return as 'YYYY-MM-DD' strings** (or local calendar today if unparseable) (`server/money/parsers.js:40-49`, `server/money/parsers.js:78-90`).

7. **Backups include the full data blob plus a live SQLite copy, both dated by local calendar day**, with retention of 30 days (`server/backup/scheduler.js:14-15`, `server/backup/scheduler.js:25-49`).

8. **The restore path validates the backup format** before writing to the live database, and restores settings if the backup includes them (`server/backup/scheduler.js:91-98`).

9. **Request validators require dates to be exactly 'YYYY-MM-DD'** and check that the parsed date round-trips to the input string, preventing impossible dates like 2026-02-30 (`server/middleware/validators.js:14-19`).

10. **Balance computation handles multi-currency conversion** via fx rates at the calc layer; the database stores one balance per account in its declared currency (`server/money/calc.js:22-48`).

## Verification

- `tests/localDate.test.mjs:11-43` pins `parseYmd()` and `todayYmd()` to local midnight, with `TZ=America/Phoenix` to test the UTC-negative case.
- `tests/parsers.test.mjs:20-106` verifies CSV (RFC4180 with quoted fields), QIF (Y2K pivot), and OFX (STMTTRN extraction); normalizeQifDate fallback returns local calendar day.
- `tests/calc.test.mjs:26-87` characterizes balance derivation, budget computation, and recurring detection.
- `tests/data-dir-guard.test.mjs:51-119` confirms that requiring `connection.js` without `MMM_DATA_DIR` or `MMM_ALLOW_DEV_DB` fails loudly and never touches the dev database.
- `tests/backup-roundtrip.test.mjs:67-95` seeds every schema table, runs the real backup scheduler, wipes the database, restores, and diffs; tables not listed in BLOB_KEYS would be silent data loss.
- `tests/store.test.mjs` (referenced in calc.test.mjs setup) uses the in-memory test database.

## Known Limitations and Future Work

- **Two-digit QIF years pivot at 70**: 00–69 → 20xx, 70–99 → 19xx. Files with two-digit years from the 2070s would be mis-dated.

- **No import de-duplication**: the pipeline is ingest-and-categorize, not bank sync. Importing the same file twice inserts the rows twice; there is no staging area, bank-side transaction ID, or duplicate detection yet.

- **Restore trusts the backup file**: `restoreBackup()` checks the wrapper format but does not re-validate foreign keys or row contents after the write.

- **The local-day helper is duplicated** across `src/lib/localDate.js`, `server/money/calc.js`, and `server/db/repo.js` (the server is CommonJS and the SPA is ESM). All copies are covered by tests, but they must be kept in step by hand.
