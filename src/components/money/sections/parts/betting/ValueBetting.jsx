import { useMemo, useState } from 'react';
import { useApi } from '../../../../../lib/query';
import { valueEdge, americanToDecimal, expectedValue } from '../../../../../lib/odds';
import Card from '../../../shared/Card';
import Skeleton from '../../../shared/Skeleton';
import ErrorState from '../../../shared/ErrorState';
import EmptyState from '../../../shared/EmptyState';
import { StatusChip, tileStyle, num, fAmerican, fProb, fPctPts, fMoney, fWhen, Pill, InfoOnlyNote, th, thR, td, tdR } from './common';

// Two views of the same board, both arithmetic on prices the server already
// fetched — no extra endpoint, and nothing here is a recommendation to stake
// anything:
//   Value  — a book's price vs. the vig-free consensus of every book quoting
//            that game. Computed on the client with src/lib/odds.js (the ESM
//            mirror of server/betting/odds.js) off GET /betting/sports-odds.
//   Arbitrage — GET /betting/arbitrage, where two books disagree enough that
//            both sides can be covered. The stake split shown is the
//            illustrative one that makes both outcomes pay the same.

const MIN_EDGES = [
  { id: 0.01, label: '1.0 pts' },
  { id: 0.02, label: '2.0 pts' },
  { id: 0.03, label: '3.0 pts' },
  { id: 0.05, label: '5.0 pts' },
];

export default function ValueBetting() {
  const [sport, setSport] = useState('americanfootball_nfl');
  const [minEdge, setMinEdge] = useState(0.02);
  const [minProfit, setMinProfit] = useState(0.5);

  const { data: listEnv } = useApi('betting/sports-list');
  const { data: oddsEnv, isLoading, error } = useApi(`betting/sports-odds?sport=${encodeURIComponent(sport)}&markets=h2h&limit=20`);
  const { data: arbEnv, isLoading: arbLoading } = useApi(`betting/arbitrage?minProfit=${minProfit}&limit=20`);

  const sports = listEnv?.sports || [];
  const rows = useMemo(() => valueRows(oddsEnv?.events || [], minEdge), [oddsEnv, minEdge]);
  const arbs = arbEnv?.opportunities || [];

  return (
    <div style={{ marginTop: 16 }}>
      <Card hoverable={false}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 14, flexWrap: 'wrap' }}>
          <label htmlFor="vb-sport" style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>Sport</label>
          <select id="vb-sport" className="m-input" value={sport} onChange={(e) => setSport(e.target.value)} style={{ minWidth: 200 }}>
            {sports.map((s) => <option key={s.key} value={s.key}>{s.group ? `${s.group} — ${s.title}` : s.title}</option>)}
          </select>

          <label htmlFor="vb-edge" style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>Min edge</label>
          <select id="vb-edge" className="m-input" value={minEdge} onChange={(e) => setMinEdge(Number(e.target.value))} style={{ minWidth: 110 }}>
            {MIN_EDGES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>

          <label htmlFor="vb-profit" style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>Min arb return</label>
          <select id="vb-profit" className="m-input" value={minProfit} onChange={(e) => setMinProfit(Number(e.target.value))} style={{ minWidth: 100 }}>
            {[0.1, 0.5, 1, 2].map((p) => <option key={p} value={p}>{p}%</option>)}
          </select>

          <span style={{ flex: 1 }} />
          {oddsEnv && <StatusChip stale={oddsEnv.stale} offline={oddsEnv.offline} cached_at={oddsEnv.cached_at} />}
        </div>
      </Card>

      <h3 style={{ margin: '20px 0 0', fontSize: 14, fontWeight: 700, color: 'var(--m-ink)' }}>Value vs. the market</h3>
      {isLoading ? (
        <div style={{ marginTop: 10 }}><Skeleton height={180} /></div>
      ) : error ? (
        <div style={{ marginTop: 10 }}><ErrorState message={error.message} /></div>
      ) : rows.length === 0 ? (
        <div style={{ marginTop: 10 }}>
          <EmptyState
            title="No prices beating the consensus"
            message={oddsEnv?.needsKey
              ? 'Sports odds need a free Odds API key — add it under Settings → Online & Keys, then turn the feature on.'
              : 'Every book on this board is priced at or behind the vig-free consensus at the current threshold. Lower the minimum edge or pick another sport.'}
          />
        </div>
      ) : (
        <Card className="m-card-sm" style={{ marginTop: 10, overflowX: 'auto' }} hoverable={false}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--m-border)' }}>
                <th style={th}>Game</th>
                <th style={th}>Side</th>
                <th style={th}>Book</th>
                <th style={thR}>Price</th>
                <th style={thR}>Implied</th>
                <th style={thR}>Fair</th>
                <th style={thR}>Edge</th>
                <th style={thR}>EV / $100</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--m-border)' }}>
                  <td style={td}>{r.game}</td>
                  <td style={td}>{r.team}</td>
                  <td style={td}>{r.book}</td>
                  <td style={tdR}>{fAmerican(r.odds)}</td>
                  <td style={tdR}>{fProb(r.impliedProb)}</td>
                  <td style={tdR}>{fProb(r.fair)}</td>
                  <td style={{ ...tdR, color: 'var(--m-green)', fontWeight: 600 }}>{fPctPts(r.edge)}</td>
                  <td style={tdR}>{fMoney(r.ev * 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <h3 style={{ margin: '24px 0 0', fontSize: 14, fontWeight: 700, color: 'var(--m-ink)' }}>Cross-book arbitrage</h3>
      {arbLoading ? (
        <div style={{ marginTop: 10 }}><Skeleton height={140} /></div>
      ) : arbs.length === 0 ? (
        <div style={{ marginTop: 10 }}>
          <EmptyState
            title="No arbitrage on the board"
            message={arbEnv?.needsKey
              ? 'This scan reads The Odds API and needs a key. Add it under Settings → Online & Keys.'
              : `Scanned ${arbEnv?.scanned ?? 0} games across the major US leagues — no two books are far enough apart to cover both sides at this threshold. That is the normal state of the market.`}
          />
        </div>
      ) : (
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {arbs.map((a) => (
            <Card key={a.id} style={tileStyle} hoverable={false}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--m-ink)' }}>{a.event}</div>
                <span style={{ flex: 1 }} />
                <Pill tone="green">{a.profitPct.toFixed(2)}% return</Pill>
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--m-muted)' }}>{fWhen(a.commenceTime)}</div>
              <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                <Leg leg={a.a} />
                <Leg leg={a.b} />
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--m-ink-2)', ...num }}>
                Illustrative split of {fMoney(a.totalStake, 0)}: both outcomes return {fMoney(a.payout)} ({fMoney(a.profit)} over the outlay).
              </div>
            </Card>
          ))}
        </div>
      )}

      <InfoOnlyNote>Edges assume every book quoting the game is equally informed, and the lines move — treat both tables as a read on the market, not a plan.</InfoOnlyNote>
    </div>
  );
}

