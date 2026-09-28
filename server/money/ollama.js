'use strict';

// Tiny Ollama client — no SDK, just fetch to the local daemon. The coach is the
// ONLY consumer and it degrades to rules-only whenever any of this fails, so
// every call is best-effort and short-timeout: a missing/unreachable Ollama
// must never block the app.
//
// WHERE it talks: OLLAMA_HOST, parsed the way Ollama itself parses it. That
// variable is Ollama's own — users set it (0.0.0.0 on Windows, to expose the
// daemon) and the server inherits it — and its documented forms are host,
// host:port, :port or a URL. Only a full URL used to work; every other form
// made fetch() throw "Failed to parse URL", which listModels() swallowed, so
// the coach just said "unavailable" while Ollama was running. 0.0.0.0 / ::
// are listen-anywhere addresses, not destinations: they mean this machine.
//
// And WHETHER it may: the coach prompt carries the user's net worth, named
// accounts with balances, debts with APRs. A host that isn't this machine is
// a cloud model in all but name, so it is refused unless the user turned on
// Settings → Online & Keys → Cloud LLM (`cloudLlm`) — local-first by default.

const os = require('os');

const DEFAULT_HOST = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen2.5:1.5b-instruct';

/**
 * Normalizes an OLLAMA_HOST value into a base URL (no trailing slash).
 * Mirrors Ollama's envconfig.Host(): no scheme → http + port 11434; an
 * explicit http:// or https:// scheme without a port → that scheme's
 * default port; a path prefix (a reverse proxy) is kept.
 */
function resolveOllamaHost(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return DEFAULT_HOST;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  if (!hasScheme) {
    if (s.startsWith(':')) s = `127.0.0.1${s}`;
    s = `http://${s}`;
  }
  let u;
  try { u = new URL(s); } catch { return DEFAULT_HOST; }
  let host = u.hostname;
  if (!host || host === '0.0.0.0') host = '127.0.0.1';
  if (host === '[::]') host = '[::1]';
  const port = u.port || (hasScheme ? '' : '11434');
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.protocol}//${host}${port ? `:${port}` : ''}${path}`;
}

/**
 * True when `base` points at this machine: a loopback name/address, or one
 * of this machine's own interface addresses. Anything else leaves the box.
 */
function isLocalHost(base) {
  let h;
  try { h = new URL(base).hostname.toLowerCase(); } catch { return false; }
  h = h.replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h)) return true;
  if (/^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(h)) return true; // ::ffff:127.x.x.x
  try {
    return Object.values(os.networkInterfaces()).flat().some((i) => i && String(i.address).toLowerCase() === h);
  } catch {
    return false;
  }
}

let HOST = resolveOllamaHost(process.env.OLLAMA_HOST);

function remoteAllowed() {
  if (isLocalHost(HOST)) return true;
  try {
    // Lazily required: only a non-local host needs the settings lookup.
    return require('../online').enabled('cloudLlm');
  } catch {
    return false;
  }
}
function remoteRefusal() {
  return `Ollama at ${HOST} is not on this computer. Turn on "Cloud LLM" in Settings → Online & Keys to let the coach send your figures there.`;
}

function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

// List installed model names (base tag, e.g. 'qwen2.5:1.5b-instruct'). [] on failure.
async function listModels() {
  if (!remoteAllowed()) return [];
  const t = withTimeout(1500);
  try {
    const res = await fetch(`${HOST}/api/tags`, { signal: t.signal });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.models || []).map((m) => m.name);
  } catch {
    return [];
  } finally {
    t.done();
  }
}

// Is the daemon up and does it have a usable model? Returns the resolved model.
async function status(preferred) {
  if (!remoteAllowed()) return { available: false, models: [], model: null, reason: remoteRefusal() };
  const models = await listModels();
  if (!models.length) return { available: false, models: [], model: null };
  const want = preferred || DEFAULT_MODEL;
  // Exact match, else a prefix match (qwen2.5:1.5b → qwen2.5:1.5b-instruct), else first.
  const model = models.includes(want)
    ? want
    : models.find((m) => m.startsWith(want) || want.startsWith(m)) || null;
  return { available: !!model, models, model };
}

// Non-streaming chat completion. Returns the assistant text, or throws.
async function chat({ model, messages, temperature = 0.4, timeoutMs = 40000 }) {
  if (!remoteAllowed()) throw new Error(remoteRefusal());
  const t = withTimeout(timeoutMs);
  try {
    const res = await fetch(`${HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false, options: { temperature } }),
      signal: t.signal,
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const j = await res.json();
    return (j.message && j.message.content ? j.message.content : '').trim();
  } finally {
    t.done();
  }
}

// Tests point the client at a given OLLAMA_HOST value without re-requiring.
function _setHostForTests(raw) { HOST = resolveOllamaHost(raw); }

module.exports = {
  get HOST() { return HOST; },
  DEFAULT_MODEL,
  resolveOllamaHost,
  isLocalHost,
  listModels,
  status,
  chat,
  _setHostForTests,
};
