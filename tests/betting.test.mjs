// /api/betting — providers + routes. The non-negotiable properties under test:
//   1. With the feature off, nothing opens a socket (same guarantee as
//      tests/market.test.mjs proves for /api/market).
//   2. The Odds API key NEVER appears in a cacheKey, a cached URL, a response
//      body, or an error message.
//   3. Nothing here writes to the money ledger — the whole surface is GET.
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import path from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { createRequire } from 'node:module';
import { db } from '../server/db/connection.js';
import repo from '../server/db/repo.js';
import online from '../server/online/index.js';

const require = createRequire(import.meta.url);
const providers = require('../server/betting/providers.js');
const bettingRoutes = require('../server/betting/routes.js');
const keys = require('../server/online/keys.js');

const FAKE_KEY = 'test-odds-key-do-not-leak';

function setFeatures(partial) {
  repo.setSettings(db(), { online: partial });
}
function okResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const POLY = [{
  conditionId: 'c1', question: 'Will X happen?', outcomePrices: '["0.65","0.35"]',
  volume24hr: 125000, tags: [{ label: 'Politics' }], endDate: '2026-11-03T00:00:00Z', slug: 'will-x',
}];
const KALSHI = { markets: [{ ticker: 'KX-1', title: 'Fed cuts in December', yes_bid: 48, yes_ask: 52, volume: 9000, category: 'Economics', close_time: '2026-12-15T00:00:00Z' }] };
const MANIFOLD = [{ id: 'm1', question: 'Rain tomorrow?', outcomeType: 'BINARY', isResolved: false, probability: 0.42, volume24Hours: 300, groupSlugs: ['weather'], closeTime: 1800000000000, url: 'https://manifold.markets/x' }];

const ODDS_EVENTS = [{
  id: 'e1', sport_key: 'basketball_nba', home_team: 'Suns', away_team: 'Lakers', commence_time: '2026-10-01T02:00:00Z',
  bookmakers: [
    { key: 'a', title: 'Book A', last_update: '2026-09-30T00:00:00Z', markets: [{ key: 'h2h', outcomes: [{ name: 'Suns', price: -130 }, { name: 'Lakers', price: 115 }] }] },
    { key: 'b', title: 'Book B', last_update: '2026-09-30T00:00:00Z', markets: [{ key: 'h2h', outcomes: [{ name: 'Suns', price: 125 }, { name: 'Lakers', price: -140 }] }] },
  ],
}];

function routeFor(url) {
  const u = String(url);
  if (u.includes('gamma-api.polymarket.com')) return okResponse(POLY);
  if (u.includes('api.elections.kalshi.com')) return okResponse(KALSHI);
  if (u.includes('api.manifold.markets')) return okResponse(MANIFOLD);
  if (u.includes('the-odds-api.com/v4/sports?')) return okResponse([{ key: 'basketball_nba', title: 'NBA', group: 'Basketball', active: true }, { key: 'dead_league', title: 'Dead', group: 'X', active: false }]);
  if (u.includes('the-odds-api.com')) return okResponse(ODDS_EVENTS);
  return okResponse({});
}

// providers.js reaches the seam through Node's require, a separate module
// instance from this file's ESM import — reset the one it actually uses too,
// so a (host-scoped) cooldown from one test can't leak into the next.
const onlineRequired = require('../server/online/index.js');

beforeEach(() => {
  online._resetForTests();
  onlineRequired._resetForTests();
  keys.setKeys({});
  setFeatures(Object.fromEntries(online.FEATURES.map((f) => [f, false])));
});
afterEach(() => { vi.restoreAllMocks(); keys.setKeys({}); });

describe('providers — features off means zero sockets', () => {
  it('predictionMarkets() never calls fetch and returns an offline envelope', async () => {
    const spy = vi.spyOn(global, 'fetch');
    const out = await providers.predictionMarkets();
    expect(spy).not.toHaveBeenCalled();
    expect(out.offline).toBe(true);
    expect(out.markets).toEqual([]);
    expect(out.sources.map((s) => s.source)).toEqual(['polymarket', 'kalshi', 'manifold']);
  });

  it('sportsOdds()/sportsList()/arbitrage() never call fetch and never throw', async () => {
    keys.setKeys({ sportsOdds: FAKE_KEY });
    const spy = vi.spyOn(global, 'fetch');
    const [list, odds, arb] = await Promise.all([
      providers.sportsList(),
      providers.sportsOdds('basketball_nba'),
      providers.arbitrage(),
    ]);
    expect(spy).not.toHaveBeenCalled();
    expect(list.sports.length).toBeGreaterThan(0);   // falls back to DEFAULT_SPORTS
    expect(odds.events).toEqual([]);
    expect(arb.opportunities).toEqual([]);
  });

  it('sportsOdds() throws only for a missing sport argument (programmer error)', async () => {
    await expect(providers.sportsOdds('')).rejects.toThrow(/sport is required/);
  });
});

