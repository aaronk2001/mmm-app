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
  'html,body{margin:0;height:100%;background:#f6f7f9;color:#0b1220;' +
  'font-family:Inter,Segoe UI,system-ui,sans-serif;display:flex;align-items:center;' +
  'justify-content:center;flex-direction:column;gap:14px}' +
  '.b{font-size:30px;font-weight:800;letter-spacing:.12em;color:#0071e3}' +
  '.s{font-size:12px;letter-spacing:.18em;color:#475569;text-transform:uppercase}' +
  '.r{width:30px;height:30px;border:3px solid #e6e8ec;border-top-color:#0071e3;' +
  'border-radius:50%;animation:s .8s linear infinite;margin-top:6px}' +
  '@keyframes s{to{transform:rotate(360deg)}}' +
  '</style><div class="b">MMM</div><div class="s">Making Money Moves</div>' +
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
  serverProcess = fork(serverPath, [], {
    env: { ...process.env, PORT: SERVER_PORT },
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
    backgroundColor: '#f6f7f9',
    title: 'MMM',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Content Security Policy — scoped to MMM's own port plus the AI coach's
  // upstreams (local Ollama + Anthropic). Nothing else is reachable.
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' http://127.0.0.1:5006 http://localhost:5006 http://localhost:11434 https://api.anthropic.com; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none';"
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
