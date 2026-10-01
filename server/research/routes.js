'use strict';

// /api/research — Linda, the grounded research agent. Local Ollama is the
// default backend; Claude / OpenAI-compatible run only when a request names
// them and they're enabled + configured. Never a silent switch to the cloud.
// Every "can't run" case answers 200 with { available: false, reason } so the
// UI renders an offline state, not an error.

const express = require('express');
const { db } = require('../db/connection');
const repo = require('../db/repo');
const online = require('../online');
const keys = require('../online/keys');
const ollama = require('../money/ollama');
const { availableTools, validateTicker } = require('./tools');
const { researchSystemPrompt } = require('./persona');
const { runResearch } = require('./agent');
const llm = require('./llm');

// From scripts/measure-research-tools.mjs, 2026-09-30, qwen2.5:1.5b-instruct:
// json 8/12 first call, 11/12 within one nudge; native 6/12, 9/12.
const OLLAMA_MODE = 'json';
const MAX_QUESTION = 500;
const BACKENDS = ['ollama', 'claude', 'openai'];
const LABELS = { ollama: 'Local (Ollama)', claude: 'Claude (cloud)', openai: 'OpenAI-compatible (cloud)' };
const OFFLINE = (reason, extra = {}) => ({ available: false, reason, answer: null, toolCalls: [], model: null, grounded: null, ...extra });

const router = express.Router();
const settings = () => repo.getSettings(db());
const coachModel = () => (settings().coach || {}).model || undefined;
const research = () => settings().research || {};

// https anywhere, or plain http only to this machine (LM Studio and friends).
function validBaseUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  } catch {
    return false;
  }
}

async function backend(id) {
  if (id === 'claude') {
    const model = research().claudeModel || llm.CLAUDE_DEFAULT_MODEL;
    return { available: online.enabled('cloudLlm') && keys.hasKey('cloudLlm'), model, step: (s) => llm.claudeStep(model, s) };
  }
  if (id === 'openai') {
    const { openaiBaseUrl: baseUrl, openaiModel: model } = research();
    return {
      available: online.enabled('openaiCompat') && validBaseUrl(baseUrl) && !!model,
      model: model || null,
      step: (s) => llm.openaiStep({ baseUrl, model }, s),
    };
  }
  const st = await ollama.status(coachModel());
  const make = OLLAMA_MODE === 'native' ? llm.ollamaNativeStep : llm.ollamaJsonStep;
  return { available: st.available, model: st.model, step: (s) => make(st.model, s) };
}

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

router.get('/status', async (_req, res) => {
  try {
    const tools = availableTools().map((t) => t.name);
    const backends = [];
    for (const id of BACKENDS) {
      // eslint-disable-next-line no-await-in-loop
      const b = await backend(id);
      backends.push({ id, label: LABELS[id], available: b.available, model: b.model });
    }
    res.json({ tools, backends, ready: tools.length > 0 && backends.some((b) => b.available) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ask', async (req, res) => {
  const b = req.body || {};
  const q = typeof b.question === 'string' ? b.question.trim() : '';
  if (!q || q.length > MAX_QUESTION) return res.status(400).json({ error: `question must be 1-${MAX_QUESTION} characters` });
  const id = b.backend === undefined ? 'ollama' : b.backend;
  if (!BACKENDS.includes(id)) return res.status(400).json({ error: 'unknown backend' });
  let ticker = null;
  if (b.ticker !== undefined && b.ticker !== '') {
    try { ticker = validateTicker(b.ticker); } catch (e) { return res.status(400).json({ error: e.message }); }
  }
  try {
    const tools = availableTools();
    if (!tools.length) return res.json(OFFLINE('tools-off'));
    const be = await backend(id);
    if (!be.available) return res.json(OFFLINE(id === 'ollama' ? 'no-model' : 'backend-off'));
    const step = be.step(researchSystemPrompt({ tools, today: todayLocal() }));
    const out = await runResearch({ question: ticker ? `[${ticker}] ${q}` : q, step, tools });
    res.json({ available: true, backend: id, model: be.model, ...out });
  } catch (err) {
    res.json(OFFLINE('error', { error: err.message }));
  }
});

module.exports = router;
