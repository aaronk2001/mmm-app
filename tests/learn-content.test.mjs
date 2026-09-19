import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadLessons, getLessonById, loadSources, getSourceById, syncContent, sha256Hex,
} from '../server/learn/content.js';

const REAL_CONTENT_DIR = path.resolve(process.cwd(), 'content');

describe('learn/content — against the real content/learn tree (read-only)', () => {
  const lessons = loadLessons(REAL_CONTENT_DIR);

  it('loads all 15 real lessons with no parse errors', () => {
    expect(lessons).toHaveLength(15);
    for (const l of lessons) expect(l.parseError, `${l.id} had a parse error`).toBeUndefined();
  });

  it('every lesson has a unique id and a 64-hex-char content hash', () => {
    expect(new Set(lessons.map((l) => l.id)).size).toBe(15);
    for (const l of lessons) expect(l.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('every lesson has exactly 6 steps in the fixed order read/worked/faded/check/apply/reflect', () => {
    for (const l of lessons) {
      expect(l.steps.map((s) => s.type)).toEqual(['read', 'worked', 'faded', 'check', 'apply', 'reflect']);
    }
  });

  it('every check step parses a question, >=2 options, and a valid correct answer key', () => {
    for (const l of lessons) {
      const check = l.steps.find((s) => s.type === 'check');
      expect(check.parseError, `${l.id} check block failed to parse`).toBeUndefined();
      expect(check.question).toBeTruthy();
      expect(check.options.length).toBeGreaterThanOrEqual(2);
      expect(check.options.map((o) => o.key)).toContain(check.correctAnswer);
    }
  });

  it('every apply step carries the front-matter apply_action, restricted to the 6 shipped actions', () => {
    const ALLOWED = new Set(['create_goal', 'set_category_budget', 'add_recurring', 'enable_rollover', 'create_rule', 'export_backup']);
    for (const l of lessons) {
      const applyStep = l.steps.find((s) => s.type === 'apply');
      expect(ALLOWED.has(applyStep.action), `${l.id} uses a cut apply_action: ${applyStep.action}`).toBe(true);
    }
  });

  it('getLessonById finds a known lesson and returns null for an unknown one', () => {
    expect(getLessonById(lessons, 'm1-what-is-runway')).not.toBeNull();
    expect(getLessonById(lessons, 'nope')).toBeNull();
  });

  it('loads sources.yaml with the expected ids and no lesson cites an unlisted source', () => {
    const sources = loadSources(REAL_CONTENT_DIR);
    expect(sources.length).toBeGreaterThan(0);
    expect(getSourceById(sources, 'original-mmm')).toMatchObject({ allows_verbatim: true });
    expect(getSourceById(sources, 'not-a-real-source')).toBeNull();
    for (const l of lessons) {
      expect(getSourceById(sources, l.source_id), `${l.id} cites unknown source_id ${l.source_id}`).not.toBeNull();
    }
  });
});

describe('learn/content — synthetic fixtures (edge cases)', () => {
  function withTempContentDir(files, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmm-learn-content-'));
    fs.mkdirSync(path.join(dir, 'learn', 'm9-fixture'), { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, 'learn', 'm9-fixture', name), body);
    }
    try {
      return fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('returns an empty array when content/learn does not exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmm-learn-empty-'));
    try {
      expect(loadLessons(dir)).toEqual([]);
      expect(loadSources(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flags a lesson missing front-matter fences as a parse error instead of crashing', () => {
    withTempContentDir({ 'broken.md': 'no front matter here at all' }, (dir) => {
      const lessons = loadLessons(dir);
      expect(lessons).toHaveLength(1);
      expect(lessons[0].parseError).toBeTruthy();
    });
  });

  it('flags a malformed check block instead of crashing', () => {
    const body = [
      '---',
      'id: fixture-bad-check',
      'module: M9',
      'title: Fixture',
      'est_minutes: 1',
      'source_id: original-mmm',
      'license_note: "test"',
      'personalizes: []',
      'requires_data: false',
      'apply_action: export_backup',
      'gate: false',
      '---',
      '',
      'Intro text.',
      '',
      ':::check',
      'not a real question/answer block',
      ':::',
      '',
      ':::apply',
      'Apply text.',
      ':::',
    ].join('\n');
    withTempContentDir({ 'fixture-bad-check.md': body }, (dir) => {
      const [lesson] = loadLessons(dir);
      const check = lesson.steps.find((s) => s.type === 'check');
      expect(check.parseError).toBe(true);
    });
  });

  it('is content-hash idempotent: identical bytes hash identically, any edit changes the hash', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abc')).not.toBe(sha256Hex('abcd'));
  });
});

describe('learn/content — syncContent idempotency (fake repo, no real DB)', () => {
  // A minimal in-memory stand-in for repo.js's upsertLearnEvent, mirroring
  // its real idempotency contract: same data -> changed:false, no duplicate.
  function fakeRepo() {
    const events = new Map();
    return {
      events,
      upsertLearnEvent(_d, { reason, source_type, source_id, data }) {
        const key = `${reason}|${source_type}|${source_id}`;
        const prev = events.get(key);
        const same = prev && JSON.stringify(prev.data) === JSON.stringify(data);
        events.set(key, { data });
        return { changed: !same };
      },
    };
  }

  it('first sync marks every lesson changed; an identical re-sync marks none changed and adds no rows', () => {
    const repo = fakeRepo();
    const first = syncContent({ repo, d: {}, contentDir: REAL_CONTENT_DIR });
    expect(first.results.every((r) => r.changed)).toBe(true);
    const sizeAfterFirst = repo.events.size;

    const second = syncContent({ repo, d: {}, contentDir: REAL_CONTENT_DIR });
    expect(second.results.every((r) => !r.changed)).toBe(true);
    expect(repo.events.size).toBe(sizeAfterFirst); // no duplicates
  });
});
