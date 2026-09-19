import { motion } from 'motion/react';
import { reduced } from './AnimatedNumber';

export default function BigStat({ value, label, delta = null, prefix = '', suffix = '' }) {
  const isPositive = delta == null || delta >= 0;
  const deltaSign = delta != null && delta < 0 ? '-' : delta != null ? '+' : '';

  // motion/react drives this via WAAPI, not CSS transitions, so the CSS
  // prefers-reduced-motion override in theme.css can't reach it — skip the
  // entrance tween entirely instead.
  const motionProps = reduced()
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3 } };

  return (
    <motion.div
      {...motionProps}
      className="m-stat-big"
    >
      <div className="m-stat-big-label num">{label}</div>
      <div className="m-stat-big-value num">
        {prefix}{typeof value === 'number' ? value.toLocaleString('en-US') : value}{suffix}
      </div>
      {delta != null && (
        <div className={`m-stat-big-delta ${isPositive ? 'positive' : 'negative'}`}>
          {deltaSign}{Math.abs(delta).toFixed(2)}%
        </div>
      )}
    </motion.div>
  );
}
