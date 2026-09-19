#!/usr/bin/env bash
# scripts/archive-nexus.sh
#
# WHAT THIS DOES
#   Archives the legacy NEXUS Electron app now that mmm-app has absorbed its
#   Money Hub and the rest of NEXUS's surface has been deliberately ported,
#   cut, or deferred (see docs/NEXUS-PARITY.md for the full accounting).
#   Concretely, in order:
#     1. Copies  C:\Users\aaron\projects\Finance agent\nexus-app
#            to  C:\Users\aaron\projects\_archive\nexus-app
#        and VERIFIES the copy (file count match) before touching anything
#        else — the archive destination is the backup, so nothing is deleted
#        until that backup is confirmed complete.
#     2. Deletes the original nexus-app directory.
#     3. Deletes the NEXUS.lnk desktop shortcut
#        (C:\Users\aaron\Desktop\NEXUS.lnk). mmm-app's own shortcut
#        (MMMoney.lnk) is never touched by this script.
#
# WHAT IS LOST
#   - The NEXUS Electron shell itself (dashboard, sidebar, every tab) is
#     archived, not destroyed — it becomes cold storage: no longer launched
#     by the desktop shortcut, no longer live-developed, but still on disk
#     at the archive path and fully restorable (see UNDO).
#   - Any NEXUS server state written to nexus-app/server/store/* or
#     reflection.db AFTER the one-time scripts/import-nexus.mjs migration
#     Aaron already ran (which pulled in 2 paper trades and 2 watchlist
#     tickers). That newer data will exist only in the archived copy until
#     someone re-runs the importer against it (see UNDO, step 3).
#   - The NEXUS.lnk desktop shortcut.
#   - Nothing else. Every feature NEXUS-PARITY.md lists as "Cut" (AI/Desk,
#     Betting, Media, Telegram, Learn beyond M0-M2) was already absent from
#     mmm-app before this script exists — archiving nexus-app doesn't itself
#     remove any additional capability from mmm-app.
#
# HOW TO UNDO
#   1. Move the archive back:
#        mv "/c/Users/aaron/projects/_archive/nexus-app" "/c/Users/aaron/projects/Finance agent/nexus-app"
#   2. Recreate the desktop shortcut by re-running nexus-app's own installer
#      build (electron-builder / nsis target in nexus-app/package.json has
#      createDesktopShortcut: true, productName: "NEXUS"), or manually create
#      a shortcut to the rebuilt exe named NEXUS.lnk on the Desktop.
#   3. To pull in anything nexus-app accumulated after the last import, run
#      the importer against wherever nexus-app currently lives, e.g.:
#        node scripts/import-nexus.mjs
#      (uses the default path; only works if step 1 above was done first), or
#      point it at the archive directly without restoring it:
#        node -e "console.log(require('./server/trading/import-nexus').runNexusImport({dataDir: '/c/Users/aaron/projects/_archive/nexus-app/server/store'}))"
#      The importer is idempotent (keyed on source+source_id) — safe to run
#      against either location, and safe to run more than once.
#
# NOTE ON GIT
#   nexus-app is NOT its own git repository — it is plain content tracked
#   (partially — see docs/NEXUS-PARITY.md's verification checklist) inside
#   the umbrella repo at C:\Users\aaron\projects. This script does not run
#   any git command. After running it, `git status` in that umbrella repo
#   will show nexus-app's tracked files (journal.json, snapshot.json,
#   watchlist.json, source, package.json, etc.) as deleted from their old
#   path — review and commit that yourself, in the umbrella repo, whenever
#   you're ready. The archived copy is plain filesystem content under
#   _archive/nexus-app; it is not automatically git-added anywhere by this
#   script.
#
# SAFE TO RUN TWICE
#   - If nexus-app no longer exists at its original path and the archive
#     already exists, this script prints a message and exits 0 without
#     touching anything (already archived).
#   - If neither exists, it exits 1 (nothing to archive, and no archive to
#     report).
#   - If BOTH exist (e.g. a previous run was interrupted after the copy but
#     before the delete), it refuses to guess which one is authoritative and
#     exits 1 with instructions to resolve by hand.
#
# THIS SCRIPT IS DESTRUCTIVE AND IRREVERSIBLE (short of the archive copy and
# git history) ONCE THE ORIGINAL IS DELETED. Aaron runs this by hand, when
# he's ready — it is written but intentionally NOT executed as part of any
# automated sprint.

set -euo pipefail

SRC="/c/Users/aaron/projects/Finance agent/nexus-app"
DEST="/c/Users/aaron/projects/_archive/nexus-app"
SHORTCUT="/c/Users/aaron/Desktop/NEXUS.lnk"

if [ ! -e "$SRC" ] && [ -e "$DEST" ]; then
  echo "[archive-nexus] nexus-app is already archived at: $DEST"
  echo "[archive-nexus] Nothing to do."
  exit 0
fi

if [ ! -e "$SRC" ]; then
  echo "[archive-nexus] Nothing found at $SRC, and no archive at $DEST either — nothing to archive." >&2
  exit 1
fi

if [ -e "$DEST" ]; then
  echo "[archive-nexus] Both $SRC and $DEST already exist — refusing to overwrite either." >&2
  echo "[archive-nexus] This looks like a previous run was interrupted partway through. Resolve by hand:" >&2
  echo "  - if $DEST is a complete, good copy: remove $SRC yourself, then re-run this script (it will now see only the archive and no-op)." >&2
  echo "  - if $DEST is incomplete or bad: remove $DEST yourself, then re-run this script to redo the copy." >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"

echo "[archive-nexus] Copying nexus-app -> $DEST ..."
echo "[archive-nexus] (this includes node_modules and can take a few minutes)"
cp -a "$SRC" "$DEST"

echo "[archive-nexus] Verifying copy (comparing file counts) before deleting the original..."
src_count=$(find "$SRC" -type f | wc -l)
dest_count=$(find "$DEST" -type f | wc -l)
if [ "$src_count" != "$dest_count" ]; then
  echo "[archive-nexus] COPY VERIFICATION FAILED: $src_count files at source vs $dest_count at destination." >&2
  echo "[archive-nexus] Leaving the original untouched. Nothing was deleted. Investigate $DEST before retrying." >&2
  exit 1
fi
echo "[archive-nexus] Copy verified ($dest_count files match). Removing the original..."

rm -rf "$SRC"
echo "[archive-nexus] Removed original: $SRC"

if [ -e "$SHORTCUT" ]; then
  rm -f "$SHORTCUT"
  echo "[archive-nexus] Removed desktop shortcut: $SHORTCUT"
else
  echo "[archive-nexus] No desktop shortcut found at $SHORTCUT (already removed, or never existed here) — nothing to remove."
fi

echo "[archive-nexus] Done. nexus-app is archived at: $DEST"
echo "[archive-nexus] Review and commit the resulting change in C:\\Users\\aaron\\projects (the umbrella repo) when you're ready — this script does not touch git."
