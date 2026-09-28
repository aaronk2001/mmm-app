// server/money/ollama.js — where the coach may send the user's figures.
// OLLAMA_HOST is Ollama's own variable and the server inherits it, so the
// client must (a) understand every form Ollama accepts, and (b) refuse a
// host that isn't this computer unless the user opted into Cloud LLM. No
// real network: global.fetch is stubbed in every behavioural case.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { db } from '../server/db/connection.js';
import repo from '../server/db/repo.js';

const require = createRequire(import.meta.url);
const ollama = require('../server/money/ollama.js');

function setCloudLlm(on) {
  repo.setSettings(db(), { online: { cloudLlm: on } });
}
function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => setCloudLlm(false));
afterEach(() => {
  vi.restoreAllMocks();
  ollama._setHostForTests(undefined);
  setCloudLlm(false);
});

describe('resolveOllamaHost — the forms Ollama itself accepts', () => {
  it.each([
    [undefined, 'http://127.0.0.1:11434'],
    ['', 'http://127.0.0.1:11434'],
    ['0.0.0.0', 'http://127.0.0.1:11434'],          // "listen everywhere" means this machine
    ['0.0.0.0:11434', 'http://127.0.0.1:11434'],
    ['127.0.0.1:11434', 'http://127.0.0.1:11434'],
    [':11500', 'http://127.0.0.1:11500'],
    ['[::]:11434', 'http://[::1]:11434'],
    ['gpu-box', 'http://gpu-box:11434'],             // no scheme -> Ollama's port
    ['http://gpu-box.lan:11434/', 'http://gpu-box.lan:11434'],
    ['https://ollama.example.com', 'https://ollama.example.com'], // explicit scheme -> its default port
    ['https://proxy.example.com/ollama/', 'https://proxy.example.com/ollama'],
  ])('%s -> %s', (raw, expected) => {
    expect(ollama.resolveOllamaHost(raw)).toBe(expected);
  });
});

describe('isLocalHost', () => {
  it('accepts loopback names and addresses', () => {
    for (const h of ['http://127.0.0.1:11434', 'http://localhost:11434', 'http://[::1]:11434', 'http://127.1.2.3:9']) {
      expect(ollama.isLocalHost(h)).toBe(true);
    }
  });
  it('rejects anything that leaves the machine', () => {
    for (const h of ['http://gpu-box.example.net:11434', 'http://203.0.113.5:11434', 'https://ollama.example.com']) {
      expect(ollama.isLocalHost(h)).toBe(false);
    }
  });
});

describe('the coach never sends figures off this computer without Cloud LLM', () => {
  it('a remote OLLAMA_HOST is refused while cloudLlm is off — no request at all', async () => {
    ollama._setHostForTests('http://gpu-box.example.net:11434');
    const spy = vi.spyOn(global, 'fetch');
    const st = await ollama.status();
    expect(st.available).toBe(false);
    expect(st.reason).toMatch(/Cloud LLM/);
    await expect(ollama.chat({ model: 'm', messages: [{ role: 'system', content: 'Net worth: $412,000' }] }))
      .rejects.toThrow(/Cloud LLM/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('with cloudLlm on, the remote host is used', async () => {
    setCloudLlm(true);
    ollama._setHostForTests('http://gpu-box.example.net:11434');
    const spy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => (
      String(url).endsWith('/api/tags') ? json({ models: [{ name: 'qwen2.5:1.5b-instruct' }] }) : json({ message: { content: ' hi ' } })
    ));
    const st = await ollama.status();
    expect(st).toMatchObject({ available: true, model: 'qwen2.5:1.5b-instruct' });
    expect(await ollama.chat({ model: st.model, messages: [] })).toBe('hi');
    expect(spy.mock.calls.map(([u]) => String(u))).toEqual([
      'http://gpu-box.example.net:11434/api/tags',
      'http://gpu-box.example.net:11434/api/chat',
    ]);
  });

  it('OLLAMA_HOST=0.0.0.0:11434 (Ollama\'s "expose me" setting) reaches the local daemon', async () => {
    ollama._setHostForTests('0.0.0.0:11434');
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(json({ models: [{ name: 'qwen2.5:1.5b-instruct' }] }));
    const st = await ollama.status();
    expect(st.available).toBe(true); // used to fail URL parsing and report "unavailable"
    expect(String(spy.mock.calls[0][0])).toBe('http://127.0.0.1:11434/api/tags');
  });
});
