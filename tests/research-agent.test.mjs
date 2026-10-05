// Research — the bounded tool loop and the LLM step adapters. Fake steps and
// stubbed fetch only; no Ollama, no network.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { db } from '../server/db/connection.js';
import repo from '../server/db/repo.js';

const require = createRequire(import.meta.url);
const { runResearch } = require('../server/research/agent.js');
const llm = require('../server/research/llm.js');
const keys = require('../server/online/keys.js');
// The same instance llm.js requires — an ESM import would get its own copy,
// whose cooldowns _resetForTests() would clear instead.
const online = require('../server/online/index.js');

const fin = {
  name: 'get_financials',
  description: 'd',
  parameters: { type: 'object', properties: { ticker: { type: 'string' } }, required: ['ticker'] },
  validate: (a) => { if (a.ticker !== 'MSFT') throw new Error('ticker must be a symbol like MSFT'); return { ticker: 'MSFT' }; },
  sources: [{
    label: 'Yahoo Finance fundamentals',
    ready: () => true,
    run: async () => ({ data: { growth: { free_cash_flow_yoy_pct: [null, 12.5] } }, cached_at: '2026-09-30T00:00:00Z', offline: false }),
  }],
};
const script = (...turns) => { let i = 0; return async () => turns[Math.min(i++, turns.length - 1)]; };
const call = (args) => ({ content: '', calls: [{ id: 'c1', name: 'get_financials', args }] });

