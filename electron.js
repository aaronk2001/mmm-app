const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const http = require('http');
const net  = require('net');
const { fork, execFileSync } = require('child_process');

const SERVER_PORT = 5006;

let mainWindow = null;
let serverProcess = null;

// Inline LIGHT splash shown instantly while the local server cold-starts, so the
// window is never a blank rectangle (first launch can take a while while Windows
// Defender scans node_modules on a cold cache).
const SPLASH_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(
  '<!doctype html><meta charset="utf-8"><style>' +
  'html,body{margin:0;height:100%;background:#101318;color:#e9ecf1;' +
  'font-family:Inter,Segoe UI,system-ui,sans-serif;display:flex;align-items:center;' +
  'justify-content:center;flex-direction:column;gap:16px}' +
  '.mark{width:56px;height:56px}' +
  '.b{font-size:26px;font-weight:800;letter-spacing:.06em;' +
  'background:linear-gradient(120deg,#14b8a6,#4ade80);-webkit-background-clip:text;' +
  '-webkit-text-fill-color:transparent}' +
  '.s{font-size:11px;letter-spacing:.2em;color:#616d7e;text-transform:uppercase}' +
  '.r{width:26px;height:26px;border:3px solid #29313f;border-top-color:#2dd4bf;' +
  'border-radius:50%;animation:s .8s linear infinite;margin-top:8px}' +
  '@keyframes s{to{transform:rotate(360deg)}}' +
  '</style>' +
  '<svg class="mark" viewBox="0 0 32 32" fill="none"><defs>' +
  '<linearGradient id="g" x1="4" y1="26" x2="28" y2="6" gradientUnits="userSpaceOnUse">' +
  '<stop stop-color="#14b8a6"/><stop offset="1" stop-color="#4ade80"/></linearGradient></defs>' +
  '<rect x="1" y="1" width="30" height="30" rx="8" fill="#0f1b19" stroke="url(#g)" stroke-opacity="0.35"/>' +
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
    backgroundColor: '#101318',
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
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' http://127.0.0.1:5006 http://localhost:5006; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none';"
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
  mainWindow.on('closed', () => { mainWindow = null; });

  // Open external links in the browser, not Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
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
    await killPort(SERVER_PORT);   // clear any stale MMM server (never NEXUS's :5005)
    createWindow();                // show the splash immediately
    startServer();
    await waitForServer();         // wait for the server to bind :5006
    loadApp();                     // swap splash -> real UI
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});

ipcMain.handle('get-app-version', () => app.getVersion());
