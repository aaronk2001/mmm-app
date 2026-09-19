import { useEffect, useRef, useState } from 'react';

// Shared reduced-motion check — exported because motion/react tweens and
// Recharts' own entrance animation both run on rAF/WAAPI, not CSS
// transition/animation, so the blanket `prefers-reduced-motion` override in
// theme.css/money-theme.css (which only zeroes CSS animation/transition
// durations) never reaches them. Anywhere that drives motion outside CSS
// needs this same check.
export const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const ease = (p) => 1 - Math.pow(1 - p, 3);

// Pure, exported so the fix below is unit-testable without a DOM/rAF loop.
// Advances one animation step and — critically — writes the result back
// into `state.from` on EVERY call, not only when the tween completes. That
// way, if a new target `value` arrives before the previous tween finished,
// the next tween's start point is the value actually on screen, not the
// stale start point of the interrupted one (which used to cause a visible
// backward jump).
export function stepTween(state, value, duration, elapsedMs) {
  const p = duration <= 0 ? 1 : Math.min(1, elapsedMs / duration);
  const current = state.from + (value - state.from) * ease(p);
  state.from = current;
  return { current, done: p >= 1 };
}

export default function AnimatedNumber({ value = 0, format = (n) => String(Math.round(n)), duration = 600 }) {
  const [shown, setShown] = useState(value);
  const tween = useRef({ from: value });
  useEffect(() => {
    if (reduced() || duration <= 0) { tween.current.from = value; setShown(value); return; }
    const start = performance.now();
    let raf;
    const tick = (t) => {
      const { current, done } = stepTween(tween.current, value, duration, t - start);
      setShown(current);
      if (!done) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{format(shown)}</span>;
}