describe('providers — feature on, no key stored', () => {
  it('prediction markets still work (they are keyless)', async () => {
    setFeatures({ predictionMarkets: true });
    vi.spyOn(global, 'fetch').mockImplementation((url) => Promise.resolve(routeFor(url)));
    const out = await providers.predictionMarkets({ limit: 10 });
    expect(out.offline).toBe(false);
    expect(out.markets).toHaveLength(3);
    const kalshiRow = out.markets.find((m) => m.source === 'kalshi');
    // yes_bid/yes_ask are CENTS — 48/52 is a 50% market, not 5000%.
    expect(kalshiRow.probability.yes).toBeCloseTo(0.5, 10);
    expect(out.markets.find((m) => m.source === 'polymarket').probability.yes).toBeCloseTo(0.65, 10);
  });

  it('sports odds degrade to an offline envelope instead of a doomed request', async () => {
    setFeatures({ sportsOdds: true });
    const spy = vi.spyOn(global, 'fetch');
    const out = await providers.sportsOdds('basketball_nba');
    expect(spy).not.toHaveBeenCalled();
    expect(out.needsKey).toBe(true);
    expect(out.offline).toBe(true);
    expect(out.events).toEqual([]);
  });
});

describe('providers — feature on, key stored: the key must not leak', () => {
  beforeEach(() => {
    setFeatures({ sportsOdds: true, predictionMarkets: true });
    keys.setKeys({ sportsOdds: FAKE_KEY });
  });

  it('sends the key in the request URL but keeps it out of the cache row and the response', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => Promise.resolve(routeFor(url)));
    const out = await providers.sportsOdds('basketball_nba');
    expect(out.events).toHaveLength(1);

    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(FAKE_KEY);

    // Every persisted http_cache row: neither the key column nor the URL may
    // carry the secret (online.fetch strips the query string on write).
    const rows = repo.readAll(db()).http_cache;
    expect(rows.length).toBeGreaterThan(0); // never let this assert vacuously
    for (const row of rows) {
      expect(row.cache_key).not.toContain(FAKE_KEY);
      expect(String(row.url)).not.toContain(FAKE_KEY);
    }
  });

  it('sports-list filters to active sports', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => Promise.resolve(routeFor(url)));
    const out = await providers.sportsList();
    expect(out.sports).toEqual([{ key: 'basketball_nba', title: 'NBA', group: 'Basketball' }]);
    expect(out.fallback).toBe(false);
  });

  it('normalizeEvent computes best odds and a de-vigged consensus, never -Infinity', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => Promise.resolve(routeFor(url)));
    const { events } = await providers.sportsOdds('basketball_nba');
    const e = events[0];
    expect(e.bestOdds.home).toMatchObject({ odds: 125, book: 'Book B' });
    expect(e.bestOdds.away).toMatchObject({ odds: 115, book: 'Book A' });
    expect(e.consensus.home + e.consensus.away).toBeCloseTo(1, 10);
    expect(e.board).toHaveLength(2);
  });

  // A different sport key on purpose: online.fetch's cache is the real SQLite
  // http_cache, so reusing basketball_nba here would serve the row the test
  // above just wrote instead of this mock.
  it('a side no book quotes comes back null rather than -Infinity', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(okResponse([{
      ...ODDS_EVENTS[0],
      sport_key: 'icehockey_nhl',
      bookmakers: [{ key: 'a', title: 'Book A', markets: [{ key: 'h2h', outcomes: [{ name: 'Suns', price: -130 }] }] }],
    }])));
    const { events } = await providers.sportsOdds('icehockey_nhl');
    expect(events[0].bestOdds.away).toBeNull();
    expect(events[0].board).toEqual([]);
  });

  // A three-way (soccer) h2h has home/away/DRAW. Treating it as two-way makes
  // home+away imply ~75%, which reads as a ~35% risk-free arb that does not
  // exist — a draw loses the whole stake. Three-way books must not reach the
  // two-way board, consensus, or arbitrage scan.
  it('does not treat a three-way soccer market as two-way', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve(okResponse([{
      ...ODDS_EVENTS[0],
      id: 'evt-soccer',
      sport_key: 'soccer_epl',
      home_team: 'Arsenal',
      away_team: 'Chelsea',
      bookmakers: [
        { key: 'a', title: 'Book A', markets: [{ key: 'h2h', outcomes: [
          { name: 'Arsenal', price: 140 }, { name: 'Chelsea', price: 200 }, { name: 'Draw', price: 250 }] }] },
        { key: 'b', title: 'Book B', markets: [{ key: 'h2h', outcomes: [
          { name: 'Arsenal', price: 135 }, { name: 'Chelsea', price: 210 }, { name: 'Draw', price: 260 }] }] },
      ],
    }])));
    const { events } = await providers.sportsOdds('soccer_epl');
    const e = events[0];
    expect(e.threeWay).toBe(true);
    expect(e.board).toEqual([]);
    expect(e.consensus).toBeNull();
  });

  it('arbitrage finds the cross-book pair and sizes stakes to a matched payout', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url) => Promise.resolve(routeFor(url)));
    const out = await providers.arbitrage({ sports: ['basketball_nba'], totalStake: 1000 });
    expect(out.opportunities.length).toBeGreaterThan(0);
    const best = out.opportunities[0];
    expect(best.profitPct).toBeGreaterThan(0);
    expect(best.a.book).not.toBe(best.b.book);
    expect(best.a.stake + best.b.stake).toBeCloseTo(1000, 6);
    expect(best.a.team).toBeTruthy();
    expect(JSON.stringify(out)).not.toContain(FAKE_KEY);
  });
});

