// One-command NEXUS data import:
//   node scripts/import-nexus.mjs [--dry-run] [--data-dir <path>]
//
// Thin ESM CLI wrapper around the CommonJS core (server/trading/import-nexus.js)
// so the same logic backs both this script and the "Import NEXUS data" button
// in Settings.jsx. Uses createRequire like scripts/build-portable.mjs does for
// the same server/CommonJS <-> scripts/ESM boundary.
//
// --data-dir overrides the default nexus-app store path (e.g. to import from
// an archived copy per scripts/archive-nexus.sh's UNDO step) — this is the
// supported way to do that; do not reach for a bare `node -e` requiring this
// module directly, since that bypasses this file's env/argv handling.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runNexusImport } = require('../server/trading/import-nexus');

const dryRun = process.argv.includes('--dry-run');
const dataDirIdx = process.argv.indexOf('--data-dir');
const dataDir = dataDirIdx !== -1 ? process.argv[dataDirIdx + 1] : undefined;
const result = runNexusImport({ dryRun, ...(dataDir ? { dataDir } : {}) });

console.log(JSON.stringify(result, null, 2));
if (result.sourceMissing) console.log(`\n${result.message}`);
if (dryRun) console.log('\n(dry run — no rows were written)');