describe('runResearch', () => {
  it('runs a tool then answers; trace and grounding filled', async () => {
    const out = await runResearch({ question: 'Is MSFT FCF growing?', tools: [fin], step: script(call({ ticker: 'MSFT' }), { content: 'Yes, FCF grew 12.5% [1].', calls: [] }) });
    expect(out.stopped).toBe('answer');
    expect(out.toolCalls).toEqual([{ n: 1, tool: 'get_financials', args: { ticker: 'MSFT' }, source: 'Yahoo Finance fundamentals', cached_at: '2026-09-30T00:00:00Z', offline: false }]);
    expect(out.grounded).toBe(true);
  });

  it('flags a number no tool returned', async () => {
    const out = await runResearch({ question: 'q', tools: [fin], step: script(call({ ticker: 'MSFT' }), { content: 'FCF grew 40% [1].', calls: [] }) });
    expect(out).toMatchObject({ grounded: false, ungrounded: ['40%'] });
  });

  it('caps at maxCalls then forces a final answer — with the tool specs still sent and final:true', async () => {
    let n = 0;
    let finalArgs = null;
    const step = async (_t, specs, opts) => {
      if (opts.final) { finalArgs = { specs, opts }; return { content: 'Done.', calls: [] }; }
      return call({ ticker: 'MSFT', i: n++ });
    };
    const out = await runResearch({ question: 'q', tools: [fin], step, maxCalls: 6 });
    expect(out.toolCalls).toHaveLength(6);
    expect(out).toMatchObject({ stopped: 'cap', answer: 'Done.' });
    // Cloud APIs reject a transcript holding tool_use/tool_result blocks without tool definitions.
    expect(finalArgs.specs.map((s) => s.name)).toEqual(['get_financials']);
  });

  it('every call id in a turn gets a tool message, even past the cap', async () => {
    let last = null;
    const three = { content: '', calls: ['a', 'b', 'c'].map((id, i) => ({ id, name: 'get_financials', args: { ticker: 'MSFT', i } })) };
    const step = async (t, _s, opts) => {
      if (opts.final) { last = t; return { content: 'Done.', calls: [] }; }
      return three;
    };
    const out = await runResearch({ question: 'q', tools: [fin], step, maxCalls: 2 });
    expect(out.toolCalls).toHaveLength(2);
    const toolMsgs = last.filter((m) => m.role === 'tool');
    expect(toolMsgs.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(toolMsgs[2].content).toMatch(/tool limit reached/);
  });

  it('a step that throws keeps the trace and reports the error', async () => {
    let i = 0;
    const step = async () => { if (i++ === 0) return call({ ticker: 'MSFT' }); throw new Error('cloud model unavailable'); };
    const out = await runResearch({ question: 'q', tools: [fin], step });
    expect(out).toMatchObject({ stopped: 'error', answer: null, error: 'cloud model unavailable' });
    expect(out.toolCalls).toHaveLength(1);
  });

  it('skips the forced final step when too little budget is left for it', async () => {
    let t = 0;
    let finalCalled = false;
    const step = async (_t, _s, opts) => { if (opts.final) finalCalled = true; t += 9000; return call({ ticker: 'MSFT', i: t }); };
    const out = await runResearch({ question: 'q', tools: [fin], step, maxCalls: 6, budgetMs: 58000, now: () => t });
    expect(finalCalled).toBe(false);
    expect(out.stopped).toBe('budget');
  });

  it('rejects invalid args and unknown tools, feeds errors back, counts toward cap', async () => {
    const seen = [];
    const inner = script(
      { content: '', calls: [{ id: 'a', name: 'get_financials', args: { ticker: 'Microsoft' } }] },
      { content: '', calls: [{ id: 'b', name: 'buy_stock', args: {} }] },
      { content: 'No data.', calls: [] },
    );
    const out = await runResearch({ question: 'q', tools: [fin], step: async (t, s, o) => { seen.push(t.at(-1)); return inner(t, s, o); } });
    expect(out.toolCalls.map((c) => c.error)).toEqual(['ticker must be a symbol like MSFT', 'unknown tool buy_stock']);
    expect(seen[2].content).toMatch(/unknown tool/);
  });

  it('stops at the budget without throwing', async () => {
    let t = 0;
    const out = await runResearch({ question: 'q', tools: [fin], budgetMs: 1000, now: () => (t += 600), step: async () => call({ ticker: 'MSFT' }) });
    expect(out).toMatchObject({ stopped: 'budget', answer: null });
  });

  it('an answer before any tool data gets one nudge to call a tool', async () => {
    const seen = [];
    const inner = script({ content: 'Yes, it is growing.', calls: [] }, call({ ticker: 'MSFT' }), { content: 'FCF grew 12.5% [1].', calls: [] });
    const out = await runResearch({ question: 'q', tools: [fin], step: async (t, s, o) => { seen.push(t.at(-1)); return inner(t, s, o); } });
    expect(seen[1].content).toMatch(/call one of the tools/i);
    expect(out).toMatchObject({ stopped: 'answer', answer: 'FCF grew 12.5% [1].', grounded: true, noData: false });
  });

  it('still no tool after the nudge → answer flagged noData, never grounded', async () => {
    const out = await runResearch({ question: 'q', tools: [fin], step: script({ content: 'Yes, it is growing.', calls: [] }) });
    expect(out).toMatchObject({ answer: 'Yes, it is growing.', grounded: false, noData: true });
  });

  it('keeps the adapter raw turn on the transcript (Claude thinking blocks must be echoed)', async () => {
    const seen = [];
    const raw = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 'c1', name: 'get_financials', input: { ticker: 'MSFT' } }];
    const inner = script({ ...call({ ticker: 'MSFT' }), raw }, { content: 'ok', calls: [] });
    await runResearch({ question: 'q', tools: [fin], step: async (t, s, o) => { seen.push([...t]); return inner(t, s, o); } });
    expect(seen[1].find((m) => m.role === 'assistant').raw).toEqual(raw);
  });

  it('grounds only against the part of a result the model saw', async () => {
    const big = { ...fin, sources: [{ label: 'Big', ready: () => true, run: async () => ({ data: { pad: 'x'.repeat(5000), late: 777.5 }, cached_at: null, offline: false }) }] };
    const out = await runResearch({ question: 'q', tools: [big], step: script(call({ ticker: 'MSFT' }), { content: 'It is 777.5 [1].', calls: [] }) });
    expect(out).toMatchObject({ grounded: false, ungrounded: ['777.5'] });
  });
});

const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
const specs = [{ name: 'get_financials', description: 'd', parameters: { type: 'object', properties: { ticker: { type: 'string' } }, required: ['ticker'] } }];
const u = [{ role: 'user', content: 'q' }];