function Leg({ leg }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13 }}>
      <span style={{ color: 'var(--m-ink)', fontWeight: 600 }}>{leg.team}</span>
      <span style={{ color: 'var(--m-muted)' }}>at {leg.book}</span>
      <span style={{ flex: 1 }} />
      <span style={{ color: 'var(--m-ink)', ...num }}>{fAmerican(leg.odds)}</span>
      <span style={{ color: 'var(--m-ink-2)', ...num }}>{fMoney(leg.stake)}</span>
    </div>
  );
}

// Every (book, side) price on the board vs. that game's vig-free consensus.
export function valueRows(events, minEdge) {
  const out = [];
  for (const e of events) {
    const fair = e.consensus;
    if (!fair) continue;
    for (const bk of e.bookmakers || []) {
      for (const [side, team, p] of [['homeOdds', e.homeTeam, fair.home], ['awayOdds', e.awayTeam, fair.away]]) {
        const price = bk.markets?.h2h?.[side];
        const v = valueEdge(p, price);
        if (!v || v.edge < minEdge) continue;
        out.push({
          id: `${e.id}:${bk.key || bk.name}:${side}`,
          game: `${e.awayTeam} @ ${e.homeTeam}`,
          team,
          book: bk.name,
          odds: price,
          impliedProb: v.impliedProb,
          fair: p,
          edge: v.edge,
          ev: expectedValue(p, americanToDecimal(price)),
        });
      }
    }
  }
  return out.sort((a, b) => b.edge - a.edge);
}
