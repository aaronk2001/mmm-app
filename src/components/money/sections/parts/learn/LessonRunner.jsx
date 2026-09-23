import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X, PartyPopper, RotateCcw } from 'lucide-react';
import { api, useApi, queryClient } from '../../../../../lib/query';
import { toast } from '../../../../../lib/toast';
import Skeleton from '../../../shared/Skeleton';
import ErrorState from '../../../shared/ErrorState';
import StepView from './StepView';
import { findResumeStepIndex, passesMasteryGate, shouldHandleEscapeKey } from './resume';

function SourceFooter({ source, licenseNote }) {
  if (!source || source.id === 'original-mmm') return null;
  return (
    <div style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid var(--m-border)', fontSize: 11, color: 'var(--m-muted)', lineHeight: 1.5 }}>
      {licenseNote && <div>{licenseNote}</div>}
      <div>
        Source: <a href={source.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--m-muted)' }}>{source.title}</a> — {source.license}. {source.attribution}
      </div>
    </div>
  );
}

function EndScreen({ lesson, lessonProgress, onReview, onBackToLessons }) {
  const gateOk = passesMasteryGate({ gate: lesson.gate, scorePct: lessonProgress?.score_pct, applyActionDone: lessonProgress?.apply_action_done });
  return (
    <div style={{ display: 'grid', gap: 16, textAlign: 'center', padding: '32px 12px' }}>
      <PartyPopper size={36} style={{ color: 'var(--m-accent)', justifySelf: 'center' }} aria-hidden="true" />
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--m-ink)' }}>Lesson complete</div>
      {lessonProgress?.score_pct != null && (
        <div style={{ fontSize: 13, color: 'var(--m-ink-2)' }}>Score: <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{lessonProgress.score_pct}%</strong></div>
      )}
      {lesson.gate && !gateOk && (
        <div role="status" style={{ fontSize: 13, color: 'var(--m-amber)', maxWidth: 420, justifySelf: 'center' }}>
          This is a mastery-gated lesson — it wants a score of 80%+ and the apply step actually done. You can review the
          check question or come back and apply the action to fully master it.
        </div>
      )}
      {lesson.gate && gateOk && (
        <div style={{ fontSize: 13, color: 'var(--m-green)' }}>Mastered — nice work.</div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button className="m-btn m-btn-secondary" onClick={onReview}><RotateCcw size={14} style={{ marginRight: 6 }} aria-hidden="true" />Review lesson</button>
        <button className="m-btn m-btn-primary" onClick={onBackToLessons}>Back to lessons</button>
      </div>
      <SourceFooter source={lesson.source} licenseNote={lesson.license_note} />
    </div>
  );
}

export default function LessonRunner() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useApi(`learn/lessons/${id}`);

  const [steps, setSteps] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [lessonProgress, setLessonProgress] = useState(null);
  const [finished, setFinished] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [applySubmitting, setApplySubmitting] = useState(false);
  const [applyError, setApplyError] = useState(null);
  const liveRef = useRef(null);
  const startedRef = useRef(false);

  // Seed local state once, and resume at the first not-yet-recorded step —
  // this IS the "Esc saved my position" behaviour: it's just reading back
  // what the server already persisted (see resume.js's header comment).
  useEffect(() => {
    if (!data || steps) return;
    setSteps(data.steps);
    setLessonProgress({ status: data.status, score_pct: data.score_pct, apply_action_done: data.apply_action_done });
    if (data.status === 'completed') { setFinished(true); setStepIndex(data.steps.length - 1); }
    else setStepIndex(findResumeStepIndex(data.steps));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (startedRef.current || !data) return;
    startedRef.current = true;
    api(`learn/lessons/${id}/start`, { method: 'POST' }).catch(() => {});
  }, [data, id]);

  // Esc exits back to the lesson list. Nothing extra to persist here: every
  // step already recorded (skipped/correct/wrong/applied) is durable on the
  // server the moment it happened; only the currently-unsubmitted step's
  // draft (an unselected radio, an unconfirmed apply form) is discarded,
  // which is correct — it was never "finished".
  useEffect(() => {
    function onKey(e) {
      if (shouldHandleEscapeKey(e)) navigate('/learn');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const stepRef = useRef(null);
  useEffect(() => {
    stepRef.current?.focus();
  }, [stepIndex, finished]);

  if (isLoading || !data) return <div style={{ maxWidth: 640, margin: '0 auto' }}><Skeleton height={280} /></div>;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;
  if (!steps) return null;

  const checkStepIndex = steps.find((s) => s.type === 'check')?.index ?? null;
  const step = steps[stepIndex];

  function patchStep(idx, status) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, progress: { status } } : s)));
  }

  function afterAdvance(nextProgress) {
    setLessonProgress(nextProgress);
    if (nextProgress?.status === 'completed') {
      setFinished(true);
      queryClient.invalidateQueries({ queryKey: ['learn/lessons'] });
    } else {
      setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    }
  }

  async function handleContinue() {
    setSubmitting(true);
    try {
      const res = await api(`learn/lessons/${id}/steps/${stepIndex}`, { method: 'POST', body: JSON.stringify({ status: 'skipped' }) });
      patchStep(stepIndex, 'skipped');
      afterAdvance(res.lessonProgress);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckAnswer(selectedKey) {
    setSubmitting(true);
    try {
      const res = await api(`learn/lessons/${id}/check`, { method: 'POST', body: JSON.stringify({ stepIndex, selectedKey }) });
      patchStep(stepIndex, res.correct ? 'correct' : 'wrong');
      setLessonProgress(res.lessonProgress);
      if (res.lessonProgress?.status === 'completed') {
        setFinished(true);
        queryClient.invalidateQueries({ queryKey: ['learn/lessons'] });
      }
      return { correct: res.correct, correctAnswer: res.correctAnswer, rationale: res.rationale };
    } catch (err) {
      toast.error(err.message);
      return { correct: false, correctAnswer: null, rationale: 'Something went wrong grading that — try again.' };
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApply(params) {
    setApplySubmitting(true);
    setApplyError(null);
    try {
      const res = await api(`learn/lessons/${id}/apply`, { method: 'POST', body: JSON.stringify({ params }) });
      patchStep(stepIndex, 'correct');
      toast.success('Applied — you can undo this any time from Activity.');
      afterAdvance(res.lessonProgress);
    } catch (err) {
      setApplyError(err.message);
    } finally {
      setApplySubmitting(false);
    }
  }

  async function handleSkipApply() {
    await handleContinue();
  }

  async function handleTestMeOut() {
    if (checkStepIndex == null) return;
    setSubmitting(true);
    try {
      let last = lessonProgress;
      for (let i = stepIndex; i < checkStepIndex; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const res = await api(`learn/lessons/${id}/steps/${i}`, { method: 'POST', body: JSON.stringify({ status: 'skipped' }) });
        patchStep(i, 'skipped');
        last = res.lessonProgress;
      }
      setLessonProgress(last);
      setStepIndex(checkStepIndex);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function reviewFromStart() {
    setFinished(false);
    setStepIndex(0);
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--m-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{data.module}</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--m-ink)' }}>{data.title}</div>
        </div>
        <button type="button" className="m-btn m-btn-icon m-btn-secondary" aria-label="Exit lesson (Esc)" title="Exit (Esc)" onClick={() => navigate('/learn')}>
          <X size={16} />
        </button>
      </div>

      {!finished && (
        <div aria-hidden="true" style={{ height: 4, borderRadius: 999, background: 'var(--m-surface-2)', marginBottom: 20, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.round(((stepIndex + 1) / steps.length) * 100)}%`, background: 'var(--m-accent)', transition: 'width 200ms ease' }} />
        </div>
      )}
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        {finished ? 'Lesson complete' : `Step ${stepIndex + 1} of ${steps.length}: ${step?.type}`}
      </div>

      <div tabIndex={-1} ref={stepRef}>
        {finished ? (
          <EndScreen lesson={data} lessonProgress={lessonProgress} onReview={reviewFromStart} onBackToLessons={() => navigate('/learn')} />
        ) : (
          <StepView
            step={step}
            lessonId={id}
            personalizes={data.personalizes}
            variables={data.variables}
            onContinue={handleContinue}
            onCheckAnswer={handleCheckAnswer}
            onApply={handleApply}
            onSkipApply={handleSkipApply}
            onTestMeOut={handleTestMeOut}
            isFirstStep={stepIndex === 0}
            isCheckStep={step?.type === 'check'}
            checkStepIndex={checkStepIndex != null && checkStepIndex > stepIndex ? checkStepIndex : null}
            applySubmitting={applySubmitting}
            applyError={applyError}
            submitting={submitting}
          />
        )}
        {!finished && <SourceFooter source={data.source} licenseNote={data.license_note} />}
      </div>
    </div>
  );
}