describe('llm adapters', () => {
  beforeEach(() => { online._resetForTests(); keys.setKeys({}); repo.setSettings(db(), { online: { cloudLlm: false, openaiCompat: false } }); });
  afterEach(() => vi.restoreAllMocks());

  it('ollama native maps tool_calls (string args too)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(ok({ message: { content: '', tool_calls: [{ function: { name: 'get_financials', arguments: '{"ticker":"MSFT"}' } }] } }));
    expect((await llm.ollamaNativeStep('m', 's')(u, specs, { timeoutMs: 1000 })).calls[0]).toMatchObject({ name: 'get_financials', args: { ticker: 'MSFT' } });
  });

  it('ollama native drops malformed tool_calls entries', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(ok({ message: { content: '', tool_calls: [null, {}, { function: { arguments: '{}' } }, { function: { name: 'get_financials', arguments: '{}' } }] } }));
    expect((await llm.ollamaNativeStep('m', 's')(u, specs, { timeoutMs: 1000 })).calls.map((c) => c.name)).toEqual(['get_financials']);
  });

  it('cloud calls share one cooldown key: a 429 holds off the next call', async () => {
    repo.setSettings(db(), { online: { cloudLlm: true } });
    keys.setKeys({ cloudLlm: 'k' });
    const f = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 429 }));
    const step = llm.claudeStep('m', 's');
    await expect(step(u, specs, { timeoutMs: 1000 })).rejects.toThrow(/unavailable/);
    await expect(step(u, specs, { timeoutMs: 1000 })).rejects.toThrow(/unavailable/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('ollama json: tool, answer, junk', async () => {
    const f = vi.spyOn(global, 'fetch');
    f.mockResolvedValueOnce(ok({ message: { content: '{"tool":"get_financials","args":{"ticker":"MSFT"}}' } }));
    f.mockResolvedValueOnce(ok({ message: { content: '{"answer":"ok [1]"}' } }));
    f.mockResolvedValueOnce(ok({ message: { content: 'not json' } }));
    const step = llm.ollamaJsonStep('m', 's');
    expect((await step(u, specs, { timeoutMs: 1000 })).calls[0].name).toBe('get_financials');
    expect((await step(u, specs, { timeoutMs: 1000 })).content).toBe('ok [1]');
    expect((await step(u, specs, { timeoutMs: 1000 })).content).toBe('not json');
  });

  it.each([
    ['claude', () => llm.claudeStep('m', 's')],
    ['openai', () => llm.openaiStep({ baseUrl: 'https://api.example.com/v1', model: 'm' }, 's')],
  ])('%s off → throws, zero sockets', async (_n, make) => {
    const f = vi.spyOn(global, 'fetch');
    await expect(make()(u, specs, { timeoutMs: 1000 })).rejects.toThrow(/unavailable/);
    expect(f).not.toHaveBeenCalled();
  });

  it('claude on → one POST, key in header, fallbacks default, nothing cached', async () => {
    repo.setSettings(db(), { online: { cloudLlm: true } });
    keys.setKeys({ cloudLlm: 'sk-ant-secret' });
    const content = [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 't1', name: 'get_financials', input: { ticker: 'MSFT' } }];
    const f = vi.spyOn(global, 'fetch').mockResolvedValue(ok({ stop_reason: 'tool_use', content }));
    const r = await llm.claudeStep('claude-opus-5-5', 's')(u, specs, { timeoutMs: 1000 });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant-secret');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', system: 's' });
    expect(body.tools[0]).toEqual({ name: 'get_financials', description: 'd', input_schema: specs[0].parameters });
    expect(r.calls[0]).toEqual({ id: 't1', name: 'get_financials', args: { ticker: 'MSFT' } });
    expect(r.raw).toEqual(content);
    expect(JSON.stringify(db().prepare('SELECT * FROM http_cache').all())).not.toContain('sk-ant');
  });

  it('claude replays the raw assistant turn and batches tool_results into one user message', async () => {
    repo.setSettings(db(), { online: { cloudLlm: true } });
    keys.setKeys({ cloudLlm: 'k' });
    const raw = [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 'a', name: 'get_financials', input: {} }, { type: 'tool_use', id: 'b', name: 'get_financials', input: {} }];
    const f = vi.spyOn(global, 'fetch').mockResolvedValue(ok({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] }));
    const transcript = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', calls: [{ id: 'a', name: 'get_financials', args: {} }, { id: 'b', name: 'get_financials', args: {} }], raw },
      { role: 'tool', id: 'a', name: 'get_financials', n: 1, content: 'Result [1]: {}' },
      { role: 'tool', id: 'b', name: 'get_financials', n: 2, content: 'Result [2]: {}' },
    ];
    const r = await llm.claudeStep('m', 's')(transcript, specs, { timeoutMs: 1000 });
    const { messages } = JSON.parse(f.mock.calls[0][1].body);
    expect(messages[1]).toEqual({ role: 'assistant', content: raw });
    expect(messages[2].content.map((b) => b.tool_use_id)).toEqual(['a', 'b']);
    expect(messages).toHaveLength(3);
    expect(r).toMatchObject({ content: 'done', calls: [] });
  });

  it('final step: claude keeps tools but sets tool_choice none; openai likewise', async () => {
    repo.setSettings(db(), { online: { cloudLlm: true, openaiCompat: true } });
    keys.setKeys({ cloudLlm: 'k', openaiCompat: 'k' });
    const f = vi.spyOn(global, 'fetch').mockImplementation(async (url) => (String(url).includes('anthropic')
      ? ok({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] })
      : ok({ choices: [{ message: { content: 'done' } }] })));
    await llm.claudeStep('m', 's')(u, specs, { timeoutMs: 1000, final: true });
    await llm.openaiStep({ baseUrl: 'https://api.example.com/v1', model: 'm' }, 's')(u, specs, { timeoutMs: 1000, final: true });
    const claudeBody = JSON.parse(f.mock.calls[0][1].body);
    const openaiBody = JSON.parse(f.mock.calls[1][1].body);
    expect(claudeBody.tools).toHaveLength(1);
    expect(claudeBody.tool_choice).toEqual({ type: 'none' });
    expect(openaiBody.tools).toHaveLength(1);
    expect(openaiBody.tool_choice).toBe('none');
  });

  it('final step: ollama native sends no tools; ollama json asks for the answer only', async () => {
    const f = vi.spyOn(global, 'fetch').mockImplementation(async () => ok({ message: { content: '{"answer":"done"}' } }));
    await llm.ollamaNativeStep('m', 's')(u, specs, { timeoutMs: 1000, final: true });
    const r = await llm.ollamaJsonStep('m', 's')(u, specs, { timeoutMs: 1000, final: true });
    expect(JSON.parse(f.mock.calls[0][1].body).tools).toBeUndefined();
    const jsonSys = JSON.parse(f.mock.calls[1][1].body).messages[0].content;
    expect(jsonSys).toMatch(/answer.*only/i);
    expect(jsonSys).not.toContain('{"tool":');
    expect(r.content).toBe('done');
  });

  it('claude refusal → throws instead of answering', async () => {
    repo.setSettings(db(), { online: { cloudLlm: true } });
    keys.setKeys({ cloudLlm: 'k' });
    vi.spyOn(global, 'fetch').mockResolvedValue(ok({ stop_reason: 'refusal', content: [] }));
    await expect(llm.claudeStep('m', 's')(u, specs, { timeoutMs: 1000 })).rejects.toThrow(/declined/);
  });

  it('openai-compatible on → Bearer key, maps tool_calls', async () => {
    repo.setSettings(db(), { online: { openaiCompat: true } });
    keys.setKeys({ openaiCompat: 'sk-oa' });
    const f = vi.spyOn(global, 'fetch').mockResolvedValue(ok({ choices: [{ message: { content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'get_financials', arguments: '{"ticker":"MSFT"}' } }] } }] }));
    const r = await llm.openaiStep({ baseUrl: 'https://api.example.com/v1/', model: 'm' }, 's')(u, specs, { timeoutMs: 1000 });
    expect(f.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-oa');
    expect(r.calls[0]).toEqual({ id: 'x', name: 'get_financials', args: { ticker: 'MSFT' } });
  });
});
