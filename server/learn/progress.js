'use strict';

// Lesson-runner backend + spaced-repetition orchestration for the Learn
// engine (Sprint D, Track 1). This module owns:
//   - streak bookkeeping (one bump per local calendar day of activity)
//   - lesson/step progress state transitions (not_started -> in_progress ->
//     completed)
//   - the "a check step answered Wrong/Hard creates an FSRS card" rule
//   - grading an existing card in a separate spaced-repetition review session
//   - assembling a due-card session (repo.getDueLearnCards + fsrs session
//     sizing)
//   - lesson-completion detection + score_pct computation
//
// Dependency injection, not require('../db/connection'): every function here
// takes `repo` (server/db/repo.js — safe to call directly, it never opens a
// connection itself) and `d` (whatever DB handle the caller owns) as
// explicit parameters. This keeps the module testable against fakes and
// avoids ever auto-connecting to the real dev DB, mirroring the same
// separation already used by server/learn/content.js's syncContent().
//
// Dates: streak/day-key logic uses local YYYY-MM-DD strings (never
// toISOString(), never new Date('YYYY-MM-DD')) via the same ymdLocal/
// addDaysLocal helpers already established in server/learn/variables.js.
// FSRS card/review timestamps are separately handled as full ISO instants
// inside server/learn/fsrs.js — that is a different, already-documented
// concern (see fsrs.js's file header).

const fsrs = require('./fsrs');

function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysLocal(d, days) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

// ── streak ──────────────────────────────────────────────────────────────
function recordStreakActivity(d, repo, { now = new Date() } = {}) {
  const today = ymdLocal(now);
  const streak = repo.getLearnStreak(d);
  if (streak.last_active_date === today) return streak; // already counted today

  const yesterday = ymdLocal(addDaysLocal(now, -1));
  const current = streak.last_active_date === yesterday ? (streak.current_streak || 0) + 1 : 1;
  const longest = Math.max(streak.longest_streak || 0, current);
  return repo.setLearnStreak(d, { current_streak: current, longest_streak: longest, last_active_date: today });
}

// ── lesson/step progress ───────────────────────────────────────────────
function startLesson(d, repo, lessonId, { now = new Date() } = {}) {
  const existing = repo.getLearnProgress(d, lessonId);
  if (existing && existing.status !== 'not_started') return existing;
  return repo.upsertLearnProgress(d, lessonId, { status: 'in_progress', started_at: now.toISOString() });
}

function recordStep(d, repo, { lessonId, stepIndex, status, answer = {} }, { now = new Date() } = {}) {
  startLesson(d, repo, lessonId, { now });
  const step = repo.upsertLearnStepProgress(d, lessonId, stepIndex, { status, answer });
  recordStreakActivity(d, repo, { now });
  return step;
}

// ── in-lesson check-answer recording (creates a card on Wrong/Hard) ─────
function recordCheckAnswer(d, repo, { lessonId, stepIndex, selectedKey, correctKey, retention = fsrs.RETENTION.core }, { now = new Date() } = {}) {
  const status = selectedKey === correctKey ? 'correct' : 'wrong';
  const step = recordStep(d, repo, { lessonId, stepIndex, status, answer: { selectedKey, correctKey } }, { now });

  if (status !== 'wrong') return { step, card: null, review: null };

  const existing = repo.getLearnCardByStep(d, lessonId, stepIndex);
  const graded = fsrs.gradeCard(existing, fsrs.Rating.Again, { retention, now });
  const card = repo.upsertLearnCard(d, { lesson_id: lessonId, step_index: stepIndex, ...graded.card });
  const review = repo.appendLearnReview(d, { card_id: card.id, ...graded.review });
  return { step, card, review };
}

// ── spaced-repetition review session (separate flow, existing cards) ────
function gradeReviewCard(d, repo, { cardId, answer, retention = fsrs.RETENTION.core }, { now = new Date() } = {}) {
  const existing = repo.getLearnCard(d, cardId);
  if (!existing) throw new Error('Learn card not found');
  const rating = fsrs.ratingFromAnswer(answer);
  const graded = fsrs.gradeCard(existing, rating, { retention, now });
  const card = repo.upsertLearnCard(d, { id: existing.id, lesson_id: existing.lesson_id, step_index: existing.step_index, ...graded.card });
  const review = repo.appendLearnReview(d, { card_id: card.id, ...graded.review });
  recordStreakActivity(d, repo, { now });
  return { card, review };
}

function getDueSessionCards(d, repo, { now = new Date(), cardCap = fsrs.SESSION_CARD_CAP } = {}) {
  const due = repo.getDueLearnCards(d, { before: now.toISOString(), limit: 200 });
  return fsrs.selectSessionCards(due, cardCap);
}

// ── lesson completion ────────────────────────────────────────────────────
function computeLessonScorePct(checkStatuses) {
  if (!checkStatuses || checkStatuses.length === 0) return null;
  const correct = checkStatuses.filter((s) => s === 'correct').length;
  return Math.round((100 * correct) / checkStatuses.length);
}

function maybeCompleteLesson(d, repo, { lessonId, totalSteps, checkStepIndexes = [] }, { now = new Date() } = {}) {
  const stepRows = repo.getLearnStepProgress(d, lessonId);
  const byIndex = new Map(stepRows.map((r) => [r.step_index, r]));

  for (let i = 0; i < totalSteps; i += 1) {
    const row = byIndex.get(i);
    if (!row || row.status === 'pending') return null; // not yet complete
  }

  const checkStatuses = checkStepIndexes.map((i) => byIndex.get(i)?.status).filter(Boolean);
  const score_pct = computeLessonScorePct(checkStatuses);
  return repo.upsertLearnProgress(d, lessonId, { status: 'completed', completed_at: now.toISOString(), score_pct });
}

module.exports = {
  recordStreakActivity,
  startLesson,
  recordStep,
  recordCheckAnswer,
  gradeReviewCard,
  getDueSessionCards,
  computeLessonScorePct,
  maybeCompleteLesson,
};
