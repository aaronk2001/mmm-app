const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net  = require('net');
const { fork, execFileSync } = require('child_process');
// Zero-dependency list of known provider names (see the file for why this
// isn't `require('./server/online')` — that would pull in db/connection.js).
const KNOWN_PROVIDERS = require('./server/online/features');

const SERVER_PORT = 5006;
// A real API key/token is well under this; it's generous headroom, not a
// realistic ceiling, so it can't be used to bloat keys.enc via IPC.
const MAX_SECRET_LENGTH = 4096;

let mainWindow = null;
let serverProcess = null;
let tray = null;
let isQuitting = false;

// ─── Daily-driver preferences ────────────────────────────────────────────────
// Tiny JSON alongside the user data (%APPDATA%\mmm). Governs close-to-tray and
// launch-on-boot; the renderer reads/writes these over IPC (see preload.js).
const PREFS_DIR = path.join(app.getPath('appData'), 'mmm');
const PREFS_FILE = path.join(PREFS_DIR, 'desktop-prefs.json');
let prefs = { closeToTray: false, launchOnBoot: false };

function loadPrefs() {
  try { prefs = { ...prefs, ...JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) }; } catch { /* defaults */ }
}
function savePrefs() {
  try { fs.mkdirSync(PREFS_DIR, { recursive: true }); fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs)); }
  catch (e) { console.error('[MMM] could not save prefs:', e.message); }
}
function applyLoginItem() {
  // Only meaningful for the packaged exe (the dev electron.exe path isn't MMM).
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!prefs.launchOnBoot, path: app.getPath('exe') }); }
  catch (e) { console.error('[MMM] setLoginItemSettings failed:', e.message); }
}

// ─── Online seam — encrypted API keys (Sprint A, Track 1) ───────────────────
// Keys touch disk only here, only through safeStorage. Never localStorage,
// never .env, never SQLite — keys.enc lives beside desktop-prefs.json in
// %APPDATA%\mmm and is excluded from repo.readAll/writeAll, so the backup/
// export path can never pick it up. The decrypted map is kept in this
// process's memory only and is pushed to the forked server over the existing
// fork() IPC channel; it is never written back out by the server.
const KEYS_FILE = path.join(PREFS_DIR, 'keys.enc');
const DEV_SECRETS_FILE = path.join(PREFS_DIR, 'secrets.dev.json'); // plaintext — only when safeStorage is unavailable
let secretsCache = null;

function loadSecrets() {
  if (secretsCache) return secretsCache;
  try {
    if (fs.existsSync(KEYS_FILE) && safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(fs.readFileSync(KEYS_FILE));
      secretsCache = JSON.parse(decrypted);
      return secretsCache;
    }
  } catch (e) {
    console.error('[MMM] keys.enc unreadable, starting with no saved keys:', e.message);
  }
  try {
    if (fs.existsSync(DEV_SECRETS_FILE)) {
      console.warn('[MMM] WARNING: reading secrets.dev.json — keys are stored in PLAINTEXT (OS key encryption is unavailable on this machine).');
      secretsCache = JSON.parse(fs.readFileSync(DEV_SECRETS_FILE, 'utf8'));
      return secretsCache;
    }
  } catch { /* corrupt or missing — fall through to empty */ }
  secretsCache = {};
  return secretsCache;
}

function saveSecrets(map) {
  secretsCache = { ...map };
  try {
    fs.mkdirSync(PREFS_DIR, { recursive: true });
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(KEYS_FILE, safeStorage.encryptString(JSON.stringify(secretsCache)));
      // Drop any stale plaintext fallback now that real encryption is available.
      try { fs.unlinkSync(DEV_SECRETS_FILE); } catch { /* not present */ }
    } else {
      console.warn('[MMM] WARNING: OS key encryption unavailable — saving secrets.dev.json in PLAINTEXT. Do not store real keys on a shared machine like this.');
      fs.writeFileSync(DEV_SECRETS_FILE, JSON.stringify(secretsCache));
    }
  } catch (e) {
    console.error('[MMM] failed to persist keys:', e.message);
  }
}

// Pushes the decrypted map to the forked server over Node's fork() IPC
// channel — never over HTTP, never to disk from the server's side.
function pushSecretsToServer() {
  if (serverProcess && serverProcess.connected) {
    serverProcess.send({ type: 'secrets', keys: loadSecrets() });
  }
}

