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

// This is a deliberate, documented CLI invocation (not the ad-hoc `node -e`
// case server/db/connection.js's guard exists for) — its long-standing
// default has been to land in the in-repo dev DB when MMM_DATA_DIR isn't set
// (see archive-nexus.sh's UNDO step for the explicit-MMM_DATA_DIR case).
// Preserve that default by opting in on the caller's behalf; a caller who
// wants the packaged app's real data dir instead still sets MMM_DATA_DIR.
if (!process.env.MMM_DATA_DIR) process.env.MMM_ALLOW_DEV_DB = '1';

const require = createRequire(import.meta.url);
const { runNexusImport } = require('../server/trading/import-nexus');

const dryRun = process.argv.includes('--dry-run');
const dataDirIdx = process.argv.indexOf('--data-dir');
const dataDir = dataDirIdx !== -1 ? process.argv[dataDirIdx + 1] : undefined;
const result = runNexusImport({ dryRun, ...(dataDir ? { dataDir } : {}) });

console.log(JSON.stringify(result, null, 2));
if (result.sourceMissing) console.log(`\n${result.message}`);
if (dryRun) console.log('\n(dry run — no rows were written)');
