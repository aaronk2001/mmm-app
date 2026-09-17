#!/usr/bin/env bash
# Removes Phase 0 agent scratch (git-ignored). Run from your own shell:
#   ! bash "/c/Users/aaron/projects/Finance agent/mmm-app/scripts/cleanup-phase0-scratch.sh"
set -e
cd "$(dirname "$0")/.."
rm -rf .superpowers/sdd/2026-09-16-phase0-land-and-fix .playwright-cli
echo "removed .superpowers/sdd/2026-09-16-phase0-land-and-fix and .playwright-cli"
