export default function Money({ value, prefix = '$', decimals = 2, className = '' }) {
  if (value == null) return <span className={`num ${className}`}>{String.fromCharCode(8212)}</span>;

  const formatted = typeof value === 'number'
    ? value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : value;

  return <span className={`num ${className}`}>{prefix}{formatted}</span>;
}
