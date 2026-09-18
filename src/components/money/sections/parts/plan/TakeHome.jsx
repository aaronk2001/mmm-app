import { useEffect, useState } from 'react';
import MetricCard from '../../../shared/MetricCard';
import Money from '../../../shared/Money';
import Card from '../../../shared/Card';
import ErrorState from '../../../shared/ErrorState';
import Skeleton from '../../../shared/Skeleton';
import { PlanIntake } from './common';
import { api, useApi } from '../../../../../lib/query';

export default function TakeHome() {
  const { data: profileData, isLoading: profileLoading, error: profileError, refetch: refetchProfile } = useApi('plan/profile');
  const complete = profileData?.complete === true;

  const [salary, setSalary] = useState('');
  const [state, setState] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Prefill from the declared profile once it loads.
  useEffect(() => {
    if (complete) {
      setSalary(String(profileData.profile.gross_salary));
      setState(profileData.profile.state);
    }
  }, [complete, profileData]);

  async function compute(e) {
    e?.preventDefault();
    if (!salary || !state) return;
    setLoading(true); setError(null);
    try {
      const data = await api('plan/take-home', {
        method: 'POST',
        body: JSON.stringify({ gross_salary: Number(salary), state }),
      });
      setResult(data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  // Auto-run once with the declared profile so the tab isn't empty on arrival.
  useEffect(() => {
    if (complete && salary && state && !result && !loading) compute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, salary, state]);

  if (profileLoading) return <Skeleton height={220} />;
  if (profileError) return <ErrorState message={profileError.message} onRetry={refetchProfile} />;
  if (!complete) return <PlanIntake metric="your take-home breakdown" />;

  return (
    <div>
      <form onSubmit={compute} style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <label className="m-input-label">Gross annual salary</label>
          <input className="m-input" type="number" min="0" value={salary} onChange={(e) => setSalary(e.target.value)} />
        </div>
        <div>
          <label className="m-input-label">State</label>
          <input className="m-input" style={{ width: 70, textTransform: 'uppercase' }} maxLength={2}
            value={state} onChange={(e) => setState(e.target.value.toUpperCase())} />
        </div>
        <button className="m-btn m-btn-primary" type="submit" disabled={loading}>
          {loading ? 'Calculating…' : 'Calculate'}
        </button>
      </form>

      {error && <ErrorState message={error} onRetry={compute} />}
      {loading && !result && <Skeleton height={140} />}

      {result && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
            <MetricCard label="Annual take-home" value={<Money value={result.annual_take_home} decimals={0} />} grade={result.grade} />
            <MetricCard label="Monthly take-home" value={<Money value={result.monthly_take_home} decimals={0} />} sublabel="per month" grade={result.grade} />
            <MetricCard label="Effective tax rate" value={`${result.effective_rate}%`} sublabel={`${result.tax_year} brackets`} grade={result.grade} />
          </div>
          <Card className="m-card-sm m-card-no-hover" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)', marginBottom: 10 }}>Breakdown</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--m-ink-2)' }}>Federal tax</div>
                <div style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--m-ink)' }}><Money value={result.federal_tax} decimals={0} /></div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--m-ink-2)' }}>State tax</div>
                <div style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--m-ink)' }}><Money value={result.state_tax} decimals={0} /></div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--m-ink-2)' }}>FICA</div>
                <div style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--m-ink)' }}><Money value={result.fica} decimals={0} /></div>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
