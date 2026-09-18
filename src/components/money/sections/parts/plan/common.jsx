import { Link } from 'react-router-dom';
import Card from '../../../shared/Card';
import Money from '../../../shared/Money';

// Shared across every Plan tab: with no settings.profile saved, the planning
// models refuse to invent a salary (server-side ruling R5) — every panel
// shows this instead of a number.
export function PlanIntake({ metric = 'these figures' }) {
  return (
    <Card className="m-card-sm m-card-no-hover" style={{ padding: 20 }}>
      <div style={{ fontWeight: 600, color: 'var(--m-ink)', marginBottom: 6 }}>
        Add your income to unlock {metric}
      </div>
      <div style={{ color: 'var(--m-ink-2)', fontSize: 14, marginBottom: 14 }}>
        These models won't guess a number this size — add your gross salary and state in Settings first.
      </div>
      <Link to="/settings" className="m-btn m-btn-primary">Go to Settings</Link>
    </Card>
  );
}

// Signed dollar amount — "+$1,234" / "-$1,234", never "$-1,234" (Money's raw
// negative formatting). Null passes straight through to <Money> so it renders
// the shared em-dash instead of a fabricated number.
export function SignedMoney({ value, decimals = 0 }) {
  if (value == null) return <Money value={null} />;
  return <Money value={Math.abs(value)} prefix={value >= 0 ? '+$' : '-$'} decimals={decimals} />;
}
