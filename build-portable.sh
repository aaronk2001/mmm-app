#!/usr/bin/env bash
# Thin wrapper — the real pipeline lives in scripts/build-portable.mjs
# (dependency-closure copy + better-sqlite3 Electron-ABI injection + smoke test).
set -e
cd "$(dirname "$0")"
node scripts/build-portable.mjs
