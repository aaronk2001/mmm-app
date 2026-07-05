import { motion } from 'motion/react';
import { Building2, AlertCircle, Trash2, Package, Banknote, CreditCard, Landmark, TrendingUp, PiggyBank, Coins, Home, Car } from 'lucide-react';
import Card from '../../../shared/Card';
import Money from '../../../shared/Money';

const accountTypeIcons = {
  cash: Banknote,
  credit: CreditCard,
  loan: Landmark,
  brokerage: TrendingUp,
  retirement: PiggyBank,
  crypto: Coins,
  real_estate: Home,
  vehicle: Car,
  other: Package,
};

const accountTypeLabels = {
  cash: 'Cash & Checking',
  credit: 'Credit Card',
  loan: 'Loan',
  brokerage: 'Brokerage',
  retirement: 'Retirement',
  crypto: 'Cryptocurrency',
  real_estate: 'Real Estate',
  vehicle: 'Vehicle',
  other: 'Other',
};

function AccountCard({ account, onDelete }) {
  const Icon = accountTypeIcons[account.type] || Package;

  return (
    <Card key={account.id} className="m-card-sm" hoverable={false} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', minWidth: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginBottom: '4px' }}>
            {accountTypeLabels[account.type] || account.type}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', minWidth: 0 }}>
            <Icon size={18} style={{ flexShrink: 0, color: 'var(--m-accent)' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.name}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            className="m-btn m-btn-icon m-btn-ghost m-btn-sm"
            onClick={() => onDelete(account.id)}
            title="Delete"
            style={{ width: '28px', height: '28px', padding: 0 }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {account.institution && (
        <div style={{ fontSize: '12px', color: 'var(--m-ink-2)' }}>
          {account.institution}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--m-border)', paddingTop: '12px' }}>
        <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginBottom: '4px' }}>Balance</div>
        <div style={{ fontSize: 'clamp(18px, 4vw, 22px)', fontWeight: 700, color: 'var(--m-green)', fontVariantNumeric: 'tabular-nums' }}>
          <Money value={account.balance} prefix="$" decimals={0} />
        </div>
      </div>
    </Card>
  );
}

function LiabilityCard({ account, onDelete }) {
  const Icon = accountTypeIcons[account.type] || Package;

  return (
    <Card key={account.id} className="m-card-sm" hoverable={false} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', minWidth: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginBottom: '4px' }}>
            {accountTypeLabels[account.type] || account.type}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', minWidth: 0 }}>
            <Icon size={18} style={{ flexShrink: 0, color: 'var(--m-red)' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.name}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          <button
            className="m-btn m-btn-icon m-btn-ghost m-btn-sm"
            onClick={() => onDelete(account.id)}
            title="Delete"
            style={{ width: '28px', height: '28px', padding: 0 }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {account.institution && (
        <div style={{ fontSize: '12px', color: 'var(--m-ink-2)' }}>
          {account.institution}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--m-border)', paddingTop: '12px' }}>
        <div style={{ fontSize: '12px', color: 'var(--m-muted)', marginBottom: '4px' }}>Balance Owed</div>
        <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--m-red)', fontVariantNumeric: 'tabular-nums' }}>
          <Money value={Math.abs(account.balance)} prefix="$" decimals={0} />
        </div>
      </div>
    </Card>
  );
}

export default function AccountsList({ accounts, onDelete }) {
  const assets = accounts.filter(a => ['cash', 'brokerage', 'retirement', 'crypto', 'real_estate', 'vehicle', 'other'].includes(a.type));
  const liabilities = accounts.filter(a => ['credit', 'loan'].includes(a.type));

  return (
    <>
      {assets.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          style={{ marginBottom: '24px' }}
        >
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '12px' }}>
            <Building2 size={16} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'text-bottom', color: 'var(--m-green)' }} />
            Assets
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {assets.map(account => (
              <AccountCard key={account.id} account={account} onDelete={onDelete} />
            ))}
          </div>
        </motion.div>
      )}

      {liabilities.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.25 }}
          style={{ marginBottom: '24px' }}
        >
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '12px' }}>
            <AlertCircle size={16} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'text-bottom', color: 'var(--m-red)' }} />
            Liabilities
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {liabilities.map(account => (
              <LiabilityCard key={account.id} account={account} onDelete={onDelete} />
            ))}
          </div>
        </motion.div>
      )}
    </>
  );
}
