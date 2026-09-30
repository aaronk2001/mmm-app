export default function Money({ value, prefix = '$', decimals = 2, className = '' }) {
  if (value == null) return <span className={`num ${className}`}>{String.fromCharCode(8212)}</span>;

  if (typeof value !== 'number') return <span className={`num ${className}`}>{prefix}{value}</span>;

  // Sign before the symbol: -$38.50, not $-38.50.
  const formatted = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return <span className={`num ${className}`}>{value < 0 ? '-' : ''}{prefix}{formatted}</span>;
}
