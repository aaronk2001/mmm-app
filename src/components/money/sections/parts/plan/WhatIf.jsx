import { useEffect, useRef, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, ReferenceDot } from 'recharts';
import Money from '../../../shared/Money';
import Card from '../../../shared/Card';
import ErrorState from '../../../shared/ErrorState';
import Skeleton from '../../../shared/Skeleton';
import { PlanIntake, SignedMoney } from './common';
import { api, useApi } from '../../../../../lib/query';

const DEBOUNCE_MS = 250;

// Sliders drive POST /api/plan/what-if. All the numbers below — surplus,
// savings, the 18-month timeline, milestones — come straight from the
// server (planning.modelNetWorth18mo); nothing here does the math itself.
export default function WhatIf() {
  const { data: profileData, isLoading: profileLoading, error: profileError, refetch: refetchProfile } = useApi('plan/profile');
  const complete = profileData?.complete === true;
  const { data: snapshot, isLoading: snapLoading } = useApi('plan/snapshot', { enabled: complete });

  const [salary, setSalary] = useState(null);
  const [savingsRate, setSavingsRate] = useState(30);
  const [expenses, setExpenses] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showTable, setShowTable] = useState(false);

  const timerRef = useRef(null);
  const initializedRef = useRef(false);

  // Seed the sliders from the real snapshot once it's loaded.
  useEffect(() => {
    if (snapshot && !initializedRef.current) {
      initializedRef.current = true;
      setSalary(snapshot.income?.current_gross || 60000);
      setExpenses(Math.round(snapshot.expenses?.total_monthly) || 3000);
    }
  }, [snapshot]);

  async function run(newSalary, rate, exp) {
    setLoading(true); setError(null);
    try {
      const data = await api('plan/what-if', {
        method: 'POST',
        body: JSON.stringify({ new_salary: newSalary, savings_rate: rate / 100, expenses_monthly: exp }),
      });
      setResult(data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  // Debounce every slider-driven POST by 250ms — never one request per tick.
  useEffect(() => {
    if (salary == null || expenses == null) return undefined;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => run(salary, savingsRate, expenses), DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salary, savingsRate, expenses]);

  if (profileLoading) return <Skeleton height={320} />;
  if (profileError) return <ErrorState message={profileError.message} onRetry={refetchProfile} />;
  if (!complete) return <PlanIntake metric="the what-if projector" />;
  if (snapLoading || salary == null || expenses == null) return <Skeleton height={320} />;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 20 }}>
        <div>
          <label className="m-input-label">New annual salary — <Money value={salary} decimals={0} /></label>
          <input type="range" min="20000" max="250000" step="1000" value={salary}
            onChange={(e) => setSalary(Number(e.target.value))} style={{ width: '100%' }} />
        </div>
        <div>
          <label className="m-input-label">Savings rate — {savingsRate}%</label>
          <input type="range" min="0" max="80" step="1" value={savingsRate}
            onChange={(e) => setSavingsRate(Number(e.target.value))} style={{ width: '100%' }} />
        </div>
        <div>
          <label className="m-input-label">Monthly expenses — <Money value={expenses} decimals={0} /></label>
          <input type="range" min="500" max="15000" step="100" value={expenses}
            onChange={(e) => setExpenses(Number(e.target.value))} style={{ width: '100%' }} />
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={() => run(salary, savingsRate, expenses)} />}
      {loading && !result && <Skeleton height={280} />}

      {result && (
        <>
          <div style={{ display: 'flex', gap: 24, marginBottom: 12, fontSize: 13, color: 'var(--m-ink-2)', flexWrap: 'wrap' }}>
            <span>Monthly surplus <SignedMoney value={result.monthly_surplus} /></span>
            <span>Monthly savings <SignedMoney value={result.monthly_save} /></span>
            <span>18-mo net worth <SignedMoney value={result.final_net_worth} /></span>
            <span>
              Target <Money value={result.target_net_worth} decimals={0} />
              {' — '}{result.months_to_target == null ? 'not reached in 18 mo' : `hit at month ${result.months_to_target}`}
            </span>
          </div>

          <Card className="m-card-sm m-card-no-hover" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)' }}>18-month net worth path</div>
              <button type="button" className="m-btn m-btn-secondary m-btn-sm" onClick={() => setShowTable((s) => !s)}>
                {showTable ? 'Show chart' : 'Show table'}
              </button>
            </div>

            {showTable ? (
              <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--m-ink-2)' }}>
                      <th style={{ padding: '4px 8px' }}>Month</th>
                      <th style={{ padding: '4px 8px' }}>Net worth</th>
                      <th style={{ padding: '4px 8px' }}>Saved that month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.timeline.map((t) => (
                      <tr key={t.month} style={{ borderTop: '1px solid var(--m-border)', color: 'var(--m-ink)' }}>
                        <td style={{ padding: '4px 8px' }}>{t.month}</td>
                        <td style={{ padding: '4px 8px' }}><SignedMoney value={t.net_worth} /></td>
                        <td style={{ padding: '4px 8px' }}><SignedMoney value={t.monthly_save} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={result.timeline}>
                  <defs>
                    <linearGradient id="planWhatIfFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--m-chart-1)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--m-chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" />
                  <XAxis dataKey="month" stroke="var(--m-muted)" style={{ fontSize: 12 }} tickFormatter={(m) => `M${m}`} />
                  <YAxis stroke="var(--m-muted)" style={{ fontSize: 12 }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
                  <RTooltip
                    contentStyle={{ background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 8, color: 'var(--m-ink)' }}
                    formatter={(value) => [<SignedMoney key="v" value={value} />, 'Net worth']}
                    labelFormatter={(m) => `Month ${m}`}
                  />
                  <Area type="monotone" dataKey="net_worth" stroke="var(--m-chart-1)" strokeWidth={2} fillOpacity={1} fill="url(#planWhatIfFill)" />
                  {(result.milestones || []).map((m) => (
                    <ReferenceDot key={`${m.type}-${m.month}`} x={m.month} y={m.net_worth} r={4} fill="var(--m-accent)" stroke="var(--m-surface)" />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Card>

          {result.milestones?.length > 0 && (
            <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
              {result.milestones.map((m) => (
                <div key={`${m.type}-${m.month}`} style={{ fontSize: 12, color: 'var(--m-ink-2)' }}>
                  <strong style={{ color: 'var(--m-ink)' }}>Month {m.month}:</strong> {m.label} — {m.description}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