// Inline LIGHT splash shown instantly while the local server cold-starts, so the
// window is never a blank rectangle (first launch can take a while while Windows
// Defender scans node_modules on a cold cache).
const SPLASH_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(
  '<!doctype html><meta charset="utf-8"><style>' +
  'html,body{margin:0;height:100%;background:#0f1115;color:#e6e9ee;' +
  'font-family:Inter,Segoe UI,system-ui,sans-serif;display:flex;align-items:center;' +
  'justify-content:center;flex-direction:column;gap:16px}' +
  '.mark{width:56px;height:56px}' +
  '.b{font-size:26px;font-weight:800;letter-spacing:.06em;' +
  'background:linear-gradient(120deg,#2dd4bf,#4ade80);-webkit-background-clip:text;' +
  '-webkit-text-fill-color:transparent}' +
  '.s{font-size:11px;letter-spacing:.2em;color:#616d7e;text-transform:uppercase}' +
  '.r{width:26px;height:26px;border:3px solid #29313f;border-top-color:#2dd4bf;' +
  'border-radius:50%;animation:s .8s linear infinite;margin-top:8px}' +
  '@keyframes s{to{transform:rotate(360deg)}}' +
  '</style>' +
  '<svg class="mark" viewBox="0 0 32 32" fill="none"><defs>' +
  '<linearGradient id="g" x1="4" y1="26" x2="28" y2="6" gradientUnits="userSpaceOnUse">' +
  '<stop stop-color="#2dd4bf"/><stop offset="1" stop-color="#4ade80"/></linearGradient></defs>' +
  '<rect x="1" y="1" width="30" height="30" rx="8" fill="#0f1115" stroke="url(#g)" stroke-opacity="0.35"/>' +
  '<rect x="8" y="17" width="4" height="7" rx="2" fill="url(#g)"/>' +
  '<rect x="14" y="12" width="4" height="12" rx="2" fill="url(#g)"/>' +
  '<rect x="20" y="7" width="4" height="17" rx="2" fill="url(#g)"/></svg>' +
  '<div class="b">MMM</div><div class="s">Making Money Moves</div>' +
  '<div class="r"></div>'
);

// Kill any process already bound to a port so the forked server always gets it.
function killPort(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => {
      // Port is occupied — find and kill the specific PID via netstat (never a
      // blanket node.exe kill, which would take down other apps / NEXUS).
      try {
        const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
        const lines = out.split('\n').filter(l => l.includes(`:${port} `) || l.includes(`:${port}\t`));
        for (const line of lines) {
          const pid = line.trim().split(/\s+/).pop();
          if (pid && /^\d+$/.test(pid) && pid !== '0') {
            try { execFileSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' }); } catch {}
          }
        }
      } catch {}
      setTimeout(resolve, 300); // give the OS time to release the port
    });
    probe.once('listening', () => { probe.close(() => resolve()); });
    probe.listen(port, '127.0.0.1');
  });
}

