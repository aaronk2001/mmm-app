import { useState } from 'react';
import { ExternalLink as ExternalLinkIcon } from 'lucide-react';
import { useApi } from '../../../../../lib/query';
import Card from '../../../shared/Card';
import Skeleton from '../../../shared/Skeleton';
import ErrorState from '../../../shared/ErrorState';
import { StatusChip, tileStyle, num, ExternalLink, fmtWhen, relativeWhen, hostOf } from './common';

// The full headline list. `all` hits GET /api/news/market (general market
// headlines); picking a watchlist symbol hits GET /api/news/:ticker. The
// server already normalized every row to { id, title, url, source,
// published_at, summary, symbols[] }, so nothing here knows a provider name.

const ALL = 'all';

export default function News() {
  const [symbol, setSymbol] = useState(ALL);
  const { data: wl } = useApi('market/watchlist');
  const path = symbol === ALL ? 'news/market' : `news/${encodeURIComponent(symbol)}`;
  const { data: env, isLoading, error, refetch, isFetching } = useApi(path);

  const watchlist = [...new Set((wl?.watchlist || []).map((w) => String(w.symbol).toUpperCase()))];
  const articles = env?.articles || [];

  return (
    <div style={{ marginTop: 16 }}>
      <Card hoverable={false}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 14, flexWrap: 'wrap' }}>
          <label htmlFor="news-symbol" style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>Filter</label>
          <select
            id="news-symbol"
            className="m-input"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            style={{ minWidth: 180 }}
          >
            <option value={ALL}>All market news</option>
            {watchlist.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" className="m-btn m-btn-secondary m-btn-sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
          <span style={{ flex: 1 }} />
          {articles.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--m-muted)', ...num }}>{articles.length} headlines</span>
          )}
          {env && <StatusChip stale={env.stale} offline={env.offline} cached_at={env.cached_at} />}
        </div>
      </Card>

      {isLoading ? (
        <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={92} />)}
        </div>
      ) : error ? (
        <div style={{ marginTop: 16 }}><ErrorState message={error.message} onRetry={() => refetch()} /></div>
      ) : articles.length === 0 ? (
        <div style={{ marginTop: 16, color: 'var(--m-ink-2)', fontSize: 13 }}>
          {env?.reason || 'No headlines yet — turn on Market news in Settings → Online & Keys.'}
        </div>
      ) : (
        <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
          {articles.map((a) => <Article key={a.id} article={a} />)}
        </div>
      )}
    </div>
  );
}

function Article({ article }) {
  const when = fmtWhen(article.published_at);
  const host = article.source || hostOf(article.url);
  return (
    <Card style={tileStyle} hoverable={false}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12, color: 'var(--m-muted)' }}>
        {host && <span style={{ color: 'var(--m-accent)', fontWeight: 600 }}>{host}</span>}
        {when && <span title={when} style={num}>{relativeWhen(article.published_at)}</span>}
      </div>
      <ExternalLink
        href={article.url}
        style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, marginTop: 6, fontSize: 15, fontWeight: 600, color: 'var(--m-ink)' }}
      >
        {article.title}
        {article.url && <ExternalLinkIcon size={13} aria-hidden="true" style={{ color: 'var(--m-accent)', flexShrink: 0 }} />}
      </ExternalLink>
      {article.summary && (
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--m-ink-2)', lineHeight: 1.5 }}>{article.summary}</p>
      )}
      {article.symbols.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {article.symbols.slice(0, 8).map((s) => (
            <span
              key={s}
              style={{ fontSize: 11, fontWeight: 600, color: 'var(--m-ink-2)', border: '1px solid var(--m-border)',
                borderRadius: 999, padding: '1px 8px', ...num }}
            >
              {s}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
