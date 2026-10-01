// Research — the five tools the model sees, their input validation, feature
// gating, and ordered source fallback. Stubbed fetch / fake Yahoo SDK only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { db } from '../server/db/connection.js';
import repo from '../server/db/repo.js';
import online from '../server/online/index.js';

const require = createRequire(import.meta.url);
const tools = require('../server/research/tools.js');
const fd = require('../server/research/fd.js');
const providers = require('../server/market/providers.js');
const keys = require('../server/online/keys.js');

const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
const allOff = () => repo.setSettings(db(), { online: Object.fromEntries(online.FEATURES.map((f) => [f, false])) });
const chartJson = (price, prev) => ({
  chart: { result: [{ meta: { symbol: 'MSFT', regularMarketPrice: price, chartPreviousClose: prev, currency: 'USD', regularMarketTime: 1_790_000_000 }, timestamp: [], indicators: { quote: [{}] } }] },
});

beforeEach(() => { online._resetForTests(); allOff(); keys.setKeys({}); });
afterEach(() => { vi.restoreAllMocks(); providers._setYahooForTests(null); });

describe('validation & schema', () => {
  it('normalises and rejects tickers', () => {
    expect(tools.validateTicker(' msft ')).toBe('MSFT');
    expect(tools.validateTicker('BRK.B')).toBe('BRK.B');
    for (const bad of ['', 'Microsoft Corp', 'A'.repeat(11), 42, '$MSFT']) expect(() => tools.validateTicker(bad)).toThrow();
  });

  it('news days and exa num_results clamp; short exa query rejected', () => {
    expect(tools.getTool('get_company_news').validate({ ticker: 'msft', days: 99 })).toEqual({ ticker: 'MSFT', days: 30 });
    expect(tools.getTool('exa_search').validate({ query: 'msft margins', num_results: 50 })).toEqual({ query: 'msft margins', num_results: 5 });
    expect(() => tools.getTool('exa_search').validate({ query: 'x' })).toThrow();
  });

  it('exactly five tools, each schema well-formed', () => {
    expect(tools.TOOLS.map((t) => t.name)).toEqual(['get_quote', 'get_financials', 'get_key_metrics', 'get_company_news', 'exa_search']);
    for (const t of tools.TOOLS) {
      expect(t.parameters.type).toBe('object');
      for (const r of t.parameters.required) expect(t.parameters.properties[r]).toBeDefined();
    }
  });
});

describe('gating', () => {
  it('nothing available with every feature off', () => expect(tools.availableTools()).toEqual([]));

  it('market alone → quote + financials (Yahoo)', () => {
    repo.setSettings(db(), { online: { market: true } });
    expect(tools.availableTools().map((t) => t.name)).toEqual(['get_quote', 'get_financials']);
  });

  it('finnhub needs its key before its tools appear', () => {
    repo.setSettings(db(), { online: { finnhub: true } });
    expect(tools.availableTools()).toEqual([]);
    keys.setKeys({ finnhub: 'k' });
    expect(tools.availableTools().map((t) => t.name)).toEqual(['get_quote', 'get_key_metrics', 'get_company_news']);
  });

  it('features off → every source of every tool opens zero sockets', async () => {
    keys.setKeys({ finnhub: 'k', exa: 'k', financialDatasets: 'k' });
    const spy = vi.spyOn(global, 'fetch');
    for (const t of tools.TOOLS) {
      const args = t.name === 'exa_search' ? { query: 'msft cloud' } : { ticker: 'MSFT' };
      for (const s of t.sources) expect((await s.run(t.validate(args))).offline).toBe(true);
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('fallback', () => {
  it('get_quote: Finnhub rate-limited → Yahoo answers, source says Yahoo', async () => {
    repo.setSettings(db(), { online: { market: true, finnhub: true } });
    keys.setKeys({ finnhub: 'k' });
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => (String(url).includes('finnhub')
      ? new Response('slow down', { status: 429 })
      : ok(chartJson(400, 390))));
    const out = await tools.runTool(tools.getTool('get_quote'), { ticker: 'MSFT' });
    expect(out.source).toBe('Yahoo Finance quote');
    expect(out.data.price).toBe(400);
  });

  it('get_financials: FD off → Yahoo fundamentals', async () => {
    repo.setSettings(db(), { online: { market: true } });
    providers._setYahooForTests({ fundamentalsTimeSeries: async () => [{ date: new Date('2024-06-30T00:00:00Z'), annualFreeCashFlow: 7 }] });
    const out = await tools.runTool(tools.getTool('get_financials'), { ticker: 'MSFT' });
    expect(out.source).toBe('Yahoo Finance fundamentals');
    expect(out.data.years[0].free_cash_flow).toBe(7);
  });

  it('all sources offline → data null, offline true', async () => {
    repo.setSettings(db(), { online: { market: true } });
    providers._setYahooForTests({ fundamentalsTimeSeries: async () => { throw new Error('down'); } });
    expect(await tools.runTool(tools.getTool('get_financials'), { ticker: 'NOCACHE' })).toMatchObject({ data: null, offline: true });
  });
});

describe('providers', () => {
  it('exa POSTs to /search with the key in a header and trims results', async () => {
    repo.setSettings(db(), { online: { exa: true } });
    keys.setKeys({ exa: 'exa-secret' });
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(ok({ results: [{ title: 'T', url: 'https://x', text: 'body', publishedDate: '2026-01-02', extra: 1 }] }));
    const out = await tools.runTool(tools.getTool('exa_search'), { query: 'msft', num_results: 3 });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://api.exa.ai/search');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('exa-secret');
    expect(JSON.parse(init.body)).toEqual({ query: 'msft', numResults: 3, contents: { text: { maxCharacters: 800 } } });
    expect(out.data).toEqual([{ title: 'T', url: 'https://x', published: '2026-01-02', text: 'body' }]);
    expect(JSON.stringify(db().prepare('SELECT * FROM http_cache').all())).not.toContain('exa-secret');
  });

  it('FD annual merges income + cash-flow by report_period; key only in header', async () => {
    repo.setSettings(db(), { online: { financialDatasets: true } });
    keys.setKeys({ financialDatasets: 'fd-secret' });
    const spy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => (String(url).includes('income-statements')
      ? ok({ income_statements: [{ report_period: '2025-06-30', revenue: 250, net_income: 80 }] })
      : ok({ cash_flow_statements: [{ report_period: '2025-06-30', net_cash_flow_from_operations: 130, capital_expenditure: -40, free_cash_flow: 90 }] })));
    const out = await fd.annual('MSFT');
    expect(out.data).toEqual([{ fiscal_year_end: '2025-06-30', revenue: 250, net_income: 80, operating_cash_flow: 130, capex: -40, free_cash_flow: 90 }]);
    for (const [u, init] of spy.mock.calls) {
      expect(String(u)).not.toContain('fd-secret');
      expect(init.headers['X-API-KEY']).toBe('fd-secret');
    }
  });
});