function startServer() {
  const serverPath = path.join(__dirname, 'server', 'index.js');
  // Packaged builds keep user data in %APPDATA%\mmm so rebuilding/replacing the
  // portable exe never touches it. Dev keeps repo-local data (server fallback).
  const env = { ...process.env, PORT: SERVER_PORT };
  if (app.isPackaged && !env.MMM_DATA_DIR) {
    env.MMM_DATA_DIR = path.join(app.getPath('appData'), 'mmm');
  } else if (!app.isPackaged && !env.MMM_DATA_DIR) {
    // server/db/connection.js now refuses the in-repo dev-DB fallback unless
    // this is set — this is the one deliberate place that opts in, so
    // `npm run dev` / `npm start` keep using the dev DB exactly as before.
    env.MMM_ALLOW_DEV_DB = '1';
  }
  serverProcess = fork(serverPath, [], {
    env,
    silent: false,
  });
  serverProcess.on('error', (err) => console.error('Server process error:', err));
  serverProcess.on('exit', (code) => { if (code !== 0) console.error(`Server exited with code ${code}`); });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 600,
    backgroundColor: '#0f1115',
    title: 'MMM',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Content Security Policy — scoped to MMM's own local server. Nothing else
  // is reachable; the app is fully offline.
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:5006 http://localhost:5006; img-src 'self' data: https:; font-src 'self' data:; frame-ancestors 'none';"
        ],
      },
    });
  });

  mainWindow.webContents.on('render-process-gone', (_e, d) =>
    console.error(`[renderer] process gone: ${d.reason} (exit ${d.exitCode})`));
  mainWindow.webContents.on('preload-error', (_e, p, err) =>
    console.error(`[renderer] preload error in ${p}: ${err && err.message}`));

  // Show the splash immediately; loadApp() swaps in the real UI once the server
  // answers, so the window is never a blank rectangle.
  mainWindow.loadURL(SPLASH_URL);

  // Close-to-tray: when enabled, closing the window hides it instead of quitting
  // (the app keeps running in the tray). A real quit sets isQuitting first.
  mainWindow.on('close', (e) => {
    if (!isQuitting && prefs.closeToTray && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  // Open external links in the browser, not Electron — web URLs only.
  // openExternal hands file:, smb:, ms-* etc. to the OS shell, so anything
  // else is dropped.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // setWindowOpenHandler above only stops a NEW window/tab; it does nothing
  // against a main-frame navigation (window.location = ..., a clicked link
  // with no target). MMM never navigates the main frame itself outside
  // loadURL() calls this file makes directly (which don't fire this event),
  // so any 'will-navigate' is either a bug or a compromised renderer trying
  // to escape the app — deny it unconditionally.
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
}

function showWindow() {
  if (!mainWindow) { createWindow(); startServer(); waitForServer().then(loadApp); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// System-tray presence so MMM can live in the tray (close-to-tray) and be
// reopened without a fresh cold start. Best-effort — no tray icon, no tray.
function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', 'tray.png');
    const img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) return; // no asset -> skip; close-to-tray falls back to normal close
    tray = new Tray(img);
    tray.setToolTip('MMM — Making Money Moves');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show MMM', click: showWindow },
      { label: 'Hide', click: () => mainWindow && mainWindow.hide() },
      { type: 'separator' },
      { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.on('click', () => {
      if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) mainWindow.hide();
      else showWindow();
    });
  } catch (e) {
    console.error('[MMM] tray init failed:', e.message);
  }
}

// Swap the splash for the real app once the server is up; retry if the load
// races the final port bind (ERR_CONNECTION_REFUSED).
function loadApp() {
  if (!mainWindow) return;
  mainWindow.loadURL(`http://127.0.0.1:${SERVER_PORT}`);
  mainWindow.webContents.once('did-fail-load', (_e, code) => {
    if (code === -3) return;          // superseded navigation — ignore
    setTimeout(loadApp, 1000);
  });
}

function waitForServer(maxAttempts = 600, intervalMs = 250) {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      const req = http.get(`http://127.0.0.1:${SERVER_PORT}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(200, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      attempts++;
      if (attempts >= maxAttempts) return resolve(); // give up, open anyway
      setTimeout(check, intervalMs);
    };
    check();
  });
}

// ─── Single-instance lock ───────────────────────────────────────────────────
// Keyed by appId/userData (com.mmm.money), so MMM's lock is fully independent of
// NEXUS's — both can run at once. A second MMM launch just focuses the window.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    loadPrefs();
    applyLoginItem();
    await killPort(SERVER_PORT);   // clear any stale MMM server (never NEXUS's :5005)
    createWindow();                // show the splash immediately
    createTray();                  // tray presence (enables close-to-tray)
    startServer();
    await waitForServer();         // wait for the server to bind :5006
    pushSecretsToServer();         // hand any saved keys to the fresh server process
    loadApp();                     // swap splash -> real UI
  });
}

app.on('window-all-closed', () => {
  // With close-to-tray the window is hidden (not closed), so this won't fire;
  // when it does (tray off), quitting is the right call.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) showWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (serverProcess) serverProcess.kill();
});

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-desktop-prefs', () => ({ ...prefs, canLaunchOnBoot: app.isPackaged }));
ipcMain.handle('set-launch-on-boot', (_e, enabled) => {
  prefs.launchOnBoot = !!enabled; savePrefs(); applyLoginItem();
  return prefs.launchOnBoot;
});
ipcMain.handle('set-close-to-tray', (_e, enabled) => {
  prefs.closeToTray = !!enabled; savePrefs();
  return prefs.closeToTray;
});

// GET returns presence booleans only — the renderer must never be able to
// read a saved key value back out, only whether one is set.
ipcMain.handle('secrets:get', () => {
  const map = loadSecrets();
  const presence = {};
  for (const k of Object.keys(map)) presence[k] = !!map[k];
  return presence;
});
// A compromised renderer can't read keys.enc (safeStorage never leaves this
// process, and 'secrets:get' only returns presence booleans), but with no
// validation here it could still overwrite/delete an arbitrary key or bloat
// keys.enc with junk. Provider must be one of the known features; value is
// capped in length.
ipcMain.handle('secrets:set', (_e, payload) => {
  const provider = payload && payload.provider;
  if (!provider || typeof provider !== 'string' || !KNOWN_PROVIDERS.includes(provider)) {
    throw new Error('Unknown provider.');
  }
  const value = payload.value;
  if (value != null && (typeof value !== 'string' || value.length > MAX_SECRET_LENGTH)) {
    throw new Error('Invalid key value.');
  }
  const next = { ...loadSecrets() };
  if (value) next[provider] = String(value); else delete next[provider];
  saveSecrets(next);
  pushSecretsToServer();
  return true;
});

// Native OS notification for a critical coach finding. Clicking it focuses MMM.
ipcMain.handle('coach-notify', (_e, payload) => {
  try {
    const { Notification } = require('electron');
    if (!Notification.isSupported()) return false;
    const n = new Notification({
      title: String(payload?.title || 'MMM').slice(0, 120),
      body: String(payload?.body || '').slice(0, 240),
      silent: false,
    });
    n.on('click', () => { if (mainWindow) showWindow(); });
    n.show();
    return true;
  } catch { return false; }
});
