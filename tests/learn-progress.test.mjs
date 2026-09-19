// Learn engine progress/streak/session orchestration — real SQLite (temp DB
// from tests/setup.mjs), same pattern as tests/paper-store.test.mjs.
import { describe, it, expect, beforeEach } from 'vitest';
import store from '../server/money/store.js';
import repo from '../server/db/repo.js';
import { db as getDb } from '../server/db/connection.js';
import * as progress from '../server/learn/progress.js';
import { Rating, RETENTION } from '../server/learn/fsrs.js';

let db;
beforeEach(() => {
  store.reset(); // clears learn_* tables too (see server/db/repo.js emptyData)
  db = getDb();
});

describe('learn/progress — streak', () => {
  it('starts a streak at 1 on first activity', () => {
    const now = new Date(2026, 8, 18);
    const streak = progress.recordStreakActivity(db, repo, { now });
    expect(streak.current_streak).toBe(1);
    expect(streak.longest_streak).toBe(1);
    expect(streak.last_active_date).toBe('2026-09-18');
  });

  it('is a no-op for a second activity on the same local day', () => {
    const now = new Date(2026, 8, 18, 9, 0);
    progress.recordStreakActivity(db, repo, { now });
    const later = new Date(2026, 8, 18, 21, 0);
    const streak = progress.recordStreakActivity(db, repo, { now: later });
    expect(streak.current_streak).toBe(1);
  });

  it('increments on consecutive local days', () => {
    progress.recordStreakActivity(db, repo, { now: new Date(2026, 8, 18) });
    const streak = progress.recordStreakActivity(db, repo, { now: new Date(2026, 8, 19) });
    expect(streak.current_streak).toBe(2);
    expect(streak.longest_streak).toBe(2);
  });

  it('resets to 1 after a gap day, but preserves the longest streak', () => {
    progress.recordStreakActivity(db, repo, { now: new Date(2026, 8, 18) });
    progress.recordStreakActivity(db, repo, { now: new Date(2026, 8, 19) });
    const streak = progress.recordStreakActivity(db, repo, { now: new Date(2026, 8, 22) }); // 3-day gap
    expect(streak.current_streak).toBe(1);
    expect(streak.longest_streak).toBe(2);
  });
});

describe('learn/progress — lesson/step progress', () => {
  it('startLesson moves not_started -> in_progress and stamps started_at once', () => {
    const now = new Date(2026, 8, 18);
    const first = progress.startLesson(db, repo, 'm1-what-is-runway', { now });
    expect(first.status).toBe('in_progress');
    expect(first.started_at).toBe(now.toISOString());

    const later = progress.startLesson(db, repo, 'm1-what-is-runway', { now: new Date(2026, 8, 19) });
    expect(later.started_at).toBe(now.toISOString()); // unchanged, idempotent
  });

  it('recordStep starts the lesson, upserts the step, and bumps the streak', () => {
    const now = new Date(2026, 8, 18);
    const step = progress.recordStep(db, repo, { lessonId: 'les1', stepIndex: 0, status: 'correct' }, { now });
    expect(step.status).toBe('correct');
    expect(repo.getLearnProgress(db, 'les1').status).toBe('in_progress');
    expect(repo.getLearnStreak(db).current_streak).toBe(1);
  });
});

describe('learn/progress — recordCheckAnswer (card-on-wrong-answer rule)', () => {
  const now = new Date(2026, 8, 18);

  it('a correct first answer does not create an FSRS card', () => {
    const { step, card } = progress.recordCheckAnswer(
      db, repo,
      { lessonId: 'les1', stepIndex: 3, selectedKey: 'B', correctKey: 'B' },
      { now },
    );
    expect(step.status).toBe('correct');
    expect(card).toBeNull();
    expect(repo.getLearnCardByStep(db, 'les1', 3)).toBeNull();
  });

  it('a wrong first answer creates an FSRS card and a review row', () => {
    const { step, card, review } = progress.recordCheckAnswer(
      db, repo,
      { lessonId: 'les1', stepIndex: 3, selectedKey: 'A', correctKey: 'B' },
      { now },
    );
    expect(step.status).toBe('wrong');
    expect(card).not.toBeNull();
    expect(card.lesson_id).toBe('les1');
    expect(card.step_index).toBe(3);
    expect(review.rating).toBe(Rating.Again);
    expect(repo.getAllLearnReviews(db)).toHaveLength(1);
  });

  it('a second wrong answer on the same step grades the existing card, not a duplicate', () => {
    progress.recordCheckAnswer(db, repo, { lessonId: 'les1', stepIndex: 3, selectedKey: 'A', correctKey: 'B' }, { now });
    const firstCard = repo.getLearnCardByStep(db, 'les1', 3);

    const later = new Date(2026, 8, 19);
    const { card } = progress.recordCheckAnswer(db, repo, { lessonId: 'les1', stepIndex: 3, selectedKey: 'A', correctKey: 'B' }, { now: later });
    expect(card.id).toBe(firstCard.id);
    expect(repo.getAllLearnCards(db)).toHaveLength(1);
    expect(repo.getAllLearnReviews(db)).toHaveLength(2);
  });
});

