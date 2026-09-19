import { AlertTriangle } from 'lucide-react';
import Grade from '../../../shared/Grade';

const LABELS = {
  runway_days: 'Runway', runway_date: 'Runway date', liquid: 'Liquid cash', savings_rate: 'Savings rate',
  monthly_surplus: 'Monthly surplus', ef_months_covered: 'Emergency fund covers', ef_target: 'Emergency fund target',
  budget_variance_top3: 'Biggest budget variances', recurring_monthly: 'Recurring bills', largest_outflow: 'Largest outflow',
  debt_ledger: 'Debt',
};

// Every figure a lesson quotes carries its evidence grade, and a lesson
// running on fallback numbers says so plainly — never a silent guess
// presented as the user's real data (see server/learn/variables.js's
// SAMPLE_DATA + `sample` flag). `personalizes`/`variables` come straight
// from GET /lessons/:id (server/learn/routes.js), the same computed set
// that already rendered the lesson's {{variable}} tags — nothing here is
// recomputed or invented client-side.
export default function YourNumbers({ personalizes = [], variables = {} }) {
  const rows = personalizes.map((name) => ({ name, ...variables[name] })).filter((r) => r.formatted !== undefined);
  if (!rows.length) return null;
  const anySample = rows.some((r) => r.sample);

  return (
    <div className="m-card m-card-no-hover" style={{ padding: '12px 14px', display: 'grid', gap: 10, background: 'var(--m-surface-2)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--m-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
        Your numbers in this lesson
      </div>
      {anySample && (
        <div role="status" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--m-amber)' }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
          <span>Running on sample figures — add your own accounts and transactions to see your real numbers here.</span>
        </div>
      )}
      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map((r) => (
          <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--m-ink-2)' }}>{LABELS[r.name] || r.name}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--m-ink)', fontVariantNumeric: 'tabular-nums' }}>
                {r.formatted}{r.sample ? ' (sample)' : ''}
              </span>
              <Grade grade={r.grade} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
