import { DollarSign } from 'lucide-react';
import { BarChart, Bar, Cell, Legend, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Card from '../../../shared/Card';
import Money from '../../../shared/Money';

const monthShort = (m) => { const [y, mo] = String(m).split('-'); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'short' }); };
const monthLong = (m) => { const [y, mo] = String(m).split('-'); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); };

export default function IncomeVsSpendingCard({ rows, totals }) {
  if (!rows.length) return null;
  return (
    <Card className="m-card-sm" style={{ padding: '20px' }}>
      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '4px' }}>
        <DollarSign size={16} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'text-bottom' }} />
        Income vs Spending
      </div>
      <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginBottom: '16px' }}>
        Posted transactions · hatched months are projected from recurring
      </div>

      {/* Totals across the shown months */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '12px', color: 'var(--m-muted)', fontWeight: 500, marginBottom: '4px' }}>
            Total Income
          </div>
          <div style={{ fontSize: 'clamp(16px, 4vw, 20px)', fontWeight: 700, color: 'var(--m-green)', fontVariantNumeric: 'tabular-nums' }}>
            <Money value={totals.income} prefix="$" decimals={0} />
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '12px', color: 'var(--m-muted)', fontWeight: 500, marginBottom: '4px' }}>
            Total Spending
          </div>
          <div style={{ fontSize: 'clamp(16px, 4vw, 20px)', fontWeight: 700, color: 'var(--m-red)', fontVariantNumeric: 'tabular-nums' }}>
            <Money value={totals.spending} prefix="$" decimals={0} />
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '12px', color: 'var(--m-muted)', fontWeight: 500, marginBottom: '4px' }}>
            Net
          </div>
          <div style={{ fontSize: 'clamp(16px, 4vw, 20px)', fontWeight: 700, color: totals.net >= 0 ? 'var(--m-green)' : 'var(--m-red)', fontVariantNumeric: 'tabular-nums' }}>
            <Money value={Math.abs(totals.net)} prefix={totals.net >= 0 ? '$' : '-$'} decimals={0} />
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={rows}>
          <defs>
            <pattern id="ivsHatchGreen" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--m-green)" opacity="0.25" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--m-green)" strokeWidth="2" />
            </pattern>
            <pattern id="ivsHatchRed" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--m-red)" opacity="0.25" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--m-red)" strokeWidth="2" />
            </pattern>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" />
          <XAxis dataKey="month" stroke="var(--m-muted)" style={{ fontSize: '12px' }} tickFormatter={monthShort} />
          <YAxis stroke="var(--m-muted)" style={{ fontSize: '12px' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: '8px', color: 'var(--m-ink)' }}
            formatter={value => <Money value={value} prefix="$" decimals={0} />}
            labelFormatter={(m, payload) => `${monthLong(m)}${payload?.[0]?.payload?.projected ? ' (projected)' : ''}`}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Bar dataKey="income" name="Income" radius={[4, 4, 0, 0]}>
            {rows.map(r => <Cell key={r.month} fill={r.projected ? 'url(#ivsHatchGreen)' : 'var(--m-green)'} />)}
          </Bar>
          <Bar dataKey="spending" name="Spending" radius={[4, 4, 0, 0]}>
            {rows.map(r => <Cell key={r.month} fill={r.projected ? 'url(#ivsHatchRed)' : 'var(--m-red)'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
