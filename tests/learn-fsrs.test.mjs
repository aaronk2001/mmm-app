import { describe, it, expect } from 'vitest';
import {
  RETENTION,
  SESSION_CARD_CAP,
  SESSION_MINUTES_CAP,
  Rating,
  State,
  ratingFromAnswer,
  newCardRow,
  gradeCard,
  selectSessionCards,
  sessionShouldEnd,
  endScreenSummary,
} from '../server/learn/fsrs.js';

describe('learn/fsrs — constants (spec-mandated)', () => {
  it('retention targets are 0.90 core / 0.85 trivia', () => {
    expect(RETENTION.core).toBe(0.90);
    expect(RETENTION.trivia).toBe(0.85);
  });
  it('session cap is 20 cards or 7 minutes', () => {
    expect(SESSION_CARD_CAP).toBe(20);
    expect(SESSION_MINUTES_CAP).toBe(7);
  });
});

describe('learn/fsrs — newCardRow (createEmptyCard)', () => {
  const now = new Date(2026, 8, 18); // local Sep 18 2026
  const row = newCardRow(now);

  it('is a fresh New-state card with no reps/lapses', () => {
    expect(row.state).toBe(State.New);
    expect(row.reps).toBe(0);
    expect(row.lapses).toBe(0);
    expect(row.stability).toBe(0);
    expect(row.difficulty).toBe(0);
  });
  it('due is a real ISO timestamp string (not a bare YYYY-MM-DD)', () => {
    expect(typeof row.due).toBe('string');
    expect(new Date(row.due).toString()).not.toBe('Invalid Date');
    // A genuine instant, not day-only — length matches a full ISO datetime.
    expect(row.due.length).toBeGreaterThan('YYYY-MM-DD'.length);
  });
  it('last_review is unset for a brand-new card', () => {
    expect(row.last_review == null).toBe(true);
  });
});

describe('learn/fsrs — gradeCard', () => {
  const now = new Date(2026, 8, 18);

  it('grades a brand-new card (cardRow=null) the same as newCardRow+grade', () => {
    const { card, review } = gradeCard(null, Rating.Good, { now });
    expect(card.reps).toBe(1);
    expect(card.lapses).toBe(0);
    expect(review.rating).toBe(Rating.Good);
    expect(review.reviewed_at).toBe(now.toISOString());
  });

  it('a Good rating schedules the next due after now', () => {
    const { card } = gradeCard(null, Rating.Good, { now });
    expect(new Date(card.due).getTime()).toBeGreaterThan(now.getTime());
  });

  it('repeated Good ratings keep pushing due forward and eventually graduate to Review', () => {
    // Short-term learning steps (New -> Learning) have fixed, retention-
    // independent intervals in ts-fsrs, so stability doesn't necessarily grow
    // between two learning-step reviews on the same day — only due needs to
    // keep moving forward. Once graduated to Review, stability genuinely
    // grows with each successful review (asserted separately below).
    const first = gradeCard(null, Rating.Good, { now });
    const secondNow = new Date(first.card.due);
    const second = gradeCard(first.card, Rating.Good, { now: secondNow });
    expect(new Date(second.card.due).getTime()).toBeGreaterThan(secondNow.getTime());
    expect(second.card.state).toBe(State.Review); // graduated after 2 Goods
  });

  it('stability grows with each successful review once in Review state', () => {
    let step = gradeCard(null, Rating.Good, { now });
    step = gradeCard(step.card, Rating.Good, { now: new Date(step.card.due) });
    expect(step.card.state).toBe(State.Review);
    const enteredReviewStability = step.card.stability;
    const next = gradeCard(step.card, Rating.Good, { now: new Date(step.card.due) });
    expect(next.card.stability).toBeGreaterThan(enteredReviewStability);
  });

  it('an Again rating on a maturing card increments lapses', () => {
    // Get a card into Review state first via a couple of Good ratings.
    let state = gradeCard(null, Rating.Good, { now });
    let t = new Date(state.card.due);
    state = gradeCard(state.card, Rating.Good, { now: t });
    t = new Date(state.card.due);
    expect(state.card.state).toBe(State.Review);

    const lapsed = gradeCard(state.card, Rating.Again, { now: t });
    expect(lapsed.card.lapses).toBe(state.card.lapses + 1);
    expect(lapsed.card.state).toBe(State.Relearning);
    expect(lapsed.review.rating).toBe(Rating.Again);
  });

  it('different retention targets are actually wired through (core vs trivia differ)', () => {
    // Fixed-schedule learning steps ignore retention, so compare the effect
    // on a card that has already graduated to Review — that's where
    // request_retention actually drives the next-interval math.
    let step = gradeCard(null, Rating.Good, { now });
    step = gradeCard(step.card, Rating.Good, { now: new Date(step.card.due) });
    expect(step.card.state).toBe(State.Review);
    const reviewNow = new Date(step.card.due);
    const core = gradeCard(step.card, Rating.Good, { now: reviewNow, retention: RETENTION.core });
    const trivia = gradeCard(step.card, Rating.Good, { now: reviewNow, retention: RETENTION.trivia });
    expect(core.card.due).not.toBe(trivia.card.due);
  });

  it('round-trips a card row through rowToCard/cardToRow via two sequential gradeCard calls', () => {
    const { card: row1 } = gradeCard(null, Rating.Easy, { now });
    // If rowToCard/cardToRow lost data, grading again from the stored row
    // would throw or silently reset state — assert it behaves like a
    // continuation, not a fresh card.
    const { card: row2 } = gradeCard(row1, Rating.Good, { now: new Date(row1.due) });
    expect(row2.reps).toBe(row1.reps + 1);
  });
});

