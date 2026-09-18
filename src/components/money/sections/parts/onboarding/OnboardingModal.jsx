import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api, useApi, queryClient } from '../../../../../lib/query';
import { toast } from '../../../../../lib/toast';
import useDialog from '../../../shared/useDialog';
import ProfilePanel, { PROFILE_STEPS, PROFILE_DEFAULTS, buildProfilePayload } from '../settings/ProfilePanel';

const SKIP_KEY = 'mmm-profile-skipped';

function alreadySkipped() {
  try { return sessionStorage.getItem(SKIP_KEY) === '1'; } catch { return false; }
}

// The onboarding gate for `settings.profile`, the one thing every Plan
// panel refuses to work without (server-side ruling R5 — it won't invent a
// salary). Shows once per session at most, and only until the user either
// finishes it or dismisses it any way at all — Skip link, the X, Escape, a
// backdrop click, or another dialog (command palette / shortcut sheet)
// taking focus via useDialog's mutual exclusion. Every one of those counts
// as "skip for now": this gate must never be the thing standing between the
// user and the rest of the app.
export default function OnboardingModal() {
  const { data, isLoading } = useApi('plan/profile');
  const [open, setOpen] = useState(null); // null = undecided until the GET resolves
  const [seeded, setSeeded] = useState(false);
  const [values, setValues] = useState(PROFILE_DEFAULTS);
  const [step, setStep] = useState(0);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef(null);
  const firstFieldRef = useRef(null);

  // Decide exactly once whether to show, from the first successful GET —
  // deliberately NOT re-derived on every refetch, so completing step 2
  // (which can flip `complete` true before step 3 is done) can't yank the
  // modal out from under the user mid-flow.
  useEffect(() => {
    if (open === null && !isLoading) setOpen(data?.complete === false && !alreadySkipped());
  }, [open, isLoading, data]);

  useEffect(() => {
    if (open && !seeded && data?.profile) {
      setValues((v) => ({ ...v, ...data.profile }));
      setSeeded(true);
    }
  }, [open, seeded, data]);

  const skip = useCallback(() => {
    try { sessionStorage.setItem(SKIP_KEY, '1'); } catch { /* private mode */ }
    setOpen(false);
  }, []);

  // Mutual exclusion with the command palette / shortcut sheet, focus in on
  // open, Tab trap, focus release on close.
  useDialog({ id: 'onboarding', open: !!open, onClose: skip, panelRef, initialFocusRef: firstFieldRef });

  // Escape triggers Skip explicitly (useDialog only handles Tab + focus).
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) { if (e.key === 'Escape') skip(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, skip]);

  if (!open) return null;

  const stepDef = PROFILE_STEPS[step];
  const isLast = step === PROFILE_STEPS.length - 1;

  async function submitStep() {
    setError(null);
    setSaving(true);
    try {
      const payload = buildProfilePayload(values, stepDef.fields);
      const res = await api('plan/profile', { method: 'PUT', body: JSON.stringify(payload) });
      setValues((v) => ({ ...v, ...res.profile }));
      if (isLast) {
        queryClient.invalidateQueries({ queryKey: ['plan/profile'] });
        toast.success('Profile saved — planning is unlocked.');
        setOpen(false);
      } else {
        setStep((s) => s + 1);
      }
    } catch (err) {
      // The server is the only validator — render its message verbatim and
      // save nothing (a 400 never reaches repo.setSettings, so a bad value
      // in this step can't corrupt fields already saved from prior steps).
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="m-palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) skip(); }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Set up your profile"
        tabIndex={-1}
        style={{
          width: '100%', maxWidth: 480, margin: '0 16px', outline: 'none',
          background: 'var(--m-surface)', border: '1px solid var(--m-border)',
          borderRadius: 14, boxShadow: 'var(--m-shadow-lg)', padding: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--m-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Step {step + 1} of {PROFILE_STEPS.length}
          </span>
          <button onClick={skip} title="Skip for now" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--m-muted)', display: 'flex', padding: 2 }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--m-ink)', marginBottom: 6 }}>
          Tell us about your money
        </div>
        <div style={{ fontSize: 13, color: 'var(--m-ink-2)', marginBottom: 18, lineHeight: 1.5 }}>
          The planning tools need a few real numbers before they'll model your future — none of it leaves this laptop.
        </div>

        <ProfilePanel
          steps={[stepDef]}
          values={values}
          onChange={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))}
          firstFieldRef={firstFieldRef}
          idPrefix="onboarding"
        />

        {error && <div role="alert" style={{ fontSize: 13, color: 'var(--m-red)', marginTop: 2, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--m-border)' }}>
          <button
            className="m-btn m-btn-ghost m-btn-sm"
            onClick={() => setStep((s) => s - 1)}
            style={{ visibility: step === 0 ? 'hidden' : 'visible' }}
          >
            Back
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              onClick={skip}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--m-muted)', textDecoration: 'underline', textUnderlineOffset: 3, padding: 0 }}
            >
              Skip for now
            </button>
            <button className="m-btn m-btn-primary m-btn-sm" onClick={submitStep} disabled={saving}>
              {saving ? 'Saving…' : isLast ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
