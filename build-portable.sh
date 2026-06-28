#!/usr/bin/env bash
# Hand-assembles a standalone MMM.exe portable build (electron-builder is blocked
# on this machine by the winCodeSign symlink privilege error). Mirrors the proven
# NEXUS approach: copy the Electron runtime, rename electron.exe -> MMM.exe, and
# inject the app into resources/app. Uses cp/tar (robocopy fails on the spaced path).
set -e
cd "$(dirname "$0")"

DIST=node_modules/electron/dist
OUT=build/MMM-portable
APP="$OUT/resources/app"

echo "[1/5] Building SPA…"
npm run build >/dev/null 2>&1

echo "[2/5] Copying Electron runtime -> $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -r "$DIST/." "$OUT/"
mv "$OUT/electron.exe" "$OUT/MMM.exe"

echo "[3/5] Injecting app -> resources/app"
rm -rf "$APP"
mkdir -p "$APP/src"
cp electron.js preload.js package.json "$APP/"
cp -r server "$APP/server"
cp -r src/dist "$APP/src/dist"

echo "[4/5] Copying node_modules (excluding electron + electron-builder dead weight)…"
tar cf - \
  --exclude='node_modules/electron' \
  --exclude='node_modules/electron-builder' \
  --exclude='node_modules/.cache' \
  --exclude='node_modules/.bin' \
  node_modules | ( cd "$APP" && tar xf - )

echo "[5/5] Done."
ls -la "$OUT/MMM.exe"
du -sh "$OUT" 2>/dev/null || true
