const LABEL = { A: 'Computed from your real transactions', B: 'Estimated from recurring bills or thin history', C: 'Rough guess — add data to improve' };
export default function Grade({ grade = 'C', style, label }) {
  const color = grade === 'A' ? 'var(--m-green)' : grade === 'B' ? 'var(--m-accent)' : 'var(--m-muted)';
  const text = label || LABEL[grade] || LABEL.C;
  return (
    <span title={text} aria-label={`Evidence grade ${grade}: ${text}`} style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, lineHeight: '16px', padding: '0 6px', borderRadius: 999, border: `1px solid ${color}`, color, ...style }}>
      {grade}
    </span>
  );
}
