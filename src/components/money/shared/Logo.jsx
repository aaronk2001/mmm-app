// MMM mark: three ascending rounded bars ("money moves up") in a teal→mint
// gradient on a soft rounded tile. Reads down to 16px. Pure SVG, theme-agnostic.
export function LogoMark({ size = 28 }) {
  const id = 'mmmg';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="4" y1="26" x2="28" y2="6" gradientUnits="userSpaceOnUse">
          <stop stopColor="#14b8a6" />
          <stop offset="1" stopColor="#4ade80" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#0f1b19" stroke={`url(#${id})`} strokeOpacity="0.35" />
      <rect x="8"  y="17" width="4" height="7"  rx="2" fill={`url(#${id})`} />
      <rect x="14" y="12" width="4" height="12" rx="2" fill={`url(#${id})`} />
      <rect x="20" y="7"  width="4" height="17" rx="2" fill={`url(#${id})`} />
    </svg>
  );
}

// Full sidebar lockup: mark + wordmark + tagline.
export default function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px' }}>
      <LogoMark size={26} />
      <div style={{ lineHeight: 1.05 }}>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '0.02em', color: 'var(--m-ink)' }}>MMM</div>
        <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--m-muted)' }}>
          Making Money Moves
        </div>
      </div>
    </div>
  );
}
