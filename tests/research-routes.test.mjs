// /api/research — offline shapes, input clamps, explicit backend choice (no
// silent cloud fallback), and the happy path on a stubbed local Ollama.
// global.fetch is stubbed: requests to this test server pass through, the
// Ollama host gets canned replies, and anything else is recorded as outbound.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createRequire } from 'node:module';
import { db } from '../server/db/connection.js';
import repo from '../server/db/repo.js';
import online from '../server/online/index.js';

const require = createRequire(import.meta.url);
const routes = require('../server/research/routes.js');
const providers = require('../server/market/providers.js');
const keys = require('../server/online/keys.js');

const realFetch = global.fetch.bind(globalThis);
const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
let server; let base; let outbound; let ollamaReplies; let ollamaUp;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/research', routes);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/research`;
});
afterAll(() => new Promise((r) => server.close(r)));

beforeEach(() => {
  online._resetForTests();
  keys.setKeys({});
  outbound = [];
  ollamaUp = true;
  ollamaReplies = [{ message: { content: '{"answer":"No data."}' } }];
  repo.setSettings(db(), {
    online: Object.fromEntries(online.FEATURES.map((f) => [f, false])),
    coach: { model: 'qwen2.5:1.5b-instruct' },
    research: { openaiBaseUrl: '', openaiModel: '' },
  });
  vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
    const u = String(url);
    if (u.startsWith(base)) return realFetch(url, init);
    if (u.includes(':11434')) {
      if (!ollamaUp) throw new Error('ECONNREFUSED');
      if (u.endsWith('/api/tags')) return ok({ models: [{ name: 'qwen2.5:1.5b-instruct' }] });
      return ok(ollamaReplies.length > 1 ? ollamaReplies.shift() : ollamaReplies[0]);
    }
    outbound.push(u);
    return ok({});
  });
});
afterEach(() => { vi.restoreAllMocks(); providers._setYahooForTests(null); });

const ask = (b) => fetch(`${base}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const yahooFcf = () => providers._setYahooForTests({ fundamentalsTimeSeries: async () => [{ date: new Date('2024-06-30T00:00:00Z'), freeCashFlow: 70 }] });

describe('/api/research', () => {
  it('features off → tools-off, zero outbound', async () => {
    const r = await ask({ question: 'Is MSFT FCF growing?' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ available: false, reason: 'tools-off', answer: null, toolCalls: [], model: null, grounded: null });
    expect(outbound).toEqual([]);
  });

  it('Ollama down → no-model, with no cloud fallback even when Claude is configured', async () => {
    repo.setSettings(db(), { online: { market: true, cloudLlm: true } });
    keys.setKeys({ cloudLlm: 'k' });
    ollamaUp = false;
    expect((await (await ask({ question: 'q?' })).json()).reason).toBe('no-model');
    expect(outbound).toEqual([]);
  });

  it('configured Ollama model missing → no-model', async () => {
    repo.setSettings(db(), { online: { market: true }, coach: { model: 'llama3:70b' } });
    expect((await (await ask({ question: 'q?' })).json()).reason).toBe('no-model');
  });

  it.each(['claude', 'openai'])('backend %s chosen but off → backend-off, zero outbound', async (b) => {
    repo.setSettings(db(), { online: { market: true } });
    expect((await (await ask({ question: 'q?', backend: b })).json()).reason).toBe('backend-off');
    expect(outbound).toEqual([]);
  });

  it('openai with a plain-http non-loopback base URL → backend-off', async () => {
    repo.setSettings(db(), { online: { market: true, openaiCompat: true }, research: { openaiBaseUrl: 'http://evil.example.com/v1', openaiModel: 'm' } });
    expect((await (await ask({ question: 'q?', backend: 'openai' })).json()).reason).toBe('backend-off');
  });

  it.each([
    [{}], [{ question: '   ' }], [{ question: 'x'.repeat(501) }], [{ question: 'ok?', ticker: 'not a ticker' }], [{ question: 'ok?', backend: 'gpt' }],
  ])('400 on %j', async (b) => {
    expect((await ask(b)).status).toBe(400);
  });

  it('happy path on Ollama; call cap holds', async () => {
    repo.setSettings(db(), { online: { market: true } });
    yahooFcf();
    ollamaReplies = [{ message: { content: '{"tool":"get_financials","args":{"ticker":"MSFT"}}' } }];
    const body = await (await ask({ question: 'Is MSFT FCF growing?' })).json();
    expect(body).toMatchObject({ available: true, backend: 'ollama', model: 'qwen2.5:1.5b-instruct' });
    expect(body.toolCalls.length).toBeLessThanOrEqual(6);
    expect(body.toolCalls[0]).toMatchObject({ tool: 'get_financials', source: 'Yahoo Finance fundamentals' });
  });

  it('flags an answer figure no tool returned', async () => {
    repo.setSettings(db(), { online: { market: true } });
    yahooFcf();
    ollamaReplies = [
      { message: { content: '{"tool":"get_financials","args":{"ticker":"MSFT"}}' } },
      { message: { content: '{"answer":"FCF is $99B [1]."}' } },
    ];
    const body = await (await ask({ question: 'Is MSFT FCF growing?' })).json();
    expect(body).toMatchObject({ grounded: false, ungrounded: ['$99B'], noData: false });
  });

  it('a failing cloud call is reported as that backend failing, with the trace kept', async () => {
    repo.setSettings(db(), { online: { market: true, cloudLlm: true } });
    keys.setKeys({ cloudLlm: 'bad-key' });
    global.fetch.mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.startsWith(base)) return realFetch(url, init);
      outbound.push(u);
      return new Response('{"error":"invalid x-api-key"}', { status: 401 });
    });
    const body = await (await ask({ question: 'q?', backend: 'claude' })).json();
    expect(body).toMatchObject({ available: true, backend: 'claude', stopped: 'error', error: 'cloud model unavailable', answer: null, toolCalls: [] });
    expect(JSON.stringify(body)).not.toContain('bad-key');
    expect(outbound).toEqual(['https://api.anthropic.com/v1/messages']);
  });

  it('status lists tools and backends honestly', async () => {
    repo.setSettings(db(), { online: { market: true } });
    const s = await (await fetch(`${base}/status`)).json();
    expect(s.tools).toEqual(['get_quote', 'get_financials']);
    expect(s.backends.map((b) => [b.id, b.available])).toEqual([['ollama', true], ['claude', false], ['openai', false]]);
    expect(s.ready).toBe(true);
  });
});
