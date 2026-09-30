'use strict';

// Regenerates docs/screenshots/*.png from the built SPA and the sample data.
//   npm run build && npm run screenshots
// Boots the real server against a throwaway data dir (never your data), seeds
// the sample, and captures each route in an offscreen 1440x900 Electron window.
const { app, BrowserWindow } = require('electron');
const { fork } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = ['overview', 'transactions', 'budget', 'cashflow', 'debt', 'plan', 'reports', 'learn'];
// Recharts animates on mount; capture only after it settles.
const SETTLE_MS = 4000;

let server = null;
const stopServer = () => { if (server && !server.killed) server.kill(); };
process.on('exit', stopServer);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth() {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* booting */ }
    await sleep(500);
  }
  throw new Error('server did not come up');
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'src', 'dist', 'index.html'))) {
    throw new Error('src/dist is missing — run `npm run build` first');
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmm-shots-'));
  // System node, not Electron's: the dev better-sqlite3 binary is built for Node's ABI.
  server = fork(path.join(ROOT, 'server', 'index.js'), [], {
    execPath: process.env.NODE_BINARY || 'node',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', MMM_DATA_DIR: dataDir, PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  await waitForHealth();
  await fetch(`${BASE}/api/money/seed-sample`, { method: 'POST' });
  // A complete profile keeps the first-run intake closed and fills the Plan panels.
  await fetch(`${BASE}/api/plan/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Alex', age: 29, state: 'AZ', filing_status: 'single', gross_salary: 85000 }),
  });
  console.log('server up, sample seeded');

  // A plain hidden window never paints, so capturePage() returns an empty image.
  // Offscreen rendering paints to a buffer at a fixed size, no window needed.
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false, useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  win.webContents.setFrameRate(30);
  await win.loadURL(`${BASE}/`);
  // Session flags the app sets once per launch: skip the welcome card, the
  // launch digest/nudges, and the profile intake. Then reload so they apply.
  await win.webContents.executeJavaScript(`
    ['mmm-entered', 'mmm-coach-launched', 'mmm-profile-skipped'].forEach((k) => sessionStorage.setItem(k, '1'));
    true`);
  await win.loadURL(`${BASE}/`);
  console.log('app loaded');

  fs.mkdirSync(OUT, { recursive: true });
  for (const name of SHOTS) {
    // Hash routes are same-document navigations; loadURL() would never settle.
    await win.webContents.executeJavaScript(`location.hash = '#/${name}'; true`);
    await sleep(SETTLE_MS);
    const img = await win.webContents.capturePage();
    if (img.isEmpty()) throw new Error(`empty capture for ${name}`);
    fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
    console.log(`captured ${name}.png`);
  }
}

setTimeout(() => { console.error('screenshots: timed out'); stopServer(); app.exit(1); }, 5 * 60 * 1000).unref();

app.whenReady()
  .then(main)
  .then(() => { stopServer(); app.quit(); })
  .catch((err) => { console.error(err); stopServer(); app.exit(1); });
