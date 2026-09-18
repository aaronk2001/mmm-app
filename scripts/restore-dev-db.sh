#!/usr/bin/env bash
# Restore the DEVELOPMENT database from its 2026-07-07 backup.
#
# WHY THIS EXISTS
# On 2026-09-17 a Task 4 sanity-check script was run with plain `node` and no
# MMM_DATA_DIR set. server/db/connection.js:14 falls back to the in-repo asset
# dir when that variable is absent, so the script's store.reset() ran against
# server/store/money/mmm.db — the dev database — and replaced its contents with
# three fake test accounts.
#
# WHAT IS *NOT* AFFECTED
#   %APPDATA%\mmm\mmm.db — the database MMM.exe actually uses — was never
#   touched. Verified 2026-09-17: 5 accounts, 32 transactions, 5 budgets,
#   4 holdings, file mtime unchanged since July 7. Your real money data is fine.
#
# WHAT THIS SCRIPT DOES
#   1. Copies the current (wiped) dev DB aside, timestamped, so this is undoable.
#   2. Copies backups/backup-2026-07-07.db over server/store/money/mmm.db.
#   3. Removes the stale -wal/-shm sidecars so SQLite does not replay them.
#
# WHAT YOU LOSE BY RUNNING IT
#   Any dev-DB change made between 2026-07-07 and today. The backup holds
#   5 accounts / 33 transactions / 5 budgets / 4 holdings.
#
# Run from the repo root:  bash scripts/restore-dev-db.sh
set -euo pipefail

cd "$(dirname "$0")/.."
DIR="server/store/money"
SRC="$DIR/backups/backup-2026-07-07.db"
DST="$DIR/mmm.db"
STAMP=$(date +%Y%m%d%H%M%S)

[ -f "$SRC" ] || { echo "ABORT: backup not found at $SRC"; exit 1; }

echo "Saving the current dev DB to $DST.pre-restore-$STAMP"
cp "$DST" "$DST.pre-restore-$STAMP"

echo "Restoring $SRC -> $DST"
cp "$SRC" "$DST"

for side in "-wal" "-shm"; do
  if [ -f "$DST$side" ]; then
    echo "Removing stale sidecar $DST$side"
    rm -f "$DST$side"
  fi
done

echo
echo "Done. Verify with:"
echo "  node -e \"const d=new (require('better-sqlite3'))('$DST',{readonly:true});console.log('accounts',d.prepare('SELECT COUNT(*) n FROM accounts').get().n,'transactions',d.prepare('SELECT COUNT(*) n FROM transactions').get().n)\""
echo "Expected: accounts 5 transactions 33"
echo
echo "Once you are happy, these can go:"
echo "  $DIR/mmm.db.corrupted-backup-20260917184013"
echo "  $DST.pre-restore-$STAMP"
