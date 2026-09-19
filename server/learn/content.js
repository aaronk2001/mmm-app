'use strict';

// Loader for content/learn/**/*.md + content/learn/sources.yaml (Sprint D,
// Track 1). This module only LOADS and STRUCTURES lesson content — it never
// writes lesson prose (that's the concurrent content-authoring agent's job;
// this module never touches anything under content/) and it never renders a
// {{variable}} tag (that's server/learn/template.js, done per-request with
// live data, not baked in at load time).
//
// Front matter + body shape were confirmed against the 15 real lesson files
// authored under content/learn/{m0-orientation,m1-runway-survival,
// m2-cash-flow-steer}/*.md: YAML front matter between `---` fences, then a
// free-text intro ("read" step), then exactly five named blocks in a fixed
// order — :::worked :::faded :::check :::apply :::reflect — each closed by
// a bare `:::` line.
//
// No new dependency: front matter and sources.yaml are both simple enough
// (flat scalar key/value pairs, one small array, one bool) that a
// hand-rolled parser is safer and lighter than pulling in a YAML library.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// ── tiny front-matter parser (id/module/title/est_minutes/source_id/
// license_note/personalizes[]/requires_data/apply_action/gate/order?) ─────
function unquote(v) {
  const s = v.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"');
  }
  return s;
}
function coerceScalar(raw) {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !Number.isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((s) => unquote(s.trim()));
  }
  return unquote(v);
}
function parseFrontMatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw, parseError: 'missing --- front matter fences' };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    meta[kv[1]] = coerceScalar(kv[2]);
  }
  return { meta, body: m[2] };
}

// ── body -> ordered steps ───────────────────────────────────────────────
const BLOCK_RE = /:::([a-zA-Z]+)\r?\n([\s\S]*?)\r?\n:::[ \t]*(?=\r?\n|$)/g;

function parseCheckBlock(raw) {
  const qMatch = /\*\*Question:\*\*\s*(.+)/.exec(raw);
  const optionMatches = [...raw.matchAll(/^- ([A-Z])\.\s*(.+)$/gm)].map((m) => ({ key: m[1], text: m[2].trim() }));
  const ansMatch = /\*\*Correct answer:\*\*\s*([A-Z])\s*(?:—|-)?\s*(.*)$/m.exec(raw);
  if (!qMatch || !optionMatches.length || !ansMatch) {
    return { question: null, options: [], correctAnswer: null, rationale: null, raw, parseError: true };
  }
  return {
    question: qMatch[1].trim(),
    options: optionMatches,
    correctAnswer: ansMatch[1],
    rationale: ansMatch[2].trim() || null,
    raw,
  };
}

function parseBody(body, applyAction) {
  const steps = [];
  let firstBlockIndex = body.search(/:::[a-zA-Z]+\r?\n/);
  const intro = (firstBlockIndex === -1 ? body : body.slice(0, firstBlockIndex)).trim();
  if (intro) steps.push({ index: 0, type: 'read', body: intro });

  for (const m of body.matchAll(BLOCK_RE)) {
    const type = m[1];
    const raw = m[2];
    const step = { index: steps.length, type };
    if (type === 'check') {
      Object.assign(step, parseCheckBlock(raw));
    } else {
      step.body = raw;
      if (type === 'apply') step.action = applyAction || null;
    }
    steps.push(step);
  }
  return steps;
}

// ── one lesson file -> a lesson object ──────────────────────────────────
function parseLessonFile(absPath, raw) {
  const { meta, body, parseError } = parseFrontMatter(raw);
  const filename = path.basename(absPath, '.md');
  const lesson = {
    id: meta.id || filename,
    module: meta.module || null,
    title: meta.title || filename,
    est_minutes: typeof meta.est_minutes === 'number' ? meta.est_minutes : null,
    source_id: meta.source_id || null,
    license_note: meta.license_note || null,
    personalizes: Array.isArray(meta.personalizes) ? meta.personalizes : [],
    requires_data: !!meta.requires_data,
    apply_action: meta.apply_action || null,
    gate: !!meta.gate,
    order: typeof meta.order === 'number' ? meta.order : null,
    contentHash: sha256Hex(raw),
    file: absPath,
  };
  if (parseError) lesson.parseError = parseError;
  lesson.steps = parseBody(body, lesson.apply_action);
  return lesson;
}

// Deterministic ordering: an explicit `order:` front-matter field wins if
// present; otherwise module, then filename — a documented placeholder until
// the content agent adds real sequencing (loader-only concern; this module
// never invents or edits lesson content/order itself).
function sortLessons(lessons) {
  return [...lessons].sort((a, b) => {
    if (a.order != null && b.order != null && a.order !== b.order) return a.order - b.order;
    if (a.module !== b.module) return String(a.module).localeCompare(String(b.module));
    return a.id.localeCompare(b.id);
  });
}

function loadLessons(contentDir) {
  const dir = path.join(contentDir, 'learn');
  if (!fs.existsSync(dir)) return [];
  const lessons = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const moduleDir = path.join(dir, entry.name);
    for (const file of fs.readdirSync(moduleDir)) {
      if (!file.endsWith('.md')) continue;
      const abs = path.join(moduleDir, file);
      lessons.push(parseLessonFile(abs, fs.readFileSync(abs, 'utf8')));
    }
  }
  return sortLessons(lessons);
}

function getLessonById(lessons, id) {
  return lessons.find((l) => l.id === id) || null;
}

// ── sources.yaml (flat list-of-maps subset of YAML) ─────────────────────
function loadSources(contentDir) {
  const file = path.join(contentDir, 'learn', 'sources.yaml');
  if (!fs.existsSync(file)) return [];
  const sources = [];
  let current = null;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line === 'sources:') continue;
    const idMatch = /^-\s*id:\s*(.+)$/.exec(line);
    if (idMatch) {
      current = { id: unquote(idMatch[1]) };
      sources.push(current);
      continue;
    }
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (kv && current) {
      current[kv[1]] = coerceScalar(kv[2]);
    }
  }
  return sources;
}
function getSourceById(sources, id) {
  return sources.find((s) => s.id === id) || null;
}

// ── idempotent sync into learn_events (repo/db injected — this module
// stays DB-free/pure for its own loading logic; the caller owns the DB
// handle, same separation as server/learn/variables.js) ────────────────
// Re-running with unchanged lesson content is a true no-op: repo.
// upsertLearnEvent is itself idempotent on (reason, source_type, source_id)
// and only reports `changed` when the stored data (the content hash) is
// actually different, so a lesson is never duplicated by repeated syncs.
function syncContent({ repo, d, contentDir }) {
  const lessons = loadLessons(contentDir);
  const results = lessons.map((lesson) => {
    const { changed } = repo.upsertLearnEvent(d, {
      reason: 'content_sync',
      source_type: 'lesson',
      source_id: lesson.id,
      data: { hash: lesson.contentHash, module: lesson.module, title: lesson.title },
    });
    return { id: lesson.id, changed };
  });
  return { lessons, results };
}

module.exports = {
  loadLessons,
  getLessonById,
  loadSources,
  getSourceById,
  syncContent,
  sha256Hex,
  // exported for scripts/build-learn-index.mjs and tests
  parseLessonFile,
  parseFrontMatter,
  parseBody,
};
