// One-command portable build: node scripts/build-portable.mjs
//
// Hand-assembles build/MMM-portable/MMM.exe (electron-builder is blocked on
// this machine by the winCodeSign symlink privilege error). Two hard-won
// constraints are codified here:
//   1. Copy only the SERVER dependency closure, never all of node_modules —
//      the AV-scanned spaced path makes a full copy time out. Frontend deps
//      are already bundled into src/dist by vite.
//   2. better-sqlite3 ships a Node-ABI binary from `npm install`; Electron
//      needs the Electron-ABI build, injected via prebuild-install into the
//      COPY only (the dev tree keeps the Node ABI for vitest / plain node).
//
// Ends with a smoke test: boots the packaged server via ELECTRON_RUN_AS_NODE
// against a throwaway data dir and polls /api/health.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NM = path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, 'build', 'MMM-portable');
const APP = path.join(OUT, 'resources', 'app');
const SERVER_DEPS = ['better-sqlite3', 'compression', 'cors', 'dotenv', 'express', 'express-rate-limit', 'helmet', 'papaparse'];

const run = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });

function log(step, msg) {
  console.log(`[${step}] ${msg}`);
}

// ── 1. Frontend bundle ────────────────────────────────────────────────────────
log('1/6', 'Building SPA (vite)…');
run('npm run build');

// ── 2. Electron runtime ───────────────────────────────────────────────────────
log('2/6', `Copying Electron runtime -> ${path.relative(ROOT, OUT)}`);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(NM, 'electron', 'dist'), OUT, { recursive: true });
fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, 'MMM.exe'));

// ── 3. App payload ────────────────────────────────────────────────────────────
log('3/6', 'Injecting app -> resources/app');
fs.mkdirSync(path.join(APP, 'src'), { recursive: true });
for (const f of ['electron.js', 'preload.js', 'package.json']) {
  fs.copyFileSync(path.join(ROOT, f), path.join(APP, f));
}
fs.cpSync(path.join(ROOT, 'server'), path.join(APP, 'server'), { recursive: true });
fs.cpSync(path.join(ROOT, 'src', 'dist'), path.join(APP, 'src', 'dist'), { recursive: true });
// Never ship a database, legacy blob, or backups inside the app folder — user
// data lives in %APPDATA%\mmm and a fresh install must start empty.
for (const junk of ['mmm.db', 'mmm.db-wal', 'mmm.db-shm', 'data.json', 'data.json.migrated.bak', 'backups']) {
  fs.rmSync(path.join(APP, 'server', 'store', 'money', junk), { recursive: true, force: true });
}

// ── 4. Server dependency closure ──────────────────────────────────────────────
function closure(roots) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    const dir = path.join(NM, name);
    if (!fs.existsSync(dir)) continue; // optional dep that never installed
    seen.add(name);
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const dep of [...Object.keys(pj.dependencies || {}), ...Object.keys(pj.optionalDependencies || {})]) {
      stack.push(dep);
    }
  }
  return [...seen].sort();
}

const pkgs = closure(SERVER_DEPS);
log('4/6', `Copying server dependency closure (${pkgs.length} packages)…`);
for (const name of pkgs) {
  fs.cpSync(path.join(NM, name), path.join(APP, 'node_modules', name), { recursive: true });
}

// ── 5. better-sqlite3 Electron-ABI injection ─────────────────────────────────
const electronVersion = JSON.parse(fs.readFileSync(path.join(NM, 'electron', 'package.json'), 'utf8')).version;
log('5/6', `Injecting better-sqlite3 Electron-ABI binary (electron ${electronVersion})…`);
const prebuildBin = path.join(NM, 'prebuild-install', 'bin.js');
if (!fs.existsSync(prebuildBin)) {
  console.error('prebuild-install not found in node_modules — cannot fetch the Electron-ABI binary.');
  process.exit(1);
}
run(`node "${prebuildBin}" -r electron -t ${electronVersion}`, {
  cwd: path.join(APP, 'node_modules', 'better-sqlite3'),
});

const rev = (() => {
  try { return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { return 'unknown'; }
})();
fs.writeFileSync(path.join(OUT, 'VERSION.txt'), `MMM portable\nbuilt: ${new Date().toISOString()}\ncommit: ${rev}\nelectron: ${electronVersion}\n`);

// ── 6. Smoke test ─────────────────────────────────────────────────────────────
log('6/6', 'Smoke test: booting packaged server under Electron (RUN_AS_NODE)…');
const PORT = 5119;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmm-pkgsmoke-'));
const child = spawn(path.join(OUT, 'MMM.exe'), [path.join(APP, 'server', 'index.js')], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT), MMM_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => (serverLog += d));
child.stderr.on('data', (d) => (serverLog += d));

function getJson(p) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}${p}`, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ code: res.statusCode, body }));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(1000, () => { req.destroy(); resolve(null); });
  });
}

let healthy = false;
// Generous window: Defender scans the freshly written exe on first launch,
// which can hold the cold start well past 30s.
for (let i = 0; i < 240; i++) {
  // eslint-disable-next-line no-await-in-loop
  const h = await getJson('/api/health');
  healthy = h?.code === 200;
  if (healthy) break;
  // eslint-disable-next-line no-await-in-loop
  await new Promise((r) => setTimeout(r, 500));
}
// /api/health never touches SQLite — a data endpoint must also work so a
// fresh-install DB bootstrap failure can't hide behind a passing health check.
const overview = healthy ? await getJson('/api/money/overview') : null;
const dataOk = overview?.code === 200 && overview.body.includes('netWorth');
child.kill();

if (!healthy || !dataOk) {
  console.error(`SMOKE FAIL — health=${healthy} dataEndpoint=${dataOk ? 'ok' : (overview && overview.body.slice(0, 200)) || 'unreachable'}\n--- server output ---\n` + serverLog);
  process.exit(1);
}

const sizeMb = (dir) => {
  try {
    let total = 0;
    for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (e.isFile()) total += fs.statSync(path.join(e.parentPath ?? e.path, e.name)).size;
    }
    return (total / 1024 / 1024).toFixed(0) + ' MB';
  } catch { return 'size n/a'; }
};
console.log(`\nSMOKE PASS — portable ready: ${path.join(OUT, 'MMM.exe')} (${sizeMb(OUT)}, commit ${rev})`);
