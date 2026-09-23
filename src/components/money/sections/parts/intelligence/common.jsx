// Shared by the Intelligence sub-tabs. Staleness/empty-state helpers live in
// parts/markets/common.jsx and are reused as-is (same Live/Cached/Offline
// scale, same read-only tile) — only the bits specific to remote *text* live
// here.

export { StatusChip, tileStyle, num } from '../markets/common';

// Every headline, summary, source name, and URL in this section is untrusted
// remote text. It is always rendered as text (never dangerouslySetInnerHTML),
// and a link is only produced for an http(s) URL — anything else renders as
// plain text instead. target=_blank + rel=noopener noreferrer hands the URL
// to Electron's setWindowOpenHandler, which opens it in the OS browser.
export function isSafeHref(url) {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function ExternalLink({ href, children, style, ...rest }) {
  if (!isSafeHref(href)) return <span style={style} {...rest}>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', ...style }} {...rest}>
      {children}
    </a>
  );
}

// An article timestamp is an *instant*, not a local day key — it is never run
// through parseYmd/todayYmd and never sliced into YYYY-MM-DD. toLocaleString
// renders it in the user's own zone.
export function fmtWhen(instant) {
  if (!instant) return '';
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

export function relativeWhen(instant) {
  if (!instant) return '';
  const t = new Date(instant).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};
