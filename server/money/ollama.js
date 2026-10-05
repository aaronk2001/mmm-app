'use strict';

// Tiny Ollama client — no SDK, just fetch to the local daemon. The coach is the
// ONLY consumer and it degrades to rules-only whenever any of this fails, so
// every call is best-effort and short-timeout: a missing/unreachable Ollama
// must never block the app.

const HOST = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const DEFAULT_MODEL = 'qwen2.5:1.5b-instruct';

function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

// List installed model names (base tag, e.g. 'qwen2.5:1.5b-instruct'). [] on failure.
async function listModels() {
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

// Full assistant message, with optional native tools or JSON mode. Used by
// Research (server/research/llm.js); chat() above stays text-only for the coach.
async function chatMessage({ model, messages, tools, format, temperature = 0.2, timeoutMs = 40000 }) {
  const t = withTimeout(timeoutMs);
  try {
    const body = { model, messages, stream: false, options: { temperature } };
    if (tools && tools.length) body.tools = tools;
    if (format) body.format = format;
    const res = await fetch(`${HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: t.signal,
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const j = await res.json();
    return { content: (j.message && j.message.content) || '', tool_calls: (j.message && j.message.tool_calls) || [] };
  } finally {
    t.done();
  }
}

module.exports = { HOST, DEFAULT_MODEL, listModels, status, chat, chatMessage };
