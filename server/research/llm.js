'use strict';

// Step adapters: (transcript, toolSpecs, { timeoutMs }) -> { content, calls, raw? }.
// Local Ollama is the primary backend. Claude and OpenAI-compatible endpoints
// are opt-in cloud backends the user picks per question — never a silent
// fallback. Cloud calls go through online.fetch with store:false (replies never
// reach http_cache, so never an export/backup) and retries:0 (no double billing).

const crypto = require('crypto');
const ollama = require('../money/ollama');
const online = require('../online');
const keys = require('../online/keys');
const { jsonProtocolPrompt } = require('./persona');

const CLAUDE_DEFAULT_MODEL = 'claude-opus-5-5';
const CALL_TIMEOUT = 40000;

const parseArgs = (a) => {
  if (a && typeof a === 'object') return a;
  try { return JSON.parse(a); } catch { return {}; }
};

// ── Ollama (primary) ───────────────────────────────────────────────────────

const toOllama = (system, transcript) => [
  { role: 'system', content: system },
  ...transcript.map((m) => {
    if (m.role === 'assistant') {
      return { role: 'assistant', content: m.content || '', tool_calls: m.calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) };
    }
    if (m.role === 'tool') return { role: 'tool', content: m.content };
    return m;
  }),
];

function ollamaNativeStep(model, system) {
  return async (transcript, specs, { timeoutMs }) => {
    const msg = await ollama.chatMessage({
      model,
      messages: toOllama(system, transcript),
      timeoutMs: Math.min(timeoutMs, CALL_TIMEOUT),
      tools: specs.map((s) => ({ type: 'function', function: s })),
    });
    return {
      content: msg.content,
      calls: msg.tool_calls.map((c, i) => ({ id: `o${transcript.length}-${i}`, name: c.function.name, args: parseArgs(c.function.arguments) })),
    };
  };
}

// ReAct-style fallback for small models that can't emit native tool_calls
// reliably: one JSON object per turn, either a tool call or the answer.
function ollamaJsonStep(model, system) {
  return async (transcript, specs, { timeoutMs }) => {
    const sys = specs.length ? `${system}\n\n${jsonProtocolPrompt(specs)}` : `${system}\n\nReply with {"answer": "..."} only.`;
    const flat = transcript.map((m) => {
      if (m.role === 'assistant') return { role: 'assistant', content: JSON.stringify({ tool: m.calls[0].name, args: m.calls[0].args }) };
      if (m.role === 'tool') return { role: 'user', content: m.content };
      return m;
    });
    const msg = await ollama.chatMessage({
      model, messages: [{ role: 'system', content: sys }, ...flat], format: 'json', timeoutMs: Math.min(timeoutMs, CALL_TIMEOUT),
    });
    let j;
    try { j = JSON.parse(msg.content); } catch { j = { answer: msg.content }; }
    if (j && typeof j.tool === 'string') return { content: '', calls: [{ id: `j${transcript.length}`, name: j.tool, args: j.args || {} }] };
    return { content: j && typeof j.answer === 'string' ? j.answer : String(msg.content), calls: [] };
  };
}

// ── Cloud (opt-in, never automatic) ────────────────────────────────────────

async function cloudPost(feature, url, headers, body, timeoutMs) {
  const e = await online.fetch(url, {
    feature,
    method: 'POST',
    store: false,
    retries: 0,
    cacheKey: `${feature}:${crypto.randomUUID()}`,
    timeout: Math.min(timeoutMs, 45000),
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (e.offline || !e.data) throw new Error('cloud model unavailable');
  return e.data;
}

// Raw HTTP rather than @anthropic-ai/sdk: every outbound call in MMM must go
// through online.fetch (feature gate, cooldowns, no-cache), and the app adds
// no runtime dependencies for optional features.
function claudeStep(model, system) {
  return async (transcript, specs, { timeoutMs }) => {
    const messages = [];
    for (const m of transcript) {
      if (m.role === 'assistant') {
        // Echo Claude's own content back unchanged — thinking blocks included.
        messages.push({
          role: 'assistant',
          content: m.raw || [
            ...(m.content ? [{ type: 'text', text: m.content }] : []),
            ...m.calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} })),
          ],
        });
      } else if (m.role === 'tool') {
        // All results for one assistant turn go back in a single user message.
        const block = { type: 'tool_result', tool_use_id: m.id, content: m.content };
        const prev = messages[messages.length - 1];
        if (prev && prev.role === 'user' && Array.isArray(prev.content) && prev.content[0].type === 'tool_result') prev.content.push(block);
        else messages.push({ role: 'user', content: [block] });
      } else {
        messages.push({ role: 'user', content: m.content });
      }
    }
    const body = { model, max_tokens: 16000, system, messages, fallbacks: 'default' };
    if (specs.length) body.tools = specs.map((s) => ({ name: s.name, description: s.description, input_schema: s.parameters }));
    const data = await cloudPost('cloudLlm', 'https://api.anthropic.com/v1/messages', {
      'x-api-key': keys.getKey('cloudLlm') || '',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    }, body, timeoutMs);
    if (data.stop_reason === 'refusal') throw new Error('declined by the model');
    const blocks = data.content || [];
    return {
      content: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
      calls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input })),
      raw: blocks,
    };
  };
}

// One adapter for OpenAI, Groq, OpenRouter, Gemini's compatible endpoint, LM
// Studio… anything speaking /chat/completions with function tools.
function openaiStep({ baseUrl, model }, system) {
  return async (transcript, specs, { timeoutMs }) => {
    const messages = [{ role: 'system', content: system }, ...transcript.map((m) => {
      if (m.role === 'assistant') {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })),
        };
      }
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.id, content: m.content };
      return m;
    })];
    const body = { model, messages };
    if (specs.length) body.tools = specs.map((s) => ({ type: 'function', function: s }));
    const key = keys.getKey('openaiCompat');
    const data = await cloudPost('openaiCompat', `${baseUrl.replace(/\/+$/, '')}/chat/completions`, key ? { Authorization: `Bearer ${key}` } : {}, body, timeoutMs);
    const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
    return {
      content: msg.content || '',
      calls: (msg.tool_calls || []).map((c) => ({ id: c.id, name: c.function.name, args: parseArgs(c.function.arguments) })),
    };
  };
}

module.exports = { ollamaNativeStep, ollamaJsonStep, claudeStep, openaiStep, CLAUDE_DEFAULT_MODEL };
