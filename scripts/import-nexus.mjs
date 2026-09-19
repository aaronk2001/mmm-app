// One-command NEXUS data import: node scripts/import-nexus.mjs [--dry-run]
//
// Thin ESM CLI wrapper around the CommonJS core (server/trading/import-nexus.js)
// so the same logic backs both this script and the "Import NEXUS data" button
// in Settings.jsx. Uses createRequire like scripts/build-portable.mjs does for
// the same server/CommonJS <-> scripts/ESM boundary.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runNexusImport } = require('../server/trading/import-nexus');

const dryRun = process.argv.includes('--dry-run');
const result = runNexusImport({ dryRun });

console.log(JSON.stringify(result, null, 2));
if (result.sourceMissing) console.log(`\n${result.message}`);
if (dryRun) console.log('\n(dry run — no rows were written)');
