import { useMemo, useState } from 'react';
import { Repeat, Calendar } from 'lucide-react';
import Card from '../../../shared/Card';
import Money from '../../../shared/Money';
import MetricCard from '../../../shared/MetricCard';
import EmptyState from '../../../shared/EmptyState';
import { perMonth, perYear } from '../../../../../lib/cadence';
import { parseYmd } from '../../../../../lib/localDate';

const CYCLES = [
  { value: 'all', label: 'All' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
];

const fmtDate = (d) => d
  ? parseYmd(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '—';

/**
 * Subscriptions — a filtered, normalized view over the recurring bills
 * CashFlow.jsx already loads (kind === 'bill'). No fetch, no new table.
 */
export default function Subscriptions({ recurring = [] }) {
  const [cycle, setCycle] = useState('all');

  const bills = useMemo(() => recurring.filter((r) => r.kind === 'bill'), [recurring]);

  const filtered = useMemo(
    () => (cycle === 'all' ? bills : bills.filter((r) => r.cadence === cycle)),
    [bills, cycle]
  );

  const rows = useMemo(
    () => filtered
      .map((r) => ({ ...r, monthly: perMonth(r.amount, r.cadence) }))
      .sort((a, b) => b.monthly - a.monthly),
    [filtered]
  );

  const monthlyTotal = rows.reduce((s, r) => s + r.monthly, 0);
  const annualTotal = filtered.reduce((s, r) => s + perYear(r.amount, r.cadence), 0);

  if (bills.length === 0) {
    return (
      <Card className="m-card-sm">
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '12px' }}>
          <Repeat size={16} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'text-bottom' }} />
          Subscriptions
        </h3>
        <EmptyState title="No recurring bills yet." message="Add a recurring bill above to see it here." />
      </Card>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)' }}>
          <Repeat size={16} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'text-bottom' }} />
          Subscriptions
        </h3>
        <div style={{ display: 'flex', gap: '6px' }}>
          {CYCLES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCycle(c.value)}
              style={{
                padding: '4px 10px',
                borderRadius: '999px',
                border: `1px solid ${cycle === c.value ? 'var(--m-accent)' : 'var(--m-border)'}`,
                background: cycle === c.value ? 'var(--m-accent-soft)' : 'var(--m-surface)',
                color: cycle === c.value ? 'var(--m-accent)' : 'var(--m-ink-2)',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
        <MetricCard label="Monthly equivalent" value={<Money value={monthlyTotal} prefix="$" decimals={0} />} />
        <MetricCard label="Annual total" value={<Money value={annualTotal} prefix="$" decimals={0} />} />
      </div>

      {rows.length === 0 ? (
        <Card hoverable={false} className="m-card-sm" style={{ background: 'var(--m-surface-2)', border: 'none', textAlign: 'center' }}>
          <div style={{ fontSize: '13px', color: 'var(--m-ink-2)' }}>No bills on this cycle.</div>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {rows.map((r) => (
            <Card key={r.id || `${r.payee}-${r.cadence}`} hoverable={false} className="m-card-sm">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '4px' }}>
                    {r.payee}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--m-ink-2)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{
                      display: 'inline-block', padding: '1px 8px', borderRadius: '999px',
                      border: '1px solid var(--m-border)', background: 'var(--m-surface-2)',
                      fontSize: '11px', fontWeight: 600, textTransform: 'capitalize', color: 'var(--m-ink-2)',
                    }}>
                      {r.cadence}
                    </span>
                    <Calendar size={13} />
                    <span>Next: {fmtDate(r.next_date)}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--m-red)', fontVariantNumeric: 'tabular-nums' }}>
                    <Money value={Math.abs(parseFloat(r.amount))} prefix="-$" decimals={0} />
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--m-ink-2)', fontVariantNumeric: 'tabular-nums' }}>
                    <Money value={r.monthly} prefix="$" decimals={0} />/mo
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
