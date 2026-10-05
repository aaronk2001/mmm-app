// Research — Finnhub provider. Stubbed global.fetch only; no live network.
// Non-negotiables: feature off opens zero sockets, and the key travels in the
// X-Finnhub-Token header only — never a URL, a cache row or a response.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { db } from '../server/db/connection.js';
import repo from '../server/db/repo.js';
import online from '../server/online/index.js';

const require = createRequire(import.meta.url);
const fh = require('../server/research/finnhub.js');
const keys = require('../server/online/keys.js');

const KEY = 'fh-secret-do-not-leak';
const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
const on = () => { repo.setSettings(db(), { online: { finnhub: true } }); keys.setKeys({ finnhub: KEY }); };

beforeEach(() => { online._resetForTests(); keys.setKeys({}); repo.setSettings(db(), { online: { finnhub: false } }); });
afterEach(() => vi.restoreAllMocks());

describe('finnhub', () => {
  it('ready() needs both the feature and the key', () => {
    expect(fh.ready()).toBe(false);
    keys.setKeys({ finnhub: KEY });
    expect(fh.ready()).toBe(false);
    repo.setSettings(db(), { online: { finnhub: true } });
    expect(fh.ready()).toBe(true);
  });

  it('off → offline, zero sockets, for all three calls', async () => {
    keys.setKeys({ finnhub: KEY });
    const spy = vi.spyOn(global, 'fetch');
    for (const f of [fh.quote, fh.metrics, fh.news]) expect((await f('MSFT')).offline).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('quote maps fields; key only in header; never in cache', async () => {
    on();
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(ok({ c: 410.5, d: 2.5, dp: 0.6127, h: 412, l: 405, o: 406, pc: 408, t: 1_790_000_000 }));
    const out = await fh.quote('MSFT');
    expect(out.data).toMatchObject({ price: 410.5, change: 2.5, change_pct: 0.6127, open: 406, high: 412, low: 405, prev_close: 408 });
    expect(out.data.as_of).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://finnhub.io/api/v1/quote?symbol=MSFT');
    expect(init.headers['X-Finnhub-Token']).toBe(KEY);
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(JSON.stringify(db().prepare('SELECT * FROM http_cache').all())).not.toContain(KEY);
  });

  it('unknown symbol (c=0) → data null', async () => {
    on();
    vi.spyOn(global, 'fetch').mockResolvedValue(ok({ c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 }));
    expect((await fh.quote('ZZZZ')).data).toBeNull();
  });

  it('metrics whitelists fields and converts market cap from millions', async () => {
    on();
    vi.spyOn(global, 'fetch').mockResolvedValue(ok({ metric: { peTTM: 35.1, beta: 0.9, marketCapitalization: 3_050_000, junk: 1 } }));
    expect((await fh.metrics('MSFT')).data).toEqual({ pe_ttm: 35.1, beta: 0.9, market_cap_usd: 3_050_000_000_000 });
  });

  it('news trims to 5 items and 300-char summaries', async () => {
    on();
    const items = Array.from({ length: 8 }, (_, i) => ({ datetime: 1_790_000_000, headline: `h${i}`, source: 's', url: 'https://x', summary: 'y'.repeat(500) }));
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(ok(items));
    const out = await fh.news('MSFT');
    expect(out.data).toHaveLength(5);
    expect(out.data[0]).toMatchObject({ headline: 'h0', source: 's', url: 'https://x' });
    expect(out.data[0].summary).toHaveLength(300);
    expect(spy.mock.calls[0][0]).toMatch(/^https:\/\/finnhub\.io\/api\/v1\/company-news\?symbol=MSFT&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
  });
});
