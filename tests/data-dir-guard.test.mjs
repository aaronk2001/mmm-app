// Sprint E, Track 1 — regression test for the data-dir footgun.
//
// server/db/connection.js used to fall back to the in-repo dev database
// (server/store/money/mmm.db) whenever MMM_DATA_DIR wasn't set. Any ad-hoc
// `node -e` or stray script that required the store hit this silently — it
// wiped the real dev DB once (see scripts/restore-dev-db.sh) and has been
// carried as known debt through five sprints. This test proves the fallback
// is gone: requiring connection.js with neither MMM_DATA_DIR nor the new
// explicit MMM_ALLOW_DEV_DB opt-in set must fail loudly, and must not touch
// the dev DB file at all.
//
// Runs in a real child process (not in-process) because this test file's own
// MMM_DATA_DIR is already set by tests/setup.mjs before any import runs —
// the whole point here is to reproduce what a bare `node script.js` actually
// sees, with no inherited opt-in.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEV_DB = path.join(ROOT, 'server', 'store', 'money', 'mmm.db');
const CONNECTION_PATH = path.join(ROOT, 'server', 'db', 'connection.js').split(path.sep).join('/');

// Requires server/db/connection.js in a fresh `node -e` process, with the
// caller's env layered on top of a clean slate (no MMM_DATA_DIR /
// MMM_ALLOW_DEV_DB / MMM_DB_FILE inherited from this test runner). Only
// requires the module — never calls db() — so even the "allowed" path can't
// write to the real dev DB from this test.
function requireConnectionIn(extraEnv) {
  const env = { ...process.env };
  delete env.MMM_DATA_DIR;
  delete env.MMM_ALLOW_DEV_DB;
  delete env.MMM_DB_FILE;
  Object.assign(env, extraEnv);

  const script =
    `try { const c = require(${JSON.stringify(CONNECTION_PATH)}); ` +
    `console.log(JSON.stringify({ ok: true, dataDir: c.DATA_DIR })); } ` +
    `catch (e) { console.error(e.message); process.exit(1); }`;

  return spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', cwd: ROOT, env });
}

describe('data-dir footgun guard (server/db/connection.js)', () => {
  it('refuses to resolve a data dir with neither MMM_DATA_DIR nor MMM_ALLOW_DEV_DB set, and never touches the dev DB', () => {
    const before = fs.statSync(DEV_DB).mtimeMs;

    const result = requireConnectionIn({});

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/MMM_DATA_DIR/);
    expect(result.stderr).toMatch(/MMM_ALLOW_DEV_DB/);

    const after = fs.statSync(DEV_DB).mtimeMs;
    expect(after).toBe(before);
  });

  it('resolves to the in-repo dev dir only when MMM_ALLOW_DEV_DB is explicitly set', () => {
    const before = fs.statSync(DEV_DB).mtimeMs;

    const result = requireConnectionIn({ MMM_ALLOW_DEV_DB: '1' });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(path.resolve(parsed.dataDir)).toBe(path.resolve(path.join(ROOT, 'server', 'store', 'money')));

    // Requiring the module alone (no db() call) must still leave the file untouched.
    const after = fs.statSync(DEV_DB).mtimeMs;
    expect(after).toBe(before);
  });

  it('resolves to an explicit MMM_DATA_DIR without needing the opt-in', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mmm-guard-test-'));
    try {
      const result = requireConnectionIn({ MMM_DATA_DIR: tmp });

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(path.resolve(parsed.dataDir)).toBe(path.resolve(tmp));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
