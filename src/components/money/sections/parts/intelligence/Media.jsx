import { useState } from 'react';
import { ExternalLink as ExternalLinkIcon } from 'lucide-react';
import Card from '../../../shared/Card';
import { tileStyle, ExternalLink } from './common';

// Ported from NEXUS's src/components/media/MediaFeed.jsx. That component is a
// *curated static directory* — investors, channels, and podcasts with plain
// search links. It calls no API and needs no key, which is why it survives
// the port while the YouTube data feed does not. Nothing here fetches.
//
// Two deliberate changes from NEXUS: the per-person hex colours become
// var(--m-chart-N) (semantic tokens only), and window.open() becomes a real
// anchor with target=_blank rel="noopener noreferrer" so Electron's
// setWindowOpenHandler routes the click to the OS browser.

const yt = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

const INVESTORS = [
  { id: 'ramsey', name: 'Dave Ramsey', topics: ['Baby Steps', 'Debt snowball', 'Budgeting', 'Emergency fund'],
    desc: 'Debt-free living, zero-based budgeting, Baby Steps framework',
    youtube: yt('Dave Ramsey financial advice'), podcast: yt('Dave Ramsey Show podcast') },
  { id: 'buffett', name: 'Warren Buffett', topics: ['Value investing', 'Berkshire meetings', 'Shareholder letters', 'Moats'],
    desc: 'Value investing, long-term compounding, Berkshire Hathaway annual meetings',
    youtube: yt('Warren Buffett investing advice'), podcast: yt('Warren Buffett annual meeting') },
  { id: 'graham', name: 'Benjamin Graham', topics: ['Graham Number', 'Net-net stocks', 'Margin of safety', 'Value analysis'],
    desc: 'The Intelligent Investor — foundational value investing philosophy',
    youtube: yt('Benjamin Graham intelligent investor'), podcast: yt('intelligent investor book summary') },
  { id: 'lynch', name: 'Peter Lynch', topics: ['GARP', 'PEG ratio', '10-baggers', 'One Up on Wall Street'],
    desc: 'Growth at a reasonable price, invest in what you know, 10-baggers',
    youtube: yt('Peter Lynch stock picking advice'), podcast: yt('Peter Lynch invest what you know') },
  { id: 'dalio', name: 'Ray Dalio', topics: ['All Weather', 'Debt cycles', 'Risk parity', 'Principles'],
    desc: 'Macro economics, debt cycles, All Weather Portfolio, radical transparency',
    youtube: yt('Ray Dalio principles economy'), podcast: yt('Ray Dalio how the economic machine works') },
  { id: 'bogle', name: 'John Bogle', topics: ['Index funds', 'Low costs', 'Vanguard', 'Stay the course'],
    desc: 'Vanguard founder, passive index fund investing, the cost of Wall Street',
    youtube: yt('John Bogle index fund investing'), podcast: yt('Jack Bogle Vanguard interview') },
  { id: 'cuban', name: 'Mark Cuban', topics: ['Equity building', 'Cash reserve', 'Hustle', 'Business ownership'],
    desc: 'Entrepreneurship, equity over salary, eliminating debt, building cash reserves',
    youtube: yt('Mark Cuban money business advice'), podcast: yt('Mark Cuban entrepreneur financial advice') },
  { id: 'kiyosaki', name: 'Robert Kiyosaki', topics: ['Cash flow', 'Real estate', 'Assets vs liabilities', 'Financial IQ'],
    desc: 'Rich Dad Poor Dad, cash-flowing assets, real estate investing, financial education',
    youtube: yt('Robert Kiyosaki rich dad poor dad'), podcast: yt('Rich Dad Radio Show podcast') },
  { id: 'taleb', name: 'Nassim Taleb', topics: ['Antifragility', 'Black Swans', 'Barbell strategy', 'Tail risk'],
    desc: 'Black Swan events, antifragility, barbell strategy, tail risk protection',
    youtube: yt('Nassim Taleb antifragile black swan'), podcast: yt('Nassim Taleb interview risk uncertainty') },
];

