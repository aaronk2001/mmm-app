import { useState } from 'react';
import { useApi } from '../../../../../lib/query';
import Card from '../../../shared/Card';
import Skeleton from '../../../shared/Skeleton';
import ErrorState from '../../../shared/ErrorState';
import EmptyState from '../../../shared/EmptyState';
import { StatusChip, tileStyle, num, fAmerican, fProb, fWhen, timeUntil, Pill, InfoOnlyNote, th, thR, td, tdR } from './common';

// GET /api/betting/sports-list + /sports-odds. This is the one betting tab
// that needs a key (The Odds API): without one the server returns a cached /
// offline envelope with needsKey, and this renders the "add a key" empty
// state instead of an error.

export default function SportsOdds() {
  const [sport, setSport] = useState('americanfootball_nfl');
  const { data: listEnv } = useApi('betting/sports-list');
  const { data: env, isLoading, error, refetch, isFetching } = useApi(`betting/sports-odds?sport=${encodeURIComponent(sport)}&markets=h2h&limit=20`);

  const sports = listEnv?.sports || [];
  const events = env?.events || [];

  return (
    <div style={{ marginTop: 16 }}>
      <Card hoverable={false}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 14, flexWrap: 'wrap' }}>
          <label htmlFor="so-sport" style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>Sport</label>
          <select id="so-sport" className="m-input" value={sport} onChange={(e) => setSport(e.target.value)} style={{ minWidth: 220 }}>
            {sports.map((s) => <option key={s.key} value={s.key}>{s.group ? `${s.group} — ${s.title}` : s.title}</option>)}
          </select>
          <button type="button" className="m-btn m-btn-secondary m-btn-sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
          <span style={{ flex: 1 }} />
          {events.length > 0 && <span style={{ fontSize: 12, color: 'var(--m-muted)', ...num }}>{events.length} games</span>}
          {env && <StatusChip stale={env.stale} offline={env.offline} cached_at={env.cached_at} />}
        </div>
      </Card>

      {isLoading ? (
        <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={180} />)}
        </div>
      ) : error ? (
        <div style={{ marginTop: 16 }}><ErrorState message={error.message} /></div>
      ) : events.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState
            title={env?.needsKey ? 'No Odds API key stored' : 'No games listed'}
            message={env?.needsKey
              ? 'Sports odds come from The Odds API, which needs a free key. Add it under Settings → Online & Keys (Sports odds), then turn the feature on. Prediction markets need no key and keep working meanwhile.'
              : 'Nothing scheduled for this sport right now, or Sports odds is off in Settings. Pick another sport or check back closer to game day.'}
          />
        </div>
      ) : (
        <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
          {events.map((e) => <EventCard key={e.id} event={e} />)}
        </div>
      )}

      <InfoOnlyNote>Best price is the highest of the books quoted above; the fair line strips each book&apos;s vig and averages them.</InfoOnlyNote>
    </div>
  );
}

function EventCard({ event }) {
  const books = event.bookmakers || [];
  return (
    <Card style={tileStyle} hoverable={false}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--m-ink)' }}>{event.awayTeam} @ {event.homeTeam}</div>
        <span style={{ flex: 1 }} />
        <Pill>{timeUntil(event.commenceTime)}</Pill>
        <span style={{ fontSize: 12, color: 'var(--m-muted)' }}>{fWhen(event.commenceTime)}</span>
      </div>

      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <BestBox label={`${event.homeTeam} (home)`} best={event.bestOdds?.home} fair={event.consensus?.home} />
        <BestBox label={`${event.awayTeam} (away)`} best={event.bestOdds?.away} fair={event.consensus?.away} />
      </div>

      {books.length > 0 && (
        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--m-border)' }}>
                <th style={th}>Book</th>
                <th style={thR}>{event.homeTeam}</th>
                <th style={thR}>{event.awayTeam}</th>
                <th style={thR}>Hold</th>
              </tr>
            </thead>
            <tbody>
              {books.map((b) => {
                const home = b.markets?.h2h?.homeOdds;
                const away = b.markets?.h2h?.awayOdds;
                const hold = holdPct(home, away);
                return (
                  <tr key={b.key || b.name} style={{ borderBottom: '1px solid var(--m-border)' }}>
                    <td style={td}>{b.name}</td>
                    <td style={tdR}>{fAmerican(home)}</td>
                    <td style={tdR}>{fAmerican(away)}</td>
                    <td style={{ ...tdR, color: 'var(--m-ink-2)' }}>{hold == null ? '—' : `${hold.toFixed(1)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// The book's margin on a two-way market: how far the two quoted prices sum
// past 100%. Computed inline (one subtraction) rather than routed through
// src/lib/odds.js's removeVig, which returns the normalised probabilities.
function holdPct(home, away) {
  const p = (o) => {
    const n = Number(o);
    if (!Number.isFinite(n) || n === 0) return null;
    return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
  };
  const a = p(home); const b = p(away);
  if (a == null || b == null) return null;
  return (a + b - 1) * 100;
}

function BestBox({ label, best, fair }) {
  return (
    <div style={{ background: 'var(--m-surface-2)', border: '1px solid var(--m-border)', borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--m-ink-2)' }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 20, fontWeight: 700, color: 'var(--m-ink)', ...num }}>{fAmerican(best?.odds)}</div>
      <div style={{ fontSize: 12, color: 'var(--m-muted)' }}>{best?.book ? `best at ${best.book}` : 'no price quoted'}</div>
      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--m-ink-2)', ...num }}>
        implied {fProb(best?.impliedProb)} · fair {fProb(fair)}
      </div>
    </div>
  );
}
