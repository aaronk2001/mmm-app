// Pure-logic coverage for the Learn lesson runner's "Esc saves position"
// resume behaviour (Sprint D, Wave 2 / Track 3). No React/DOM harness is
// added for this build (no new dependency), so this exercises the exact
// resume-index + mastery-gate logic the runner calls directly, against the
// same step-progress shape GET /lessons/:id returns.
import { describe, it, expect } from 'vitest';
import { findResumeStepIndex, allStepsDone, passesMasteryGate } from '../src/components/money/sections/parts/learn/resume.js';

function steps(statuses) {
  return statuses.map((status, index) => ({ index, progress: { status } }));
}

describe('findResumeStepIndex', () => {
  it('resumes at step 0 for a never-started lesson', () => {
    expect(findResumeStepIndex(steps(['pending', 'pending', 'pending']))).toBe(0);
  });

  it('resumes at the first pending step after a partial run (the Esc case)', () => {
    // User completed steps 0-2, exited via Esc before answering step 3.
    expect(findResumeStepIndex(steps(['skipped', 'correct', 'skipped', 'pending', 'pending']))).toBe(3);
  });

  it('resumes at the last step when every step is already recorded', () => {
    expect(findResumeStepIndex(steps(['correct', 'skipped', 'correct']))).toBe(2);
  });

  it('treats a missing progress object as pending', () => {
    expect(findResumeStepIndex([{ index: 0 }, { index: 1 }])).toBe(0);
  });

  it('defaults to 0 for an empty/missing step list', () => {
    expect(findResumeStepIndex([])).toBe(0);
    expect(findResumeStepIndex(undefined)).toBe(0);
  });
});

describe('allStepsDone', () => {
  it('is false while any step is pending', () => {
    expect(allStepsDone(steps(['correct', 'pending']))).toBe(false);
  });
  it('is true once every step has a terminal status', () => {
    expect(allStepsDone(steps(['correct', 'wrong', 'skipped']))).toBe(true);
  });
  it('is false for an empty lesson', () => {
    expect(allStepsDone([])).toBe(false);
  });
});

describe('passesMasteryGate', () => {
  it('always passes an ungated lesson', () => {
    expect(passesMasteryGate({ gate: false, scorePct: 0, applyActionDone: false })).toBe(true);
  });
  it('requires >=80% AND an apply-action for a gated lesson', () => {
    expect(passesMasteryGate({ gate: true, scorePct: 100, applyActionDone: false })).toBe(false);
    expect(passesMasteryGate({ gate: true, scorePct: 60, applyActionDone: true })).toBe(false);
    expect(passesMasteryGate({ gate: true, scorePct: 80, applyActionDone: true })).toBe(true);
  });
  it('treats a null score as 0 for a gated lesson', () => {
    expect(passesMasteryGate({ gate: true, scorePct: null, applyActionDone: true })).toBe(false);
  });
});