describe('routes: /api/betting', () => {
  let server; let base;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/betting', bettingRoutes);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/betting`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  function externalCalls(spy) {
    return spy.mock.calls.filter(([url]) => !String(url).startsWith(base));
  }

  it('all four GETs 200 with an offline shape and zero sockets when the features are off', async () => {
    const spy = vi.spyOn(global, 'fetch');
    for (const path of ['/prediction-markets', '/sports-list', '/sports-odds?sport=basketball_nba', '/arbitrage']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${base}${path}`);
      // eslint-disable-next-line no-await-in-loop
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.error).toBeUndefined();
    }
    expect(externalCalls(spy)).toHaveLength(0);
  });

  it('GET /sports-odds 400s without a sport', async () => {
    const res = await fetch(`${base}/sports-odds`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/sport is required/);
  });

  it('clamps limit and minProfit instead of trusting the query string', async () => {
    setFeatures({ predictionMarkets: true });
    vi.spyOn(global, 'fetch').mockImplementation((url) => (String(url).startsWith(base)
      ? Promise.reject(new Error('unreachable'))
      : Promise.resolve(routeFor(url))));
    vi.restoreAllMocks();
    const res = await fetch(`${base}/prediction-markets?limit=99999&sort=nonsense`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.markets)).toBe(true);
    expect(body.markets.length).toBeLessThanOrEqual(100);
  });

  it('exposes no write verbs — betting never touches the ledger', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${base}/prediction-markets`, { method });
      expect(res.status).toBe(404);
    }
  });
});

// The Betting section is unreachable from the build graph until the hub
// mounts it (MoneyHub.jsx is the controller's file, untouched here), so
// `vite build` never compiles these files and a typo would only surface as a
// blank tab after wiring. esbuild-parse each one and resolve every relative
// import by hand — cheaper and more deterministic than importing React,
// react-router and lucide into the test worker.
describe('Betting section components parse and resolve their imports', () => {
  const dir = 'src/components/money/sections/parts/betting';
  const files = () => {
    const names = readdirSync(dir).map((f) => `${dir}/${f}`);
    return ['src/components/money/sections/Betting.jsx', ...names];
  };

  it('every file parses as JSX', () => {
    for (const f of files()) {
      expect(() => transformSync(readFileSync(f, 'utf8'), { loader: 'jsx', sourcefile: f }), f).not.toThrow();
    }
  });

  it('every relative import points at a file that exists', () => {
    for (const f of files()) {
      const src = readFileSync(f, 'utf8');
      for (const [, spec] of src.matchAll(/from '(\.[^']+)'/g)) {
        const resolved = path.resolve(path.dirname(f), spec);
        const found = ['', '.js', '.jsx'].some((ext) => existsSync(resolved + ext));
        expect(found, `${f} → ${spec}`).toBe(true);
      }
      // lazy() sub-tab imports are dynamic, so they are matched separately.
      for (const [, spec] of src.matchAll(/import\('(\.[^']+)'\)/g)) {
        const resolved = path.resolve(path.dirname(f), spec);
        expect(['', '.js', '.jsx'].some((ext) => existsSync(resolved + ext)), `${f} → ${spec}`).toBe(true);
      }
    }
  });

  it('carries no hardcoded hex colours, no rgba(), and no cursor:pointer', () => {
    for (const f of files()) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, f).not.toMatch(/rgba?\(/);
      expect(src, f).not.toMatch(/cursor:\s*'?pointer/);
    }
  });
});
