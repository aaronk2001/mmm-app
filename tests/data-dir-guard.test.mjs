// Sprint E, Track 1 — regression test for the data-dir footgun.
//
// server/db/connection.js used to fall back to the in-repo dev database
// (server/store/money/mmm.db) whenever MMM_DATA_DIR wasn't set. Any ad-hoc
// `node -e` or stray script that required the store hit this silently — it
// wiped the real dev DB once and has been
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
// null on a fresh clone with no dev DB — the guard assertions still hold.
const devDbMtime = () => (fs.existsSync(DEV_DB) ? fs.statSync(DEV_DB).mtimeMs : null);
const DEV_DIR = path.dirname(DEV_DB);
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
    const before = devDbMtime();

    const result = requireConnectionIn({});

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/MMM_DATA_DIR/);
    expect(result.stderr).toMatch(/MMM_ALLOW_DEV_DB/);

    const after = devDbMtime();
    expect(after).toBe(before);
  });

  it('resolves to the in-repo dev dir only when MMM_ALLOW_DEV_DB is explicitly set', () => {
    const before = devDbMtime();

    const result = requireConnectionIn({ MMM_ALLOW_DEV_DB: '1' });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(path.resolve(parsed.dataDir)).toBe(path.resolve(path.join(ROOT, 'server', 'store', 'money')));

    // Requiring the module alone (no db() call) must still leave the file untouched.
    const after = devDbMtime();
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

  // The removed migrateLegacyDb() opened the dev DB read-write, checkpointed it
  // and copied it into every fresh MMM_DATA_DIR; initialize() also imported the
  // dev data.json. A fresh dir must start empty and leave the dev dir alone.
  it('opens a fresh MMM_DATA_DIR empty, without reading or writing the dev dir', () => {
    const snapshot = () => (fs.existsSync(DEV_DIR)
      ? fs.readdirSync(DEV_DIR).sort().map((n) => { const s = fs.statSync(path.join(DEV_DIR, n)); return `${n}:${s.size}:${s.mtimeMs}`; })
      : []);
    const before = snapshot();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mmm-guard-test-'));
    try {
      const script =
        `const c = require(${JSON.stringify(CONNECTION_PATH)}); const d = c.db(); ` +
        `const n = (t) => d.prepare('SELECT COUNT(*) AS n FROM ' + t).get().n; ` +
        `console.log(JSON.stringify({ accounts: n('accounts'), transactions: n('transactions') })); d.close();`;
      const env = { ...process.env, MMM_DATA_DIR: tmp };
      delete env.MMM_ALLOW_DEV_DB;
      delete env.MMM_DB_FILE;
      const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', cwd: ROOT, env });

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim().split('\n').pop())).toEqual({ accounts: 0, transactions: 0 });
      expect(snapshot()).toEqual(before);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
