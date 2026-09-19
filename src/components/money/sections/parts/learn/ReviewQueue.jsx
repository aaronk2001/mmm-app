import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, PartyPopper } from 'lucide-react';
import { api, useApi } from '../../../../../lib/query';
import { toast } from '../../../../../lib/toast';
import Skeleton from '../../../shared/Skeleton';
import ErrorState from '../../../shared/ErrorState';
import { shouldHandleEscapeKey } from './resume';

// Mirrors server/learn/fsrs.js's SESSION_CARD_CAP/SESSION_MINUTES_CAP. Those
// constants live in a server-only module (it requires ts-fsrs, a server
// dependency), so the cap is restated here rather than imported — the
// server already enforces the 20-card cap when it builds the session
// (fsrs.selectSessionCards), this is only the client-side 7-minute clock.
const SESSION_MINUTES_CAP = 7;

const RATINGS = [
  { key: 'again', label: 'Again', hint: "Didn't recall it", color: 'var(--m-red)' },
  { key: 'hard', label: 'Hard', hint: 'Recalled with effort', color: 'var(--m-amber)' },
  { key: 'good', label: 'Good', hint: 'Recalled it', color: 'var(--m-accent)' },
  { key: 'easy', label: 'Easy', hint: 'Instant recall', color: 'var(--m-green)' },
];

function EndScreen({ cardsReviewed, correctCount, onBack }) {
  const accuracyPct = cardsReviewed > 0 ? Math.round((100 * correctCount) / cardsReviewed) : null;
  const message = cardsReviewed === 0
    ? 'No cards were due today — you are all caught up.'
    : `Nice work — you reviewed ${cardsReviewed} card${cardsReviewed === 1 ? '' : 's'} today.`;
  return (
    <div style={{ display: 'grid', gap: 16, textAlign: 'center', padding: '32px 12px' }}>
      <PartyPopper size={36} style={{ color: 'var(--m-accent)', justifySelf: 'center' }} aria-hidden="true" />
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--m-ink)' }}>{message}</div>
      {accuracyPct != null && (
        <div style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>Recall rate: <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{accuracyPct}%</strong></div>
      )}
      <button type="button" className="m-btn m-btn-primary" style={{ justifySelf: 'center' }} onClick={onBack}>Back to lessons</button>
    </div>
  );
}

export default function ReviewQueue() {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useApi('learn/review/session');
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const startRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => {
    if (startRef.current == null) startRef.current = Date.now();
  }, []);

  useEffect(() => {
    cardRef.current?.focus();
  }, [index]);

  useEffect(() => {
    function onKey(e) {
      if (shouldHandleEscapeKey(e)) navigate('/learn');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  if (isLoading) return <div style={{ maxWidth: 600, margin: '0 auto' }}><Skeleton height={240} /></div>;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  const cards = data?.cards || [];
  const finished = timedOut || index >= cards.length;
  const card = cards[index];

  async function grade(rating) {
    setSubmitting(true);
    try {
      await api(`learn/review/${card.id}/grade`, { method: 'POST', body: JSON.stringify({ answer: rating }) });
      setReviewed((n) => n + 1);
      if (rating === 'good' || rating === 'easy') setCorrect((n) => n + 1);
      const elapsedSeconds = (Date.now() - (startRef.current || Date.now())) / 1000;
      if (elapsedSeconds >= SESSION_MINUTES_CAP * 60) setTimedOut(true);
      else { setRevealed(false); setIndex((i) => i + 1); }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        {finished ? 'Review session complete' : `Card ${index + 1} of ${cards.length}`}
      </div>
      <div tabIndex={-1} ref={cardRef}>
        {finished ? (
          <EndScreen cardsReviewed={reviewed} correctCount={correct} onBack={() => navigate('/learn')} />
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--m-accent)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Review {index + 1} of {cards.length}{card.lesson_title ? ` — ${card.lesson_title}` : ''}
            </div>
            {card.sample && (
              <div role="status" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--m-amber)' }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                <span>This card references sample figures, not your real numbers.</span>
              </div>
            )}
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--m-ink)' }}>{card.question}</div>
            {!!card.options?.length && (
              <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--m-ink-2)', fontSize: 14, lineHeight: 1.6 }}>
                {card.options.map((o) => <li key={o.key}><strong>{o.key}.</strong> {o.text}</li>)}
              </ul>
            )}
            {!revealed ? (
              <button type="button" className="m-btn m-btn-secondary" style={{ justifySelf: 'start' }} onClick={() => setRevealed(true)}>
                I've recalled my answer
              </button>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--m-ink-2)' }}>How did that go?</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {RATINGS.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      className="m-btn"
                      disabled={submitting}
                      onClick={() => grade(r.key)}
                      title={r.hint}
                      style={{ borderColor: r.color, color: r.color, fontWeight: 600 }}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