describe('learn/progress — gradeReviewCard (spaced-repetition session flow)', () => {
  it('grades an existing card by answer, appends a review, and bumps the streak', () => {
    const now = new Date(2026, 8, 18);
    const { card: created } = progress.recordCheckAnswer(db, repo, { lessonId: 'les1', stepIndex: 3, selectedKey: 'A', correctKey: 'B' }, { now });

    const later = new Date(created.due);
    const { card, review } = progress.gradeReviewCard(db, repo, { cardId: created.id, answer: 'good', retention: RETENTION.core }, { now: later });
    expect(review.rating).toBe(Rating.Good);
    expect(card.reps).toBeGreaterThan(created.reps);
    expect(repo.getLearnStreak(db).last_active_date).toBe(`${later.getFullYear()}-${String(later.getMonth() + 1).padStart(2, '0')}-${String(later.getDate()).padStart(2, '0')}`);
  });

  it('throws for an unknown card id', () => {
    expect(() => progress.gradeReviewCard(db, repo, { cardId: 'nope', answer: 'good' }, { now: new Date() })).toThrow(/not found/);
  });
});

describe('learn/progress — getDueSessionCards', () => {
  it('returns only cards due at or before now, capped by session size', () => {
    const now = new Date(2026, 8, 18);
    progress.recordCheckAnswer(db, repo, { lessonId: 'les1', stepIndex: 0, selectedKey: 'A', correctKey: 'B' }, { now });
    progress.recordCheckAnswer(db, repo, { lessonId: 'les2', stepIndex: 0, selectedKey: 'A', correctKey: 'B' }, { now });

    const dueCard = repo.getLearnCardByStep(db, 'les1', 0);
    const farFuture = new Date(dueCard.due);
    farFuture.setFullYear(farFuture.getFullYear() + 5);
    repo.upsertLearnCard(db, { id: repo.getLearnCardByStep(db, 'les2', 0).id, lesson_id: 'les2', step_index: 0, due: farFuture.toISOString() });

    const session = progress.getDueSessionCards(db, repo, { now: new Date(dueCard.due) });
    expect(session.map((c) => c.lesson_id)).toEqual(['les1']);
  });
});

describe('learn/progress — computeLessonScorePct', () => {
  it('computes a percentage from check statuses', () => {
    expect(progress.computeLessonScorePct(['correct', 'correct', 'wrong', 'correct'])).toBe(75);
  });
  it('returns null for no checks', () => {
    expect(progress.computeLessonScorePct([])).toBeNull();
    expect(progress.computeLessonScorePct(undefined)).toBeNull();
  });
});

describe('learn/progress — maybeCompleteLesson', () => {
  const now = new Date(2026, 8, 18);

  it('returns null until every step is non-pending', () => {
    progress.recordStep(db, repo, { lessonId: 'les1', stepIndex: 0, status: 'correct' }, { now });
    const result = progress.maybeCompleteLesson(db, repo, { lessonId: 'les1', totalSteps: 2, checkStepIndexes: [] }, { now });
    expect(result).toBeNull();
    expect(repo.getLearnProgress(db, 'les1').status).toBe('in_progress');
  });

  it('marks the lesson completed with a score_pct once all steps are done', () => {
    progress.recordStep(db, repo, { lessonId: 'les1', stepIndex: 0, status: 'correct' }, { now });
    progress.recordCheckAnswer(db, repo, { lessonId: 'les1', stepIndex: 1, selectedKey: 'A', correctKey: 'B' }, { now });
    progress.recordStep(db, repo, { lessonId: 'les1', stepIndex: 2, status: 'skipped' }, { now });

    const result = progress.maybeCompleteLesson(db, repo, { lessonId: 'les1', totalSteps: 3, checkStepIndexes: [1] }, { now });
    expect(result.status).toBe('completed');
    expect(result.completed_at).toBe(now.toISOString());
    expect(result.score_pct).toBe(0); // the only check step was answered wrong
  });
});
