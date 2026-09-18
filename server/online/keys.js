'use strict';

const fs = require('fs');
const path = require('path');

// Decrypted API-key map — in-memory only, for this (server) process. This
// module never reads or writes keys.enc itself; only electron.js's main
// process touches safeStorage / the encrypted file on disk. The decrypted
// map reaches this module over the existing fork() IPC channel, so a key
// value never has to be written anywhere by this process.
let keys = {};

function setKeys(map) {
  keys = (map && typeof map === 'object') ? { ...map } : {};
}

function getKey(name) {
  return keys[name] || null;
}

function hasKey(name) {
  return !!keys[name];
}

// Presence booleans only — callers (routes, the Settings "Test" button) must
// never be able to read a key value back out of this module.
function presence() {
  const out = {};
  for (const k of Object.keys(keys)) out[k] = !!keys[k];
  return out;
}

if (typeof process.send === 'function') {
  // Forked by electron.js — the main process pushes the decrypted map here
  // once it has round-tripped it through safeStorage + keys.enc.
  process.on('message', (msg) => {
    if (msg && msg.type === 'secrets' && msg.keys && typeof msg.keys === 'object') setKeys(msg.keys);
  });
} else {
  // Not running under Electron (plain `node server/index.js`, or a test run).
  // Optional dev-only PLAINTEXT fallback so a lone-server dev loop can still
  // exercise online.fetch with a real key. Never used by the packaged app —
  // the packaged app is always fork()ed by electron.js, so process.send exists.
  const { DATA_DIR } = require('../db/connection');
  const devFile = path.join(DATA_DIR, 'secrets.dev.json');
  try {
    if (fs.existsSync(devFile)) {
      setKeys(JSON.parse(fs.readFileSync(devFile, 'utf8')));
      console.warn('[MMM online] loaded secrets.dev.json — DEV ONLY, keys are plaintext on disk. Never commit this file.');
    }
  } catch (e) {
    console.warn('[MMM online] secrets.dev.json unreadable:', e.message);
  }
}

module.exports = { setKeys, getKey, hasKey, presence };
