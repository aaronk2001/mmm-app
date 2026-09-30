import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { localGuard } = require('../server/local-guard.js');

let server;
let port;

// fetch() forbids overriding Host and Sec-Fetch-*, so drive raw http.request.
function send(method, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: '/api/x', headers: { host: `127.0.0.1:${port}`, ...headers } },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); },
    );
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  const app = express();
  app.use(localGuard(['http://127.0.0.1:5006', 'http://localhost:5173']));
  app.all('/api/x', (req, res) => res.json({ ok: true }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('localGuard — DNS rebinding', () => {
  it('accepts loopback hostnames on any port', async () => {
    expect(await send('GET')).toBe(200);
    expect(await send('GET', { host: 'localhost:5006' })).toBe(200);
    expect(await send('GET', { host: '[::1]:5006' })).toBe(200);
  });

  it('rejects a foreign Host even for reads', async () => {
    expect(await send('GET', { host: 'evil.example:5006' })).toBe(403);
    expect(await send('GET', { host: '127.0.0.1.evil.example' })).toBe(403);
  });
});

describe('localGuard — cross-site writes', () => {
  it('allows writes from the app origin and from clients that send no Origin', async () => {
    expect(await send('POST', { origin: 'http://127.0.0.1:5006' })).toBe(200);
    expect(await send('POST', { origin: 'http://localhost:5173' })).toBe(200);
    expect(await send('POST')).toBe(200);
  });

  it('rejects a no-body POST from a foreign origin (the /reset attack)', async () => {
    expect(await send('POST', { origin: 'https://evil.example' })).toBe(403);
    expect(await send('DELETE', { origin: 'null' })).toBe(403);
  });

  it('rejects writes the browser labels cross-site', async () => {
    expect(await send('POST', { 'sec-fetch-site': 'cross-site' })).toBe(403);
  });

  it('leaves cross-origin reads to CORS', async () => {
    expect(await send('GET', { origin: 'https://evil.example' })).toBe(200);
  });
});