const CHANNELS = [
  { name: 'Andrei Jikh', tag: 'Personal Finance', desc: 'Passive income, investing, crypto, personal finance', url: yt('Andrei Jikh investing') },
  { name: 'Graham Stephan', tag: 'Real Estate', desc: 'Real estate, stocks, frugality, wealth building', url: yt('Graham Stephan investing') },
  { name: 'The Plain Bagel', tag: 'Education', desc: 'Evidence-based finance, debunking myths, ETFs', url: yt('The Plain Bagel finance') },
  { name: 'Two Cents (PBS)', tag: 'Education', desc: 'Financial literacy for everyday people', url: yt('Two Cents PBS finance') },
  { name: 'Joseph Carlson', tag: 'Dividends', desc: 'Dividend growth investing, portfolio reviews', url: yt('Joseph Carlson dividend investing') },
  { name: 'Aswath Damodaran', tag: 'Valuation', desc: 'NYU professor — intrinsic value, valuation models', url: yt('Aswath Damodaran valuation') },
  { name: 'Patrick Boyle', tag: 'Macro', desc: 'Hedge fund manager, macro + quant finance', url: yt('Patrick Boyle finance') },
  { name: 'BiggerPockets', tag: 'Real Estate', desc: 'Real estate investing, rental properties, FIRE', url: yt('BiggerPockets real estate investing') },
];

const PODCASTS = [
  { name: 'We Study Billionaires', tag: 'Value', desc: 'Warren Buffett, value investing, Berkshire deep dives', url: yt('We Study Billionaires podcast') },
  { name: 'Invest Like the Best', tag: 'Interviews', desc: 'Patrick O’Shaughnessy interviews top investors', url: yt('Invest Like the Best podcast') },
  { name: 'Planet Money (NPR)', tag: 'Macro', desc: 'Economics storytelling, how money systems work', url: yt('Planet Money NPR podcast') },
  { name: 'Motley Fool Money', tag: 'Stocks', desc: 'Stock picks, earnings analysis, market news', url: yt('Motley Fool Money podcast') },
  { name: 'BiggerPockets Money', tag: 'FIRE', desc: 'FIRE, frugality, real estate, early retirement', url: yt('BiggerPockets Money podcast') },
  { name: 'How I Built This', tag: 'Founders', desc: 'Founder stories — equity, risk, entrepreneurship', url: yt('How I Built This NPR podcast') },
  { name: 'Masters in Business', tag: 'Macro', desc: 'Bloomberg — deep interviews with finance legends', url: yt('Masters in Business Bloomberg podcast') },
  { name: 'The Rational Reminder', tag: 'Evidence', desc: 'Evidence-based investing, factor models, Bogle-aligned', url: yt('Rational Reminder podcast index investing') },
];

const GROUPS = [
  { id: 'investors', label: 'Investors' },
  { id: 'channels', label: 'Channels' },
  { id: 'podcasts', label: 'Podcasts' },
];

const accent = (i) => `var(--m-chart-${(i % 8) + 1})`;

export default function Media() {
  const [group, setGroup] = useState('investors');
  return (
    <div style={{ marginTop: 16 }}>
      <Card hoverable={false}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 14, flexWrap: 'wrap' }}>
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`m-btn m-btn-sm ${group === g.id ? 'm-btn-primary' : 'm-btn-secondary'}`}
              aria-pressed={group === g.id}
              onClick={() => setGroup(g.id)}
            >
              {g.label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--m-muted)' }}>Curated links — opens in your browser</span>
        </div>
      </Card>

      {group === 'investors' ? (
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {INVESTORS.map((p, i) => (
            <Card key={p.id} style={tileStyle} hoverable={false}>
              <div style={{ fontSize: 15, fontWeight: 700, color: accent(i) }}>{p.name}</div>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--m-ink-2)', lineHeight: 1.5 }}>{p.desc}</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {p.topics.map((t) => (
                  <span key={t} style={{ fontSize: 11, color: 'var(--m-ink-2)', border: '1px solid var(--m-border)', borderRadius: 999, padding: '1px 8px' }}>{t}</span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 14, marginTop: 12, fontSize: 12, fontWeight: 600 }}>
                <ExternalLink href={p.youtube} style={{ color: 'var(--m-accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  Videos <ExternalLinkIcon size={12} aria-hidden="true" />
                </ExternalLink>
                <ExternalLink href={p.podcast} style={{ color: 'var(--m-accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  Talks <ExternalLinkIcon size={12} aria-hidden="true" />
                </ExternalLink>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {(group === 'channels' ? CHANNELS : PODCASTS).map((c, i) => (
            <Card key={c.name} style={tileStyle} hoverable={false}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <ExternalLink href={c.url} style={{ fontSize: 15, fontWeight: 700, color: 'var(--m-ink)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  {c.name} <ExternalLinkIcon size={12} aria-hidden="true" style={{ color: 'var(--m-accent)' }} />
                </ExternalLink>
                <span style={{ fontSize: 11, fontWeight: 600, color: accent(i), border: '1px solid var(--m-border)', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>{c.tag}</span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--m-ink-2)', lineHeight: 1.5 }}>{c.desc}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
