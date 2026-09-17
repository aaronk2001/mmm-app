// Route-level test: mounts the money router on an ephemeral Express server.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from '../server/money/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Walk src/components/money and pull every <Term name="…"> / name={'…'} / name={"…"}.
function findTermNames() {
  const root = path.join(__dirname, '..', 'src', 'components', 'money');
  const names = new Set();
  const re = /<Term\s+name=(?:"([^"]*)"|'([^']*)'|\{'([^']*)'\}|\{"([^"]*)"\})/g;
  for (const file of fs.readdirSync(root, { recursive: true })) {
    if (!file.endsWith('.jsx')) continue;
    const contents = fs.readFileSync(path.join(root, file), 'utf8');
    let m;
    while ((m = re.exec(contents))) {
      names.add(m[1] ?? m[2] ?? m[3] ?? m[4]);
    }
  }
  return [...names];
}

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

  it('resolves every <Term name=…> call site in the app', async () => {
    const names = findTermNames();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const res = await fetch(`${base}/glossary?term=${encodeURIComponent(name)}`);
      expect(res.status, `"${name}" should resolve`).toBe(200);
    }
  });
});
