'use strict';

// Thin wrapper around ts-fsrs (the Learn engine's spaced-repetition
// scheduler). This module owns:
//   - creating new cards (createEmptyCard)
//   - grading a review and producing the next card state + a review-log row
//   - session sizing (card cap / time cap) and a positive end screen
//
// Dates: ts-fsrs's `due` / `last_review` / review timestamps are genuine
// sub-day instants (a same-day "learning step" can be due 10 minutes later),
// not calendar day-keys, so they're stored and compared as full ISO instant
// strings via `new Date(isoString)` / `.toISOString()`. This is NOT the
// forbidden `new Date('YYYY-MM-DD')` local-day pattern — that rule is about
// date-ONLY keys (see server/money/runway.js, server/learn/variables.js),
// which is a different concern from FSRS's precise scheduling instants.

const { fsrs, generatorParameters, createEmptyCard, Rating, State } = require('ts-fsrs');

// Spec-mandated retention targets and session caps (Sprint D, Track 1).
const RETENTION = { core: 0.90, trivia: 0.85 };
const SESSION_CARD_CAP = 20;
const SESSION_MINUTES_CAP = 7;

const ANSWER_TO_RATING = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};
function ratingFromAnswer(answer) {
  const r = ANSWER_TO_RATING[String(answer).toLowerCase()];
  if (r === undefined) throw new Error(`Unknown FSRS answer: ${answer}`);
  return r;
}

function toIso(d) {
  if (d == null) return null;
  return d instanceof Date ? d.toISOString() : d;
}

// DB row (strings, matches schema.sql's learn_cards columns) -> ts-fsrs Card.
function rowToCard(row) {
  return {
    due: new Date(row.due),
    stability: row.stability || 0,
    difficulty: row.difficulty || 0,
    elapsed_days: row.elapsed_days || 0,
    scheduled_days: row.scheduled_days || 0,
    learning_steps: row.learning_steps || 0,
    reps: row.reps || 0,
    lapses: row.lapses || 0,
    state: row.state || State.New,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

// ts-fsrs Card -> DB row shape (id/lesson_id/step_index are the caller's job
// to attach — this module never touches the DB).
function cardToRow(card) {
  return {
    due: toIso(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: toIso(card.last_review),
  };
}

// A brand-new card (first time a step enters the review queue), as a DB row.
function newCardRow(now = new Date()) {
  return cardToRow(createEmptyCard(now));
}

// Grade a review. `cardRow` is a learn_cards row (or null/undefined for a
// card that doesn't exist yet, in which case a fresh one is created and
// graded in the same call). Returns { card, review } — both plain DB rows.
function gradeCard(cardRow, rating, { retention = RETENTION.core, now = new Date() } = {}) {
  const scheduler = fsrs(generatorParameters({ request_retention: retention }));
  const card = cardRow ? rowToCard(cardRow) : createEmptyCard(now);
  const { card: nextCard, log } = scheduler.next(card, now, rating);
  return {
    card: cardToRow(nextCard),
    review: {
      rating: log.rating,
      state: log.state,
      due: toIso(log.due),
      stability: log.stability,
      difficulty: log.difficulty,
      elapsed_days: log.elapsed_days,
      last_elapsed_days: log.last_elapsed_days,
      scheduled_days: log.scheduled_days,
      reviewed_at: toIso(log.review),
    },
  };
}

// ── session sizing ───────────────────────────────────────────────────────
function selectSessionCards(dueCards, cardCap = SESSION_CARD_CAP) {
  return (dueCards || []).slice(0, cardCap);
}
function sessionShouldEnd({ cardsReviewed = 0, elapsedSeconds = 0, cardCap = SESSION_CARD_CAP, minutesCap = SESSION_MINUTES_CAP } = {}) {
  return cardsReviewed >= cardCap || elapsedSeconds >= minutesCap * 60;
}

// ── positive end screen ──────────────────────────────────────────────────
// Always encouraging, never a scorecard-shaming message — FSRS scheduling
// (not the end screen) is what handles "you got this wrong."
function endScreenSummary({ cardsReviewed = 0, correctCount = 0 } = {}) {
  const accuracyPct = cardsReviewed > 0 ? Math.round((correctCount / cardsReviewed) * 100) : null;
  const message = cardsReviewed === 0
    ? 'No cards were due today — you are all caught up.'
    : `Nice work — you reviewed ${cardsReviewed} card${cardsReviewed === 1 ? '' : 's'} today.`;
  return { cardsReviewed, accuracyPct, message };
}

module.exports = {
  RETENTION,
  SESSION_CARD_CAP,
  SESSION_MINUTES_CAP,
  Rating,
  State,
  ratingFromAnswer,
  rowToCard,
  cardToRow,
  newCardRow,
  gradeCard,
  selectSessionCards,
  sessionShouldEnd,
  endScreenSummary,
};
