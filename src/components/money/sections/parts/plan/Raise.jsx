import { useState } from 'react';
import MetricCard from '../../../shared/MetricCard';
import Grade from '../../../shared/Grade';
import Money from '../../../shared/Money';
import Card from '../../../shared/Card';
import ErrorState from '../../../shared/ErrorState';
import Skeleton from '../../../shared/Skeleton';
import { PlanIntake, SignedMoney } from './common';
import { api, useApi } from '../../../../../lib/query';

// POST /api/plan/raise doesn't return tax_year/grade itself (only the two
// effective_rate numbers), so — rather than hardcode the 2024/'B' constants
// baked into server/tools/planning.js — we make one small extra call to the
// real /take-home endpoint for the new salary to source that metadata
// honestly. Every number on this panel still comes from a server response.
export default function Raise() {
  const { data: profileData, isLoading: profileLoading, error: profileError, refetch: refetchProfile } = useApi('plan/profile');
  const complete = profileData?.complete === true;

  const [newSalary, setNewSalary] = useState('');
  const [gapWeeks, setGapWeeks] = useState('0');
  const [result, setResult] = useState(null);
  const [taxMeta, setTaxMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e?.preventDefault();
    if (!newSalary) return;
    setLoading(true); setError(null);
    try {
      const [raiseRes, homeRes] = await Promise.all([
        api('plan/raise', { method: 'POST', body: JSON.stringify({ new_salary: Number(newSalary), gap_weeks: Number(gapWeeks) || 0 }) }),
        api('plan/take-home', { method: 'POST', body: JSON.stringify({ gross_salary: Number(newSalary), state: profileData.profile.state }) }),
      ]);
      setResult(raiseRes);
      setTaxMeta({ tax_year: homeRes.tax_year, grade: homeRes.grade });
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  if (profileLoading) return <Skeleton height={220} />;
  if (profileError) return <ErrorState message={profileError.message} onRetry={refetchProfile} />;
  if (!complete) return <PlanIntake metric="the raise planner" />;

  const d = result;
  const gap = Number(gapWeeks) || 0;
  const showNumbers = d && !d.needs_profile;

  return (
    <div>
      <form onSubmit={submit} style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <label className="m-input-label">New annual salary</label>
          <input className="m-input" type="number" min="0" value={newSalary} onChange={(e) => setNewSalary(e.target.value)} required />
        </div>
        <div>
          <label className="m-input-label">Unpaid gap (weeks)</label>
          <input className="m-input" style={{ width: 90 }} type="number" min="0" value={gapWeeks} onChange={(e) => setGapWeeks(e.target.value)} />
        </div>
        <button className="m-btn m-btn-primary" type="submit" disabled={loading}>
          {loading ? 'Modeling…' : 'Model this raise'}
        </button>
      </form>

      {error && <ErrorState message={error} onRetry={submit} />}
      {loading && <Skeleton height={160} />}

      {d && d.needs_profile && <PlanIntake metric="the raise planner" />}

      {showNumbers && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
            <MetricCard label="Δ monthly take-home" value={<SignedMoney value={d.monthly_delta} />} sublabel="per month" delta={d.monthly_delta} grade={taxMeta?.grade} />
            <MetricCard label="Δ annual take-home" value={<SignedMoney value={d.annual_delta} />}
              sublabel={gap > 0 ? `net of a ${gap}-week gap` : 'per year'} delta={d.annual_delta} grade={taxMeta?.grade} />
            <MetricCard label="Net 12-month gain" value={<SignedMoney value={d.net_12mo_gain} />} sublabel="after gap cost" delta={d.net_12mo_gain} grade={taxMeta?.grade} />
          </div>

          <Card className="m-card-sm m-card-no-hover" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)', marginBottom: 10 }}>Where the raise goes</div>
            {d.allocation_plan.length ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {d.allocation_plan.map((a) => (
                  <div key={a.goal} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--m-ink-2)' }}>
                    <span>{a.goal}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--m-ink)' }}>
                      <Money value={a.monthly} decimals={0} />/mo
                      {a.months_to_goal != null ? ` · ${a.months_to_goal} mo to goal` : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--m-muted)' }}>No surplus to allocate at this salary.</div>
            )}
          </Card>

          <Card className="m-card-sm m-card-no-hover" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)' }}>Effective tax rate</div>
              {taxMeta && <Grade grade={taxMeta.grade} />}
              {taxMeta && <span style={{ fontSize: 11, color: 'var(--m-muted)' }}>{taxMeta.tax_year} brackets</span>}
            </div>
            <div style={{ display: 'flex', gap: 24, fontSize: 14, fontVariantNumeric: 'tabular-nums', color: 'var(--m-ink)' }}>
              <span>Now: {d.tax_comparison.current_effective_rate}%</span>
              <span>After: {d.tax_comparison.new_effective_rate}%</span>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
