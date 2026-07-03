// Point the data layer at a throwaway SQLite DB before any test imports store.js.
// (migrateLegacyDb may copy the dev DB here; tests that need a clean slate call
// store.reset() in their own beforeAll.)
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

if (!process.env.MMM_DATA_DIR || !process.env.MMM_DATA_DIR.includes('mmm-vitest-')) {
  process.env.MMM_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mmm-vitest-'));
}
