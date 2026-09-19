'use strict';

// Express router for the Learn engine (Sprint D, Track 1). Same house style
// as server/tools/routes.js / server/money/routes.js: one try/catch per
// handler, 400 + {error} for bad input, 500 + {error: err.message} for
// anything unexpected. Unlike content.js/progress.js/apply.js, this module
// IS allowed to reach for the live db()/store — it's the orchestration edge,
// same role server/tools/routes.js already plays for planning.
//
// No UI ships in this track — these endpoints are the backend Track 3's UI
// will call in Wave 2.

const path = require('path');
const express = require('express');
const { db } = require('../db/connection');
const repo = require('../db/repo');
const store = require('../money/store');
const validators = require('../middleware/validators');
const backup = require('../backup/scheduler');
const content = require('./content');
const variables = require('./variables');
const template = require('./template');
const fsrs = require('./fsrs');
const progress = require('./progress');
const apply = require('./apply');

const CONTENT_DIR = path.join(__dirname, '..', '..', 'content');

const router = express.Router();

function currentVariables() {
  const data = store.readData();
  return variables.computeVariables({ ...data, recurring: store.detectRecurring(data.transactions, data.recurring) });
}

function findLesson(id) {
  return content.getLessonById(content.loadLessons(CONTENT_DIR), id);
}

// Renders every text field on a step against the live variable set. Check
// steps have `correctAnswer`/`rationale` stripped by the caller before a
// lesson-detail response goes out — this function alone doesn't decide
// whether they're safe to reveal.
function renderStep(step, vars) {
  const missing = [];
  const rendered = { ...step };

  if (typeof step.body === 'string') {
    const r = template.render(step.body, vars);
    rendered.body = r.html;
    missing.push(...r.missing);
  }
  if (step.type === 'check') {
    const q = template.render(step.question || '', vars);
    rendered.question = q.html;
    missing.push(...q.missing);
    rendered.options = (step.options || []).map((o) => {
      const r = template.render(o.text || '', vars);
      missing.push(...r.missing);
      return { key: o.key, text: r.html };
    });
    if (step.rationale) {
      const r = template.render(step.rationale, vars);
      rendered.rationale = r.html;
      missing.push(...r.missing);
    }
  }
  if (missing.length) rendered.missing = missing;
  return rendered;
}

// Strips the answer key and rationale from a check step so a lesson-detail
// response can never leak the correct answer before the user attempts it.
function withoutAnswerKey(step) {
  if (step.type !== 'check') return step;
  const { correctAnswer, rationale, raw, ...rest } = step;
  return rest;
}

function lessonSummary(lesson) {
  const p = repo.getLearnProgress(db(), lesson.id) || { status: 'not_started', score_pct: null, apply_action_done: false };
  return {
    id: lesson.id, module: lesson.module, title: lesson.title, est_minutes: lesson.est_minutes,
    gate: lesson.gate, apply_action: lesson.apply_action,
    status: p.status, score_pct: p.score_pct, apply_action_done: !!p.apply_action_done,
  };
}

function checkStepIndexes(lesson) {
  return lesson.steps.filter((s) => s.type === 'check').map((s) => s.index);
}

// ────────────────────────────────────────────────────────────────────────────
// Lessons
// ────────────────────────────────────────────────────────────────────────────

