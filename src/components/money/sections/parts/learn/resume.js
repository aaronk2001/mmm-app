// Pure lesson-runner resume logic (Sprint D, Wave 2). Kept dependency-free
// and framework-free so it's unit-testable without a DOM/React harness.
//
// "Esc saves position" relies entirely on the server already being the
// source of truth for step progress (server/learn/progress.js writes a
// learn_step_progress row the moment a step is answered/skipped — see
// schema.sql's comment on that table). The runner never needs its own
// separate "save" call: on (re)load it just resumes at the first step whose
// server-reported status is still 'pending'. Exiting via Esc before that
// call fires simply means the step wasn't recorded yet, which is correct —
// nothing the user "finished" is ever lost, and nothing half-finished is
// ever counted as done.

// steps: the GET /lessons/:id `steps[]` array, each with `.progress.status`.
export function findResumeStepIndex(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return 0;
  const idx = steps.findIndex((s) => (s?.progress?.status || 'pending') === 'pending');
  return idx === -1 ? steps.length - 1 : idx;
}

// True once every step has a non-pending status (mirrors the server's own
// maybeCompleteLesson loop in server/learn/progress.js, read-only here).
export function allStepsDone(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return false;
  return steps.every((s) => (s?.progress?.status || 'pending') !== 'pending');
}

// Soft mastery gate (spec: "≥80% plus at least one apply-action"). Only
// meaningful for lessons whose front matter sets `gate: true` — ungated
// lessons pass on completion alone.
export function passesMasteryGate({ gate, scorePct, applyActionDone }) {
  if (!gate) return true;
  return (scorePct ?? 0) >= 80 && !!applyActionDone;
}
