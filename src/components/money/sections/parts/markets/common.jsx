import { Wifi, WifiOff, Clock } from 'lucide-react';

// Shared across every Markets tab. Money here is externally-sourced (not
// derived from the user's own transactions like the rest of the app), so
// each tile carries a Live/Cached/Offline chip instead of the money-side
// A/B/C evidence Grade — that scale means "how good is our estimate of
// your data" and doesn't map onto "did this quote actually come from Yahoo
// just now." Same idea (never let a number sit unlabeled), different scale.

export const num = { fontVariantNumeric: 'tabular-nums' };

export const f$ = (n, decimals = 2) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const fPct = (n) => (n == null ? '—' : (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%');

export const changeColor = (n) => (n == null ? 'var(--m-muted)' : n >= 0 ? 'var(--m-green)' : 'var(--m-red)');

// envelope: the { data, cached_at, stale, offline } shape every online.fetch
// call and every provider wrapper in server/market/providers.js returns.
export function StatusChip({ stale, offline, cached_at }) {
  let Icon = Wifi; let label = 'Live'; let color = 'var(--m-green)';
  if (offline && !cached_at) { Icon = WifiOff; label = 'Offline'; color = 'var(--m-muted)'; }
  else if (stale || offline) { Icon = Clock; label = 'Cached'; color = 'var(--m-accent)'; }
  const title = cached_at ? `Last updated ${new Date(cached_at).toLocaleString()}` : 'No data yet — enable Market data in Settings, or check your connection';
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color, border: `1px solid ${color}`, borderRadius: 999, padding: '1px 8px', lineHeight: '16px' }}>
      <Icon size={11} aria-hidden="true" /> {label}
    </span>
  );
}

// Every Markets tile is read-only data, never a clickable card — no
// cursor:pointer per the styling rule.
export const tileStyle = { background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 12, padding: 14 };

// lightweight-charts draws on a canvas, so it needs a resolved color string,
// not a `var(--m-*)` reference — read the computed value off the nearest
// .money-hub-scoped element instead of hardcoding a hex anywhere.
export function cssVar(el, name, fallback) {
  if (!el) return fallback;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

