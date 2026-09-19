import { useState } from 'react';
import { CheckCircle2, XCircle, GraduationCap } from 'lucide-react';
import LessonProse from './markdown';
import YourNumbers from './YourNumbers';
import ApplyConfirm from './ApplyConfirm';

const TYPE_LABEL = { read: 'Read', worked: 'Worked example', faded: 'Your turn', check: 'Check your understanding', apply: 'Apply it', reflect: 'Reflect' };

function StepShell({ label, children, numbers }) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--m-accent)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      {numbers}
      {children}
    </div>
  );
}

// Closed-book: the correct answer / rationale are never in this component's
// props until after handleAnswer's response comes back — server/learn/
// routes.js strips them from the lesson-detail payload up front.
function CheckStep({ step, onAnswer, onContinue, submitting }) {
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null); // { correct, correctAnswer, rationale }

  async function choose(key) {
    if (result) return;
    setSelected(key);
    const r = await onAnswer(key);
    setResult(r);
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--m-ink)' }}>{step.question}</div>
      <div role="radiogroup" aria-label="Answer choices" style={{ display: 'grid', gap: 8 }}>
        {step.options.map((o) => {
          const isSelected = selected === o.key;
          const isCorrectChoice = result && o.key === result.correctAnswer;
          const isWrongChoice = result && isSelected && !result.correct;
          const bg = isCorrectChoice ? 'var(--m-green-bg)' : isWrongChoice ? 'var(--m-red-bg)' : undefined;
          const border = isCorrectChoice ? 'var(--m-green)' : isWrongChoice ? 'var(--m-red)' : 'var(--m-border)';
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={!!result || submitting}
              onClick={() => choose(o.key)}
              className="m-btn"
              style={{
                justifyContent: 'flex-start', textAlign: 'left', width: '100%', fontWeight: 500,
                background: bg || 'var(--m-surface)', border: `1px solid ${border}`, color: 'var(--m-ink)',
              }}
            >
              <strong style={{ marginRight: 8 }}>{o.key}.</strong> {o.text}
              {isCorrectChoice && <CheckCircle2 size={16} style={{ marginLeft: 'auto', color: 'var(--m-green)', flexShrink: 0 }} aria-hidden="true" />}
              {isWrongChoice && <XCircle size={16} style={{ marginLeft: 'auto', color: 'var(--m-red)', flexShrink: 0 }} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {result && (
        <>
          <div role="status" style={{ fontSize: 13, color: 'var(--m-ink-2)', padding: 12, borderRadius: 8, background: 'var(--m-surface-2)' }}>
            <strong style={{ color: result.correct ? 'var(--m-green)' : 'var(--m-red)' }}>{result.correct ? 'Correct. ' : 'Not quite. '}</strong>
            {result.rationale}
          </div>
          <button type="button" className="m-btn m-btn-primary" style={{ justifySelf: 'start' }} onClick={onContinue}>Continue</button>
        </>
      )}
    </div>
  );
}

export default function StepView({
  step, lessonId, personalizes, variables, onContinue, onCheckAnswer, onApply, onSkipApply,
  isFirstStep, isCheckStep, checkStepIndex, onTestMeOut, applySubmitting, applyError, submitting,
}) {
  if (step.type === 'check') {
    return (
      <StepShell label={TYPE_LABEL.check}>
        <CheckStep step={step} onAnswer={onCheckAnswer} onContinue={onContinue} submitting={submitting} />
      </StepShell>
    );
  }

  if (step.type === 'apply') {
    return (
      <StepShell label={TYPE_LABEL.apply}>
        <ApplyConfirm action={step.action} variables={variables} submitting={applySubmitting} onConfirm={onApply} onCancel={onSkipApply} />
        {applyError && <div role="alert" style={{ fontSize: 12, color: 'var(--m-red)' }}>{applyError}</div>}
        <button type="button" className="m-btn m-btn-ghost m-btn-sm" style={{ justifySelf: 'start' }} onClick={onSkipApply} disabled={applySubmitting}>
          Skip this for now
        </button>
      </StepShell>
    );
  }

  // read / worked / faded / reflect — instructional prose, no grading.
  return (
    <StepShell
      label={TYPE_LABEL[step.type] || step.type}
      numbers={<YourNumbers personalizes={personalizes} variables={variables} />}
    >
      <LessonProse text={step.body} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" className="m-btn m-btn-primary" onClick={onContinue} disabled={submitting}>Continue</button>
        {isFirstStep && checkStepIndex != null && (
          <button type="button" className="m-btn m-btn-ghost" onClick={onTestMeOut} disabled={submitting}>
            <GraduationCap size={15} style={{ marginRight: 6 }} aria-hidden="true" />
            I already know this — test me
          </button>
        )}
      </div>
    </StepShell>
  );
}
