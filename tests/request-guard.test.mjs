// The request guard in front of the local API: refuses DNS-rebound Host
// headers and cross-site writes (see server/request-guard.js). Raw
// http.request so Host/Origin/Sec-Fetch-Site can be forged the way an attack
// page's browser would send them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import guardModule from '../server/request-guard.js';

const { createRequestGuard } = guardModule;

let server; let port;

function request(method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (method !== 'GET') req.write('x=1');
    req.end();
  });
}

beforeAll(async () => {
  const app = express();
  // Port isn't known until listen(), so resolve the guard lazily.
  let guard = null;
  app.use((req, res, next) => guard(req, res, next));
  app.get('/api/thing', (_req, res) => res.json({ ok: true }));
  app.post('/api/money/reset', (_req, res) => res.json({ reset: true }));
  app.get('/index.html', (_req, res) => res.send('spa'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;
  guard = createRequestGuard({ port, origins: ['http://localhost:5173'] });
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const local = () => ({ Host: `127.0.0.1:${port}` });

describe('Host allowlist (DNS rebinding)', () => {
  it('serves 127.0.0.1, localhost and [::1] on our port', async () => {
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]) {
      expect((await request('GET', '/api/thing', { Host: host })).status).toBe(200);
    }
  });

  it('refuses a rebound hostname, even for reads and static files', async () => {
    const rebound = { Host: `rebind.attacker.example:${port}` };
    expect((await request('GET', '/api/thing', rebound)).status).toBe(421);
    expect((await request('GET', '/index.html', rebound)).status).toBe(421);
  });

  it('refuses our hostname on the wrong port', async () => {
    expect((await request('GET', '/api/thing', { Host: '127.0.0.1:1' })).status).toBe(421);
  });
});

describe('unsafe methods (CSRF)', () => {
  it('refuses a cross-site form post, which carries no custom header', async () => {
    const res = await request('POST', '/api/money/reset', {
      ...local(), Origin: 'https://evil.example', 'Content-Type': 'text/plain', 'Sec-Fetch-Site': 'cross-site',
    });
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('reset');
  });

  it('refuses a write without X-MMM-Client even with no Origin at all', async () => {
    expect((await request('POST', '/api/money/reset', local())).status).toBe(403);
  });

  it('refuses a foreign or opaque Origin even if the header is present', async () => {
    for (const origin of ['https://evil.example', 'null']) {
      const res = await request('POST', '/api/money/reset', { ...local(), Origin: origin, 'X-MMM-Client': '1' });
      expect(res.status).toBe(403);
    }
  });

  it('refuses Sec-Fetch-Site: cross-site even with the header', async () => {
    const res = await request('POST', '/api/money/reset', { ...local(), 'Sec-Fetch-Site': 'cross-site', 'X-MMM-Client': '1' });
    expect(res.status).toBe(403);
  });

  it('lets the app through: same-origin, the Vite dev origin, or no Origin', async () => {
    const ok = [
      { ...local(), 'X-MMM-Client': '1', Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' },
      { ...local(), 'X-MMM-Client': '1', Origin: 'http://localhost:5173' },
      { ...local(), 'X-MMM-Client': '1' },
    ];
    for (const headers of ok) {
      expect((await request('POST', '/api/money/reset', headers)).status).toBe(200);
    }
  });

  it('never gates reads on the header', async () => {
    expect((await request('GET', '/api/thing', { ...local(), Origin: 'https://evil.example' })).status).toBe(200);
  });
});
