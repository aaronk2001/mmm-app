import { TrendingUp } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Card from '../../../shared/Card';
import Money from '../../../shared/Money';
import { motion } from 'motion/react';

export default function NetWorthTrendChart({ data }) {
  if (data.length <= 1) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      style={{ marginBottom: '24px' }}
    >
      <Card className="m-card-sm" style={{ padding: '20px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '16px' }}>
          <TrendingUp size={16} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'text-bottom' }} />
          Net Worth Trend
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--m-accent)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--m-accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--m-border)" />
            <XAxis
              dataKey="date"
              stroke="var(--m-muted)"
              style={{ fontSize: '12px' }}
              tickFormatter={d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            />
            <YAxis
              stroke="var(--m-muted)"
              style={{ fontSize: '12px' }}
              tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--m-surface)',
                border: '1px solid var(--m-border)',
                borderRadius: '8px',
                color: 'var(--m-ink)',
              }}
              formatter={value => <Money value={value} prefix="$" decimals={0} />}
              labelFormatter={label => new Date(label).toLocaleDateString('en-US')}
            />
            <Area
              type="monotone"
              dataKey="net"
              stroke="var(--m-accent)"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorNet)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </Card>
    </motion.div>
  );
}
