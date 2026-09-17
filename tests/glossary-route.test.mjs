// Route-level test: mounts the money router on an ephemeral Express server.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import routes from '../server/money/routes.js';

let server; let base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/money', routes);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/money`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('GET /glossary', () => {
  it('returns the full term list', async () => {
    const res = await fetch(`${base}/glossary`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.terms.length).toBeGreaterThan(40);
    expect(body.terms[0]).toHaveProperty('plain');
  });

  it('returns one definition for ?term= (case-insensitive)', async () => {
    const res = await fetch(`${base}/glossary?term=net%20worth`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.term).toBe('Net Worth');
    expect(body.definition).toMatch(/assets minus/i);
    expect(typeof body.more).toBe('string');
  });

  it('404s for an unknown term', async () => {
    const res = await fetch(`${base}/glossary?term=flux%20capacitor`);
    expect(res.status).toBe(404);
  });
});
