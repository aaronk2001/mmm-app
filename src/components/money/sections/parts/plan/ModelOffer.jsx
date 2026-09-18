import { useEffect, useState } from 'react';
import MetricCard from '../../../shared/MetricCard';
import AnimatedNumber from '../../../shared/AnimatedNumber';
import Grade from '../../../shared/Grade';
import Card from '../../../shared/Card';
import ErrorState from '../../../shared/ErrorState';
import Skeleton from '../../../shared/Skeleton';
import { PlanIntake, SignedMoney } from './common';
import { api, useApi } from '../../../../../lib/query';

// The job-sprint headline: three deltas from POST /api/plan/offer. Any of
// them can legitimately be null (no declared salary, or no spending history
// to compute a runway burn from) — <SignedMoney>/<AnimatedNumber> below
// render a dash + explanation for that case, never NaN or $0.
export default function ModelOffer() {
  const { data: profileData, isLoading: profileLoading, error: profileError, refetch: refetchProfile } = useApi('plan/profile');
  const complete = profileData?.complete === true;

  const [salary, setSalary] = useState('');
  const [state, setState] = useState('');
  const [gapWeeks, setGapWeeks] = useState('0');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (complete) setState(profileData.profile.state);
  }, [complete, profileData]);

  async function submit(e) {
    e?.preventDefault();
    if (!salary) return;
    setLoading(true); setError(null);
    try {
      const data = await api('plan/offer', {
        method: 'POST',
        body: JSON.stringify({ new_salary: Number(salary), state: state || undefined, gap_weeks: Number(gapWeeks) || 0 }),
      });
      setResult(data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  if (profileLoading) return <Skeleton height={240} />;
  if (profileError) return <ErrorState message={profileError.message} onRetry={refetchProfile} />;
  if (!complete) return <PlanIntake metric="the offer comparison" />;

  const d = result;
  const gap = Number(gapWeeks) || 0;
  const showNumbers = d && !d.needs_profile;

  return (
    <div>
      <form onSubmit={submit} style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <label className="m-input-label">Offer salary</label>
          <input className="m-input" type="number" min="0" value={salary} onChange={(e) => setSalary(e.target.value)} required />
        </div>
        <div>
          <label className="m-input-label">State</label>
          <input className="m-input" style={{ width: 70, textTransform: 'uppercase' }} maxLength={2}
            value={state} onChange={(e) => setState(e.target.value.toUpperCase())} />
        </div>
        <div>
          <label className="m-input-label">Unpaid gap (weeks)</label>
          <input className="m-input" style={{ width: 90 }} type="number" min="0" value={gapWeeks} onChange={(e) => setGapWeeks(e.target.value)} />
        </div>
        <button className="m-btn m-btn-primary" type="submit" disabled={loading}>
          {loading ? 'Modeling…' : 'Model this offer'}
        </button>
      </form>

      {error && <ErrorState message={error} onRetry={submit} />}
      {loading && <Skeleton height={140} />}

      {d && d.needs_profile && <PlanIntake metric="the offer comparison" />}

      {showNumbers && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
            <MetricCard
              label="Δ take-home"
              value={<SignedMoney value={d.delta_monthly_take_home} />}
              sublabel={d.delta_monthly_take_home == null ? 'no current salary on file' : 'per month'}
              delta={d.delta_monthly_take_home}
              grade={d.grade}
            />
            <MetricCard
              label="Δ runway"
              value={d.delta_runway_months == null
                ? <SignedMoney value={null} />
                : <AnimatedNumber value={d.delta_runway_months} format={(n) => `${n > 0 ? '+' : ''}${n.toFixed(1)} mo`} />}
              sublabel={d.delta_runway_months == null ? 'no spending history to burn against' : 'months of cash'}
              delta={d.delta_runway_months}
              grade={d.grade}
            />
            <MetricCard
              label="Δ 18-mo net worth"
              value={<SignedMoney value={d.delta_net_worth_18mo} />}
              sublabel={d.delta_net_worth_18mo == null ? 'no current salary on file' : 'vs. staying put'}
              delta={d.delta_net_worth_18mo}
              grade={d.grade}
            />
          </div>

          <Card className="m-card-sm m-card-no-hover" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)' }}>Net 12-month gain</div>
              <Grade grade={d.grade} />
              <span style={{ fontSize: 11, color: 'var(--m-muted)' }}>{d.tax_year} brackets</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              <SignedMoney value={d.net_12mo_gain} />
            </div>
            {gap > 0 && (
              <div style={{ fontSize: 12, color: 'var(--m-ink-2)', marginTop: 4 }}>
                Net of an unpaid {gap}-week gap between jobs.
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
