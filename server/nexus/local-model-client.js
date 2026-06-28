'use strict';

// Local Ollama client for the desk. Reads per-role model assignment from
// local-model-benchmark output; uses Ollama structured `format` (JSON schema) with
// retry + regex fallback because small local models are unreliable at strict JSON.

const fs = require('fs');
const path = require('path');

const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const ASSIGNMENT = path.join(__dirname, 'local-model-assignment.json');

const DEFAULT_ROLES = {
  technical: 'qwen2.5:3b', sentiment: 'qwen2.5:3b', risk: 'qwen2.5:3b',
  fundamental: 'qwen3:4b', quant: 'qwen3:4b', bull: 'qwen3:4b', bear: 'qwen3:4b', pm: 'qwen3:4b',
  embed: 'nomic-embed-text', fallback: 'qwen2.5:3b',
};

let _roles = null;
function roles() {
  if (_roles) return _roles;
  try {
    _roles = { ...DEFAULT_ROLES, ...JSON.parse(fs.readFileSync(ASSIGNMENT, 'utf8')).roles };
  } catch {
    _roles = DEFAULT_ROLES;
  }
  return _roles;
}

function modelFor(role) {
  return process.env.DESK_MODEL || roles()[role] || roles().fallback;
}

function parseJson(content) {
  try { return JSON.parse(content); } catch { /* fall through */ }
  const m = content.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

// Last-resort extraction of a signal object from prose.
function extractSignal(raw) {
  const signal = (raw.match(/(bullish|bearish|neutral)/i) || [])[1]?.toLowerCase() || 'neutral';
  const confidence = parseInt((raw.match(/(\d{1,3})\s*%?/) || [])[1], 10);
  return { signal, confidence: Number.isFinite(confidence) ? Math.min(100, confidence) : 50, reasoning: raw.slice(0, 240) };
}

async function callLocalModel(role, { system, user, schema, temperature = 0.3, timeoutMs = 60000, model: modelOverride } = {}) {
  const model = modelOverride || modelFor(role);
  const t0 = Date.now();
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          format: schema || 'json',
          stream: false,
          options: { temperature, num_predict: 320, num_ctx: 4096 },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`ollama ${res.status}`);
      const data = await res.json();
      const raw = data.message?.content || '';
      const parsed = parseJson(raw);
      if (parsed) return { parsed, raw, model, latency_ms: Date.now() - t0, attempts: attempt };
      lastErr = new Error('unparseable JSON');
    } catch (e) {
      lastErr = e;
    }
  }
  return { parsed: null, raw: '', model, latency_ms: Date.now() - t0, error: String(lastErr && lastErr.message || lastErr) };
}

async function embed(text) {
  const res = await fetch(`${OLLAMA}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: roles().embed, prompt: text }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`embed ${res.status}`);
  return (await res.json()).embedding;
}

module.exports = { callLocalModel, modelFor, extractSignal, embed, roles };
