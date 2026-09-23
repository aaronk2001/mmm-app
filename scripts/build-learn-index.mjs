// Learn-content validation gate (Sprint D, Track 1). Pure, read-only,
// no DB access — it only ever READS content/learn/**/*.md through the same
// loader server/learn/content.js/routes.js use at runtime, so what this
// script sees is exactly what a real request would render. Never writes
// into content/ (that tree belongs to the concurrent content-authoring
// agent). Run: node scripts/build-learn-index.mjs (exit 1 on any failure).
//
// Catches, without ever executing a lesson through Express/SQLite:
//   - front-matter / :::check block parse failures
//   - a check step whose correctAnswer key isn't one of its own options
//   - apply_action values that don't name a real server/learn/apply.js action
//   - a source_id that doesn't resolve against content/learn/sources.yaml
//   - duplicate lesson ids
//   - {{variable}} / {{#section}} tags that don't resolve against the
//     "no real data yet" sample variable set (server/learn/variables.js) —
//     this is the same fallback set a brand-new user sees, so if a tag is
//     broken there it's broken for everyone, not just an edge case
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const content = require('../server/learn/content.js');
const template = require('../server/learn/template.js');
const variables = require('../server/learn/variables.js');
const { ACTION_NAMES } = require('../server/learn/apply.js');

export function buildLearnIndex(contentDir) {
  const lessons = content.loadLessons(contentDir);
  const sources = content.loadSources(contentDir);
  const vars = variables.computeVariables(); // no args -> every provider's declared sample fallback

  const seenIds = new Map();
  const issues = [];
  const index = [];

  for (const source of sources) {
    if (typeof source.license === 'string' && source.license.startsWith('CC ') && !source.license_url) {
      issues.push(`sources.yaml: ${source.id}: CC-licensed source is missing license_url`);
    }
  }

  for (const lesson of lessons) {
    const lessonIssues = [];

    if (lesson.parseError) lessonIssues.push(`front matter: ${lesson.parseError}`);
    if (seenIds.has(lesson.id)) lessonIssues.push(`duplicate lesson id (also in ${seenIds.get(lesson.id)})`);
    seenIds.set(lesson.id, lesson.file);

    if (lesson.apply_action && !ACTION_NAMES.includes(lesson.apply_action)) {
      lessonIssues.push(`apply_action "${lesson.apply_action}" is not a registered server/learn/apply.js action`);
    }
    if (lesson.source_id && !content.getSourceById(sources, lesson.source_id)) {
      lessonIssues.push(`source_id "${lesson.source_id}" not found in sources.yaml`);
    }

    for (const step of lesson.steps) {
      const where = `step ${step.index} (${step.type})`;

      if (step.type === 'check') {
        if (step.parseError) { lessonIssues.push(`${where}: could not parse :::check block`); continue; }
        const keys = step.options.map((o) => o.key);
        if (!keys.includes(step.correctAnswer)) {
          lessonIssues.push(`${where}: correctAnswer "${step.correctAnswer}" is not one of its own option keys [${keys.join(', ')}]`);
        }
        const q = template.render(step.question || '', vars);
        q.missing.forEach((tag) => lessonIssues.push(`${where} question: unresolved {{${tag}}}`));
        for (const opt of step.options) {
          const r = template.render(opt.text || '', vars);
          r.missing.forEach((tag) => lessonIssues.push(`${where} option ${opt.key}: unresolved {{${tag}}}`));
        }
        if (step.rationale) {
          const r = template.render(step.rationale, vars);
          r.missing.forEach((tag) => lessonIssues.push(`${where} rationale: unresolved {{${tag}}}`));
        }
      } else if (typeof step.body === 'string') {
        const r = template.render(step.body, vars);
        r.missing.forEach((tag) => lessonIssues.push(`${where}: unresolved {{${tag}}}`));
      }
    }

    index.push({ id: lesson.id, module: lesson.module, title: lesson.title, steps: lesson.steps.length, issues: lessonIssues });
    lessonIssues.forEach((msg) => issues.push(`${lesson.id}: ${msg}`));
  }

  return { lessons: index, issues, lessonCount: lessons.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'content');
  const { lessons, issues, lessonCount } = buildLearnIndex(contentDir);

  for (const l of lessons) {
    const flag = l.issues.length ? 'FAIL' : ' ok ';
    console.log(`${flag} ${String(l.module).padEnd(4)} ${l.id.padEnd(28)} ${l.steps} step(s)`);
    l.issues.forEach((msg) => console.log(`       - ${msg}`));
  }
  console.log(issues.length
    ? `\n${lessonCount} lesson(s) checked, ${issues.length} issue(s)`
    : `\n${lessonCount} lesson(s) checked, all clean`);
  process.exit(issues.length ? 1 : 0);
}
