require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const compression = require('compression');
const path        = require('path');

const moneyRoutes = require('./money/routes');
const planRoutes = require('./tools/routes');
const settingsRoutes = require('./settings/routes');
const backupRoutes = require('./backup/routes');
const { startBackupScheduler } = require('./backup/scheduler');
const { checkpoint } = require('./db/connection');

const app  = express();
const PORT = process.env.PORT || 5006;

// ─── Security headers ─────────────────────────────────────────────────────────
// Electron loads from file:// / 127.0.0.1, so frameguard would block the window.
// Electron sets its own CSP via onHeadersReceived in electron.js.
app.use(helmet({ frameguard: false, contentSecurityPolicy: false }));

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Scoped to the Vite dev server and the Electron origin only.
const ORIGINS = (process.env.MMM_CORS_ORIGINS || 'http://localhost:5006,http://localhost:5173,http://127.0.0.1:5006,file://').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: ORIGINS }));

// ─── Compression ─────────────────────────────────────────────────────────────
app.use(compression());

// ─── Body parsing — 2 MB cap (settings + CSV/backup import) ───
app.use(express.json({ limit: '2mb' })); // larger for settings + CSV/backup import

// ─── Rate limiting ────────────────────────────────────────────────────────────
// General API limiter — 120 req/min is generous for a single-user app.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});
app.use('/api', apiLimiter);

// ─── Request timeout ─────────────────────────────────────────────────────────
// Hard-kill any request not finished within 30s — except local-LLM routes,
// which legitimately run longer (ollama.js allows 40s per call).
const REQUEST_TIMEOUT_MS = 30_000;
const TIMEOUT_EXEMPT = [/^\/api\/money\/coach/];
app.use((req, res, next) => {
  if (TIMEOUT_EXEMPT.some((re) => re.test(req.path))) return next();
  const timer = setTimeout(() => {
    if (!res.headersSent) res.status(503).json({ error: 'Request timed out.' });
  }, REQUEST_TIMEOUT_MS);
  res.on('finish', () => clearTimeout(timer));
  res.on('close',  () => clearTimeout(timer));
  next();
});

// ─── Static frontend ──────────────────────────────────────────────────────────
// `vite build src` emits to src/dist — serve that.
app.use(express.static(path.join(__dirname, '..', 'src', 'dist')));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/money/backups', backupRoutes);
app.use('/api/money', moneyRoutes);
app.use('/api/plan', planRoutes);
app.use('/api/settings', settingsRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const message = (status < 500 && err.message) ? err.message : 'Internal server error';
  if (status >= 500) console.error('[MMM error]', err);
  if (!res.headersSent) res.status(status).json({ error: message });
});

// ─── Crash guard ──────────────────────────────────────────────────────────────
// One bad request must never take down the whole local backend (single-user app).
process.on('uncaughtException', (err) =>
  console.error('[MMM] uncaughtException (kept alive):', (err && err.stack) || err));
process.on('unhandledRejection', (reason) =>
  console.error('[MMM] unhandledRejection (kept alive):', (reason && reason.stack) || reason));

// ─── Server startup ───────────────────────────────────────────────────────────
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`MMM server running on http://127.0.0.1:${PORT}`);
  startBackupScheduler();
  // Post any recurring items that came due while the app was closed — after
  // /api/health is answerable, so a large catch-up never delays first paint.
  setImmediate(() => {
    try {
      const { posted, truncated } = require('./money/store').postDueRecurring();
      if (posted) console.log(`[MMM] auto-posted ${posted} recurring transaction(s)`);
      if (truncated.length) console.warn(`[MMM] ${truncated.length} recurring item(s) still have periods due`);
    } catch (e) {
      console.error('[MMM] recurring auto-post failed:', e.message);
    }
  });
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Electron sends SIGTERM when quitting. Stop accepting connections, drain
// in-flight requests (up to 5s), then exit.
const DRAIN_TIMEOUT_MS = 5_000;
function shutdown(signal) {
  console.log(`[MMM] ${signal} received — shutting down gracefully`);
  checkpoint('TRUNCATE'); // merge the WAL into mmm.db before exit
  server.close((err) => {
    if (err) { console.error('[MMM] Error during server close:', err); process.exit(1); }
    console.log('[MMM] All connections closed — exiting');
    process.exit(0);
  });
  setTimeout(() => {
    console.warn('[MMM] Drain timeout exceeded — forcing exit');
    process.exit(1);
  }, DRAIN_TIMEOUT_MS).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