router.get('/lessons', (req, res) => {
  try {
    const lessons = content.loadLessons(CONTENT_DIR);
    res.json({ lessons: lessons.map(lessonSummary) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/lessons/:id', (req, res) => {
  try {
    const lesson = findLesson(req.params.id);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const vars = currentVariables();
    const stepRows = repo.getLearnStepProgress(db(), lesson.id);
    const byIndex = new Map(stepRows.map((r) => [r.step_index, r]));

    const steps = lesson.steps.map((step) => {
      const rendered = withoutAnswerKey(renderStep(step, vars));
      const stepProgress = byIndex.get(step.index);
      rendered.progress = stepProgress ? { status: stepProgress.status } : { status: 'pending' };
      return rendered;
    });

    // Additive fields for the UI (Wave 2): `personalizes` names which
    // variables this lesson's prose claims to be quoting back at the user;
    // `variables` is the same computed set that already drove renderStep()
    // above (no new computation), so the client can render Grade.jsx badges
    // and a "running on sample figures" banner truthfully, and pre-fill an
    // apply-action confirm from the user's own numbers.
    res.json({
      ...lessonSummary(lesson), source_id: lesson.source_id, license_note: lesson.license_note,
      requires_data: lesson.requires_data, personalizes: lesson.personalizes || [], variables: vars, steps,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/lessons/:id/start', (req, res) => {
  try {
    if (!findLesson(req.params.id)) return res.status(404).json({ error: 'Lesson not found' });
    res.json(progress.startLesson(db(), repo, req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Generic (non-check) step completion — worked/faded/apply/reflect steps.
router.post('/lessons/:id/steps/:stepIndex', (req, res) => {
  try {
    const lesson = findLesson(req.params.id);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    const stepIndex = Number(req.params.stepIndex);
    const status = req.body.status || 'skipped';
    if (!['correct', 'wrong', 'skipped'].includes(status)) return res.status(400).json({ error: 'status must be correct, wrong, or skipped' });

    const step = progress.recordStep(db(), repo, { lessonId: lesson.id, stepIndex, status, answer: req.body.answer || {} });
    const completed = progress.maybeCompleteLesson(db(), repo, { lessonId: lesson.id, totalSteps: lesson.steps.length, checkStepIndexes: checkStepIndexes(lesson) });
    res.json({ step, lessonProgress: completed || repo.getLearnProgress(db(), lesson.id) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Answers a lesson's ::check step. The correct answer is looked up from the
// lesson content server-side — never trust a client-supplied correctKey.
router.post('/lessons/:id/check', (req, res) => {
  try {
    const lesson = findLesson(req.params.id);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    const stepIndex = Number(req.body.stepIndex);
    const checkStep = lesson.steps.find((s) => s.index === stepIndex && s.type === 'check');
    if (!checkStep) return res.status(400).json({ error: 'stepIndex is not a check step for this lesson' });
    if (!req.body.selectedKey) return res.status(400).json({ error: 'selectedKey is required' });

    const { step, card, review } = progress.recordCheckAnswer(db(), repo, {
      lessonId: lesson.id, stepIndex, selectedKey: req.body.selectedKey, correctKey: checkStep.correctAnswer,
    });
    const completed = progress.maybeCompleteLesson(db(), repo, { lessonId: lesson.id, totalSteps: lesson.steps.length, checkStepIndexes: checkStepIndexes(lesson) });

    res.json({
      correct: step.status === 'correct',
      correctAnswer: checkStep.correctAnswer,
      rationale: checkStep.rationale,
      card, review,
      lessonProgress: completed || repo.getLearnProgress(db(), lesson.id),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Runs the lesson's declared apply_action with user-supplied params.
router.post('/lessons/:id/apply', (req, res) => {
  const lesson = findLesson(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  if (!lesson.apply_action) return res.status(400).json({ error: 'This lesson has no apply action' });

  apply.applyAction({
    repo, d: db(), store, validators, backup,
    lessonId: lesson.id, action: lesson.apply_action, params: req.body.params || {},
  }).then((applied) => {
    repo.upsertLearnProgress(db(), lesson.id, { apply_action_done: true });
    const applyStep = lesson.steps.find((s) => s.type === 'apply');
    if (applyStep) progress.recordStep(db(), repo, { lessonId: lesson.id, stepIndex: applyStep.index, status: 'correct' });
    const completed = progress.maybeCompleteLesson(db(), repo, { lessonId: lesson.id, totalSteps: lesson.steps.length, checkStepIndexes: checkStepIndexes(lesson) });
    res.json({ applied, lessonProgress: completed || repo.getLearnProgress(db(), lesson.id) });
  }).catch((err) => {
    const status = err.validationErrors ? 400 : 500;
    res.status(status).json({ error: err.message });
  });
});

router.post('/apply/:appliedActionId/undo', (req, res) => {
  apply.undoAction({ repo, d: db(), store, validators, backup, appliedActionId: req.params.appliedActionId })
    .then((r) => res.json(r))
    .catch((err) => res.status(err.message === 'Applied action not found' ? 404 : 400).json({ error: err.message }));
});

// ────────────────────────────────────────────────────────────────────────────
// Spaced-repetition review session
// ────────────────────────────────────────────────────────────────────────────

router.get('/review/session', (req, res) => {
  try {
    const dueCards = progress.getDueSessionCards(db(), repo);
    const lessons = content.loadLessons(CONTENT_DIR);
    const vars = currentVariables();

    const cards = dueCards.map((card) => {
      const lesson = content.getLessonById(lessons, card.lesson_id);
      const checkStep = lesson && lesson.steps.find((s) => s.index === card.step_index);
      const personalizes = lesson ? (lesson.personalizes || []) : [];
      return {
        id: card.id, lesson_id: card.lesson_id, lesson_title: lesson ? lesson.title : null, step_index: card.step_index, due: card.due,
        question: checkStep ? renderStep(checkStep, vars).question : null,
        options: checkStep ? renderStep(checkStep, vars).options : [],
        sample: personalizes.some((name) => vars[name] && vars[name].sample),
      };
    });
    res.json({ cards, endScreen: fsrs.endScreenSummary({ cardsReviewed: 0, correctCount: 0 }) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/review/:cardId/grade', (req, res) => {
  try {
    if (!req.body.answer) return res.status(400).json({ error: 'answer is required' });
    const result = progress.gradeReviewCard(db(), repo, { cardId: req.params.cardId, answer: req.body.answer });
    res.json(result);
  } catch (err) {
    res.status(err.message === 'Learn card not found' ? 404 : 400).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Streak / settings / content sync
// ────────────────────────────────────────────────────────────────────────────

router.get('/streak', (req, res) => {
  try { res.json(repo.getLearnStreak(db())); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/settings', (req, res) => {
  try { res.json(repo.getLearnSettings(db())); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/settings', (req, res) => {
  try { res.json(repo.setLearnSettings(db(), req.body || {})); } catch (err) { res.status(500).json({ error: err.message }); }
});

// Idempotent — safe to call on every server startup or on demand.
router.post('/sync', (req, res) => {
  try {
    const { results } = content.syncContent({ repo, d: db(), contentDir: CONTENT_DIR });
    res.json({ synced: results.length, changed: results.filter((r) => r.changed).length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