describe('learn/fsrs — ratingFromAnswer', () => {
  it('maps again/hard/good/easy to the ts-fsrs Rating enum', () => {
    expect(ratingFromAnswer('again')).toBe(Rating.Again);
    expect(ratingFromAnswer('hard')).toBe(Rating.Hard);
    expect(ratingFromAnswer('good')).toBe(Rating.Good);
    expect(ratingFromAnswer('easy')).toBe(Rating.Easy);
    expect(ratingFromAnswer('GOOD')).toBe(Rating.Good); // case-insensitive
  });
  it('throws on an unknown answer', () => {
    expect(() => ratingFromAnswer('meh')).toThrow(/Unknown FSRS answer/);
  });
});

describe('learn/fsrs — session sizing', () => {
  const due = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}` }));

  it('caps a due-card list at 20 by default', () => {
    expect(selectSessionCards(due)).toHaveLength(20);
  });
  it('respects a custom cap', () => {
    expect(selectSessionCards(due, 5)).toHaveLength(5);
  });
  it('never errors on an empty/undefined queue', () => {
    expect(selectSessionCards([])).toEqual([]);
    expect(selectSessionCards(undefined)).toEqual([]);
  });

  it('sessionShouldEnd is true once the card cap is hit', () => {
    expect(sessionShouldEnd({ cardsReviewed: 20, elapsedSeconds: 10 })).toBe(true);
  });
  it('sessionShouldEnd is true once the 7-minute cap is hit', () => {
    expect(sessionShouldEnd({ cardsReviewed: 1, elapsedSeconds: 420 })).toBe(true);
  });
  it('sessionShouldEnd is false mid-session', () => {
    expect(sessionShouldEnd({ cardsReviewed: 5, elapsedSeconds: 60 })).toBe(false);
  });
});

describe('learn/fsrs — endScreenSummary (always positive)', () => {
  it('is encouraging even with a rough session, never shaming', () => {
    const s = endScreenSummary({ cardsReviewed: 10, correctCount: 2 });
    expect(s.accuracyPct).toBe(20);
    expect(s.message).toMatch(/nice work/i);
    expect(s.message).not.toMatch(/fail|bad|wrong|poor/i);
  });
  it('handles a caught-up (0 due) session', () => {
    const s = endScreenSummary({ cardsReviewed: 0, correctCount: 0 });
    expect(s.accuracyPct).toBeNull();
    expect(s.message).toMatch(/caught up/i);
  });
});
