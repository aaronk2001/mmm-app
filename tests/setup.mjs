// Point the data layer at a throwaway SQLite DB before any test imports store.js.
// A fresh dir starts empty — nothing is copied from the dev DB any more.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

if (!process.env.MMM_DATA_DIR || !process.env.MMM_DATA_DIR.includes('mmm-vitest-')) {
  process.env.MMM_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mmm-vitest-'));
}
