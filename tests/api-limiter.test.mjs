// Local reads skip the 120/min limiter (a tour of every section is ~80-100
// GETs, and the client has no 429 handling); writes and anything that can
// reach the network stay limited.
import { describe, it, expect } from 'vitest';
import { skipApiLimiter } from '../server/api-limiter.js';

const req = (method, path) => ({ method, path });

describe('skipApiLimiter', () => {
  it('skips local reads', () => {
    for (const p of ['/money/transactions', '/money/cashflow', '/learn/lessons', '/trading/trades', '/plan/take-home', '/backtest/runs']) {
      expect(skipApiLimiter(req('GET', p))).toBe(true);
    }
  });

  it('keeps limiting every write', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(skipApiLimiter(req(m, '/money/transactions'))).toBe(false);
    }
  });

  it('keeps limiting reads that can hit the network', () => {
    expect(skipApiLimiter(req('GET', '/market/quote/AAPL'))).toBe(false);
    expect(skipApiLimiter(req('GET', '/online/status'))).toBe(false);
    expect(skipApiLimiter(req('GET', '/betting/sports-odds'))).toBe(false);
    expect(skipApiLimiter(req('GET', '/news/market'))).toBe(false);
  });
});
