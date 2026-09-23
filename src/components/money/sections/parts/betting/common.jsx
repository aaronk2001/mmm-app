import { ExternalLink as ExternalLinkIcon } from 'lucide-react';
import { StatusChip, tileStyle, num } from '../markets/common';

// Betting-tab helpers. Staleness reuses the Markets StatusChip rather than
// growing a second Live/Cached/Offline scale — same reasoning as the
// Intelligence tabs. Only the odds-specific formatting lives here.
//
// This whole section is INFORMATIONAL. Nothing under parts/betting posts,
// stakes, or records anything: there is no write endpoint to call, and no
// number here ever reaches the ledger.

export { StatusChip, tileStyle, num };

// American odds always carry their sign — "+150" and "-110" are different
// prices, and an unsigned 150 is ambiguous.
export const fAmerican = (o) => (o == null || !Number.isFinite(Number(o)) ? '—' : (Number(o) > 0 ? `+${Math.round(o)}` : `${Math.round(o)}`));

export const fProb = (p, decimals = 1) => (p == null || !Number.isFinite(Number(p)) ? '—' : `${(Number(p) * 100).toFixed(decimals)}%`);

export const fPctPts = (p, decimals = 2) =>
  (p == null || !Number.isFinite(Number(p)) ? '—' : `${Number(p) >= 0 ? '+' : ''}${(Number(p) * 100).toFixed(decimals)} pts`);

export const fMoney = (n, decimals = 2) =>
  (n == null || !Number.isFinite(Number(n)) ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));

export const fVolumeShort = (v) => {
  const n0 = Number(v);
  if (!Number.isFinite(n0)) return '—';
  if (n0 >= 1_000_000) return `$${(n0 / 1_000_000).toFixed(1)}M`;
  if (n0 >= 1_000) return `$${Math.round(n0 / 1_000)}K`;
  return `$${Math.round(n0)}`;
};

// commence/close times are INSTANTS (full ISO timestamps), not day keys —
// rendered with the browser's locale, never sliced into a 'YYYY-MM-DD'.
export const fWhen = (iso) => {
  if (!iso) return '—';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '—' : new Date(t).toLocaleString();
};

export function timeUntil(iso, now = Date.now()) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const diff = t - now;
  if (diff <= 0) return 'Closed';
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  return `${hours}h ${mins}m`;
}

export const SOURCE_LABELS = { polymarket: 'Polymarket', kalshi: 'Kalshi', manifold: 'Manifold' };

// Remote text and remote URLs are untrusted: render as text, link only
// http(s), and always hand the click to the OS browser out of Electron.
export function SafeLink({ url, children }) {
  const ok = typeof url === 'string' && /^https?:\/\//i.test(url);
  if (!ok) return <span style={{ color: 'var(--m-muted)' }}>{children}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--m-accent)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600 }}>
      {children} <ExternalLinkIcon size={12} aria-hidden="true" />
    </a>
  );
}

// Yes/No split for a binary market. Track and fill are both semantic tokens
// so the bar reads correctly in either theme.
export function ProbBar({ yes }) {
  const pct = Math.max(0, Math.min(1, Number(yes) || 0)) * 100;
  return (
    <div
      role="img"
      aria-label={`Yes ${pct.toFixed(1)} percent`}
      style={{ height: 8, borderRadius: 999, background: 'var(--m-surface-3)', border: '1px solid var(--m-border)', overflow: 'hidden' }}
    >
      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--m-accent)' }} />
    </div>
  );
}

export function Pill({ children, tone = 'muted' }) {
  const color = tone === 'accent' ? 'var(--m-accent)' : tone === 'green' ? 'var(--m-green)' : tone === 'amber' ? 'var(--m-amber)' : 'var(--m-muted)';
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color, border: `1px solid ${color}`, borderRadius: 999, padding: '1px 8px', lineHeight: '16px', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

// Repeated at the top of every sub-tab: this section shows prices and
// computed edges only.
export function InfoOnlyNote({ children }) {
  return (
    <div style={{ marginTop: 12, fontSize: 12, color: 'var(--m-muted)', lineHeight: 1.5 }}>
      Informational only — MMM never places, tracks, or settles a wager, and nothing here touches your accounts or budgets.{children ? ' ' : ''}{children}
    </div>
  );
}

export const th = { padding: '10px 12px', textAlign: 'left', color: 'var(--m-muted)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' };
export const thR = { ...th, textAlign: 'right' };
export const td = { padding: '10px 12px', color: 'var(--m-ink)', fontSize: 14 };
export const tdR = { ...td, textAlign: 'right', ...num };
