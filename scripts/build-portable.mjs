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
import { createRequire, builtinModules } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NM = path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, 'build', 'MMM-portable');
const APP = path.join(OUT, 'resources', 'app');
// yahoo-finance2 added for Sprint A, Track 2 (server/market/providers.js) —
// this array MUST land in the same commit as the package.json dependency, or
// the packaged app 500s on every market route the moment it's opened.
// ts-fsrs added for Sprint D, Track 1 (server/learn/fsrs.js) — same rule.
const SERVER_DEPS = ['better-sqlite3', 'compression', 'cors', 'dotenv', 'express', 'express-rate-limit', 'helmet', 'papaparse', 'ts-fsrs', 'yahoo-finance2'];

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
// THIRD_PARTY_NOTICES.md must travel with the binary (MIT/BSD/Apache/OFL all
// require the notice in distributions, not just the source repo).
for (const f of ['electron.js', 'preload.js', 'package.json', 'THIRD_PARTY_NOTICES.md']) {
  fs.copyFileSync(path.join(ROOT, f), path.join(APP, f));
}
fs.cpSync(path.join(ROOT, 'server'), path.join(APP, 'server'), { recursive: true });
fs.cpSync(path.join(ROOT, 'src', 'dist'), path.join(APP, 'src', 'dist'), { recursive: true });
fs.cpSync(path.join(ROOT, 'assets'), path.join(APP, 'assets'), { recursive: true }); // icon.ico, tray.png
// Lesson content (Sprint D, Track 1/2) — server/learn/content.js reads this
// at runtime, so it must ship inside the payload, not just node_modules deps.
if (fs.existsSync(path.join(ROOT, 'content'))) {
  fs.cpSync(path.join(ROOT, 'content'), path.join(APP, 'content'), { recursive: true });
}
// Verify the copy actually landed — if it silently misses the payload,
// content.js:loadLessons() returns [] and the packaged Learn section ships
// empty with a green build (the same trap class the require scan below
// exists to close, left open for content). Fail the build loudly instead.
if (!fs.existsSync(path.join(APP, 'content', 'learn', 'sources.yaml'))) {
  console.error('[3/6] FATAL: content/learn/sources.yaml missing from the packaged app — Learn would ship empty. Aborting.');
  process.exit(1);
}
// Never ship a database, legacy blob, or backups inside the app folder — user
// data lives in %APPDATA%\mmm and a fresh install must start empty. Match
// mmm.db* by prefix: dev-DB copies like mmm.db.pre-restore-* and
// mmm.db.corrupted-backup-* are real user data too.
const STORE = path.join(APP, 'server', 'store', 'money');
for (const name of fs.readdirSync(STORE)) {
  if (name.startsWith('mmm.db') || ['data.json', 'data.json.migrated.bak', 'backups'].includes(name)) {
    fs.rmSync(path.join(STORE, name), { recursive: true, force: true });
  }
}

// ── 4. Server dependency closure ──────────────────────────────────────────────
// Resolve a dependency the way Node does: walk up from the requiring package's
// own directory through each node_modules. A package nested under another
// (raw-body/node_modules/iconv-lite) is copied along with its parent, but its
// OWN dependencies must still be followed — otherwise a hoisted-only transitive
// dep (safer-buffer) silently drops out of the payload.
function resolveDep(name, fromDir) {
  // fromDir is a package dir; step up package by package: .../node_modules/[@scope/]pkg
  let dir = fromDir;
  while (dir.startsWith(NM + path.sep)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    dir = path.dirname(dir);
    if (path.basename(dir).startsWith('@')) dir = path.dirname(dir);
    if (path.basename(dir) === 'node_modules') dir = path.dirname(dir);
  }
  const top = path.join(NM, name);
  return fs.existsSync(path.join(top, 'package.json')) ? top : null; // null: optional dep never installed
}

function closure(roots) {
  const visited = new Set();   // resolved package dirs already walked
  const topLevel = new Set();  // names under NM to copy (nested ones ride along)
  const stack = roots.map((name) => ({ name, fromDir: ROOT }));
  while (stack.length) {
    const { name, fromDir } = stack.pop();
    const dir = resolveDep(name, fromDir);
    if (!dir || visited.has(dir)) continue;
    visited.add(dir);
    const rel = path.relative(NM, dir).split(path.sep);
    const topName = rel[0].startsWith('@') ? `${rel[0]}/${rel[1]}` : rel[0];
    topLevel.add(topName);
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const dep of [...Object.keys(pj.dependencies || {}), ...Object.keys(pj.optionalDependencies || {})]) {
      stack.push({ name: dep, fromDir: dir });
    }
  }
  return [...topLevel].sort();
}

const pkgs = closure(SERVER_DEPS);
log('4/6', `Copying server dependency closure (${pkgs.length} packages)…`);
for (const name of pkgs) {
  fs.cpSync(path.join(NM, name), path.join(APP, 'node_modules', name), { recursive: true });
}

// Assert every require() under the packaged server/ actually resolves from
// where it now lives. Guards against exactly the SERVER_DEPS mistake: a
// require() that resolves fine in the dev tree (node_modules/<pkg> is a
// sibling of server/) but was never added to the closure above would only
// surface as a 500 the first time a packaged user hits that route — this
// catches it at build time instead.
log('4/6', 'Asserting every require() under the packaged server/ resolves…');
const BUILTINS = new Set(builtinModules);
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
function walkJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}
const unresolved = [];
for (const file of walkJsFiles(path.join(APP, 'server'))) {
  const src = fs.readFileSync(file, 'utf8');
  const fileRequire = createRequire(file);
  let m;
  while ((m = REQUIRE_RE.exec(src))) {
    const spec = m[1];
    if (BUILTINS.has(spec.replace(/^node:/, ''))) continue;
    try {
      // Resolving is not enough. Node walks the directory chain upward, and
      // build/ lives inside the repo, so a package missing from the payload
      // still resolves against the dev tree's node_modules and the scan
      // passes — which is exactly the SERVER_DEPS trap this guard exists to
      // catch. Assert the resolution actually landed inside the payload.
      const resolved = fileRequire.resolve(spec);
      if (!resolved.startsWith(APP + path.sep)) {
        unresolved.push(`${path.relative(APP, file)} -> require('${spec}') resolved OUTSIDE the payload (${resolved})`);
      }
    } catch {
      unresolved.push(`${path.relative(APP, file)} -> require('${spec}') did not resolve`);
    }
  }
}
if (unresolved.length) {
  console.error('UNRESOLVED require() calls in packaged server/ (add the package to SERVER_DEPS, or fix the path):\n' + unresolved.join('\n'));
  process.exit(1);
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

// Best-effort: stamp the MMM.exe file icon (Explorer view). The window/tray
// icon + shortcut IconLocation already give MMM its identity everywhere the
// user actually looks, so a failure here (rcedit missing / AV block) is a
// warning, not a build failure.
const icoPath = path.join(ROOT, 'assets', 'icon.ico');
if (fs.existsSync(icoPath)) {
  try {
    const mod = await import('rcedit');
    const rcedit = mod.rcedit || mod.default;
    await rcedit(path.join(OUT, 'MMM.exe'), { icon: icoPath });
    log('5/6', 'Stamped MMM.exe icon.');
  } catch (e) {
    console.warn('[icon] could not set exe icon (window/tray/shortcut icon still apply):', e.message);
  }
}

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
