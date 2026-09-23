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

export const fVol = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

// "$low – $high", or '—' when either side is missing (e.g. day/52-week range
// fields that Yahoo's chart `meta` doesn't always carry for every symbol).
export function rangeStr(low, high, decimals = 2) {
  if (low == null || high == null) return '—';
  return `${f$(low, decimals)} – ${f$(high, decimals)}`;
}

// Sorts a copy of `items` by a numeric getter, biggest first, nulls last —
// used to put the day's gainers before losers in the Sectors/Futures/Crypto
// grids instead of leaving them in raw symbol-map insertion order.
export function sortByPctDesc(items, getPct) {
  return [...items].sort((a, b) => {
    const pa = getPct(a);
    const pb = getPct(b);
    if (pa == null && pb == null) return 0;
    if (pa == null) return 1;
    if (pb == null) return -1;
    return pb - pa;
  });
}

// A compact, human "how fresh is this" label for a tile/table header —
// StatusChip already carries the exact timestamp in its title tooltip, but
// that's hover-only; this renders a short visible string next to it.
export function formatUpdatedAt(cachedAt, now = Date.now()) {
  if (!cachedAt) return null;
  const then = new Date(cachedAt).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = now - then;
  if (diffMs < 60_000) return 'Updated just now';
  if (diffMs < 3_600_000) return `Updated ${Math.floor(diffMs / 60_000)}m ago`;
  const thenDate = new Date(then);
  const nowDate = new Date(now);
  const sameDay = thenDate.getFullYear() === nowDate.getFullYear()
    && thenDate.getMonth() === nowDate.getMonth()
    && thenDate.getDate() === nowDate.getDate();
  return sameDay
    ? `Updated ${thenDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : `Updated ${thenDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

export function UpdatedAt({ cached_at }) {
  const label = formatUpdatedAt(cached_at);
  if (!label) return null;
  return <span style={{ fontSize: 11, color: 'var(--m-muted)' }}>{label}</span>;
}

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

