// Regression coverage for the AnimatedNumber interruption bug: when a new
// `value` arrives mid-tween, the next tween must resume from the value
// actually on screen, never snap backward toward the interrupted tween's
// original start point. @testing-library/react is not a devDependency here,
// so this exercises the pure `stepTween` helper directly (no DOM/rAF).
import { describe, it, expect } from 'vitest';
import { stepTween } from '../src/components/money/shared/AnimatedNumber.jsx';

describe('AnimatedNumber stepTween', () => {
  it('resumes an interrupted tween from the on-screen value, never jumping backward', () => {
    const state = { from: 0 };

    // Tween toward 100 over 600ms; interrupt partway through, at 300ms.
    const mid = stepTween(state, 100, 600, 300).current;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);

    // The target changes to 50 before the first tween finished. The very
    // first frame of the new tween (elapsedMs = 0, i.e. p = 0) must render
    // exactly the value that was on screen (`mid`) — the eased formula at
    // p = 0 is just the start point, so this pins that the start point was
    // updated to `mid` rather than left at the original 0.
    const resumed = stepTween(state, 50, 600, 0).current;
    expect(resumed).toBeCloseTo(mid, 10);
  });

  it('never renders a value below the point it was interrupted at while moving toward a lower target', () => {
    const state = { from: 0 };
    const mid = stepTween(state, 100, 600, 300).current; // interrupted partway up
    // New target (50) is below `mid` — the correct behaviour eases smoothly
    // down from `mid`, but the very first frame (p = 0) must still equal
    // `mid`, not the stale pre-interruption start of 0.
    const firstFrameOfNewTween = stepTween(state, 50, 600, 0).current;
    expect(firstFrameOfNewTween).toBeCloseTo(mid, 10);
    expect(firstFrameOfNewTween).not.toBeCloseTo(0, 1);
  });

  it('completes exactly at the target once elapsed time reaches duration', () => {
    const state = { from: 0 };
    const { current, done } = stepTween(state, 100, 600, 600);
    expect(current).toBe(100);
    expect(done).toBe(true);
  });

  it('jumps straight to the target when duration <= 0 (reduced-motion / instant path)', () => {
    const state = { from: 10 };
    const { current, done } = stepTween(state, 30, 0, 0);
    expect(current).toBe(30);
    expect(done).toBe(true);
    expect(state.from).toBe(30); // ref/state must be updated too, not just the return value
  });
});
