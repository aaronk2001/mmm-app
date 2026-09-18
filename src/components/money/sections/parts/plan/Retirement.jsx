import { useEffect, useState } from 'react';
import MetricCard from '../../../shared/MetricCard';
import Money from '../../../shared/Money';
import Card from '../../../shared/Card';
import ErrorState from '../../../shared/ErrorState';
import Skeleton from '../../../shared/Skeleton';
import { PlanIntake } from './common';
import { api, useApi } from '../../../../../lib/query';

// Roth IRA (POST /api/plan/roth) and FIRE (GET /api/plan/fire) side by side.
// Neither endpoint returns a `grade` field, so no <Grade> badge is invented
// here — only the tax year Roth genuinely returns.
export default function Retirement() {
  const { data: profileData, isLoading: profileLoading, error: profileError, refetch: refetchProfile } = useApi('plan/profile');
  const complete = profileData?.complete === true;
  const { data: fire, isLoading: fireLoading, error: fireError, refetch: refetchFire } = useApi('plan/fire', { enabled: complete });

  const [contribution, setContribution] = useState('7000');
  const [startAge, setStartAge] = useState('25');
  const [retirementAge, setRetirementAge] = useState('65');
  const [ratePct, setRatePct] = useState('7');
  const [roth, setRoth] = useState(null);
  const [rothLoading, setRothLoading] = useState(false);
  const [rothError, setRothError] = useState(null);

  async function calcRoth(e) {
    e?.preventDefault();
    setRothLoading(true); setRothError(null);
    try {
      const data = await api('plan/roth', {
        method: 'POST',
        body: JSON.stringify({
          annual_contribution: Number(contribution),
          start_age: Number(startAge),
          retirement_age: Number(retirementAge),
          rate: Number(ratePct) / 100,
        }),
      });
      setRoth(data);
    } catch (err) { setRothError(err.message); }
    finally { setRothLoading(false); }
  }

  // Auto-run once with sane defaults so the tab isn't empty on arrival.
  useEffect(() => {
    if (complete && !roth && !rothLoading) calcRoth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete]);

  if (profileLoading) return <Skeleton height={280} />;
  if (profileError) return <ErrorState message={profileError.message} onRetry={refetchProfile} />;
  if (!complete) return <PlanIntake metric="retirement projections" />;

  const capped = roth && Number(contribution) > roth.irs_limit;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
      <Card className="m-card-sm m-card-no-hover" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)', marginBottom: 12 }}>Roth IRA</div>
        <form onSubmit={calcRoth} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12, marginBottom: 16 }}>
          <div>
            <label className="m-input-label">Annual contribution</label>
            <input className="m-input" type="number" min="0" value={contribution} onChange={(e) => setContribution(e.target.value)} />
          </div>
          <div>
            <label className="m-input-label">Start age</label>
            <input className="m-input" type="number" min="13" value={startAge} onChange={(e) => setStartAge(e.target.value)} />
          </div>
          <div>
            <label className="m-input-label">Retirement age</label>
            <input className="m-input" type="number" min="30" value={retirementAge} onChange={(e) => setRetirementAge(e.target.value)} />
          </div>
          <div>
            <label className="m-input-label">Growth rate (%)</label>
            <input className="m-input" type="number" min="0" step="0.1" value={ratePct} onChange={(e) => setRatePct(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="m-btn m-btn-primary" type="submit" disabled={rothLoading}>
              {rothLoading ? 'Calculating…' : 'Calculate'}
            </button>
          </div>
        </form>

        {rothError && <ErrorState message={rothError} onRetry={calcRoth} />}
        {roth && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 8 }}>
              <MetricCard label="Balance at retirement" value={<Money value={roth.balance_at_retirement} decimals={0} />} sublabel={`${roth.assumed_rate} assumed growth`} />
              <MetricCard label="Total contributions" value={<Money value={roth.total_contributions} decimals={0} />} sublabel={`over ${roth.years} yrs`} />
              <MetricCard label="Investment growth" value={<Money value={roth.investment_growth} decimals={0} />} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--m-muted)' }}>
              {roth.tax_year} IRS limit: <Money value={roth.irs_limit} decimals={0} />/yr
              {capped ? ' — your contribution was capped to the limit.' : ''}
            </div>
          </>
        )}
      </Card>

      <Card className="m-card-sm m-card-no-hover" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)', marginBottom: 12 }}>FIRE number</div>
        {fireLoading ? (
          <Skeleton height={140} />
        ) : fireError ? (
          <ErrorState message={fireError.message} onRetry={refetchFire} />
        ) : fire && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 8 }}>
              <MetricCard label="FIRE number" value={<Money value={fire.fire_number} decimals={0} />} sublabel="25x annual expenses" />
              <MetricCard label="Current net worth" value={<Money value={fire.current_net_worth} decimals={0} />} sublabel={`${fire.funded_pct}% funded`} />
              <MetricCard label="Remaining" value={<Money value={fire.deficit_to_fire} decimals={0} />} sublabel="to reach FIRE" />
            </div>
            <div style={{ fontSize: 12, color: 'var(--m-muted)' }}>{fire.rule}</div>
          </>
        )}
      </Card>
    </div>
  );
}
