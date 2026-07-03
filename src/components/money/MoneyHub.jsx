import { useState, useEffect, lazy, Suspense } from 'react';
import {
  LayoutDashboard,
  Wallet,
  Receipt,
  PiggyBank,
  Zap,
  Target,
  CreditCard,
  TrendingUp,
  FileText,
  Settings,
} from 'lucide-react';
import '../../styles/money-theme.css';
import Card from './shared/Card';
import ErrorBoundary from './shared/ErrorBoundary';
import Toasts from './shared/Toasts';
import ConfirmHost from './shared/ConfirmDialog';
import { toast } from '../../lib/toast';

// Live sections (lazy)
const Overview = lazy(() => import('./sections/Overview'));
const AccountsNetWorth = lazy(() => import('./sections/AccountsNetWorth'));
const Transactions = lazy(() => import('./sections/Transactions'));
const Budget = lazy(() => import('./sections/Budget'));
const CashFlow = lazy(() => import('./sections/CashFlow'));
const Goals = lazy(() => import('./sections/Goals'));
const Debt = lazy(() => import('./sections/Debt'));
const SettingsSection = lazy(() => import('./sections/Settings'));
const Investments = lazy(() => import('./sections/Investments'));
const Reports = lazy(() => import('./sections/Reports'));

const SECTIONS = [
  { id: 'overview',     label: 'Overview',             icon: LayoutDashboard },
  { id: 'accounts',     label: 'Accounts & Net Worth', icon: Wallet },
  { id: 'transactions', label: 'Transactions',         icon: Receipt },
  { id: 'budget',       label: 'Budget',               icon: PiggyBank },
  { id: 'cashflow',     label: 'Cash Flow',            icon: Zap },
  { id: 'goals',        label: 'Goals',                icon: Target },
  { id: 'debt',         label: 'Debt Payoff',          icon: CreditCard },
  { id: 'investments',  label: 'Investments',          icon: TrendingUp },
  { id: 'reports',      label: 'Reports',              icon: FileText },
  { id: 'settings',     label: 'Settings & Privacy',   icon: Settings },
];

function SectionLoader() {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ color: 'var(--m-muted)', fontSize: '14px' }}>Loading…</div>
    </div>
  );
}

export default function MoneyHub() {
  const [activeSection, setActiveSection] = useState('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [isEmpty, setIsEmpty] = useState(false);
  const [seeding, setSeeding] = useState(false);

  async function refreshEmpty() {
    try {
      const res = await fetch('/api/money/overview');
      if (res.ok) {
        const data = await res.json();
        // overview returns an explicit isEmpty flag (it always has keys otherwise).
        setIsEmpty(data?.isEmpty === true || (data?.accountsCount ?? 0) === 0);
      } else {
        setIsEmpty(true);
      }
    } catch (err) {
      console.warn('[MoneyHub] overview check failed:', err.message);
      setIsEmpty(true);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { refreshEmpty(); }, []);

  const handleSeedSample = async () => {
    setSeeding(true);
    try {
      const res = await fetch('/api/money/seed-sample', { method: 'POST' });
      if (!res.ok) throw new Error(`seed failed (${res.status})`);
      await refreshEmpty();
      toast.success('Sample data loaded.');
    } catch (err) {
      console.error('[MoneyHub] seed failed:', err.message);
      toast.error(`Couldn't load sample data: ${err.message}`);
    } finally { setSeeding(false); }
  };

  const handleReset = async () => {
    setSeeding(true);
    try {
      const res = await fetch('/api/money/reset', { method: 'POST' });
      if (!res.ok) throw new Error(`reset failed (${res.status})`);
      setIsEmpty(true);
      toast.success('Starting fresh — data cleared.');
    } catch (err) {
      console.error('[MoneyHub] reset failed:', err.message);
      toast.error(`Couldn't reset: ${err.message}`);
    } finally { setSeeding(false); }
  };

  const renderSection = () => {
    switch (activeSection) {
      case 'overview':     return <Overview />;
      case 'accounts':     return <AccountsNetWorth />;
      case 'transactions': return <Transactions />;
      case 'budget':       return <Budget />;
      case 'cashflow':     return <CashFlow />;
      case 'goals':        return <Goals />;
      case 'debt':         return <Debt />;
      case 'investments':  return <Investments />;
      case 'reports':      return <Reports />;
      case 'settings':     return <SettingsSection />;
      default:             return null;
    }
  };

  return (
    <div className="money-hub" style={{ minHeight: '100vh', display: 'flex' }}>
      <nav
        style={{
          width: 'var(--m-sidebar-width)',
          background: 'var(--m-surface)',
          borderRight: '1px solid var(--m-border)',
          padding: '24px 12px',
          overflowY: 'auto',
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--m-muted)', textTransform: 'uppercase', paddingLeft: '12px', marginBottom: '16px', letterSpacing: '0.05em' }}>
          Money Hub
        </div>
        <div className="m-sidebar">
          {SECTIONS.map(section => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`m-nav-item ${activeSection === section.id ? 'active' : ''}`}
              >
                <Icon size={18} className="m-nav-icon" />
                <span>{section.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ color: 'var(--m-muted)' }}>Loading Money Hub…</div>
          </div>
        ) : isEmpty ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
            <Card className="m-card-sm" style={{ maxWidth: '480px' }}>
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <div style={{ fontSize: '32px', marginBottom: '12px' }}>👋</div>
                <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--m-ink)', marginBottom: '8px' }}>
                  Welcome to your Money Hub
                </div>
                <div style={{ fontSize: '14px', color: 'var(--m-ink-2)', lineHeight: '1.5' }}>
                  Get started by loading sample data to explore, or begin fresh with your own financial picture.
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <button onClick={handleSeedSample} disabled={seeding} className="m-btn m-btn-primary" style={{ width: '100%' }}>
                  {seeding ? 'Loading…' : 'Load Sample Data'}
                </button>
                <button onClick={handleReset} disabled={seeding} className="m-btn m-btn-secondary" style={{ width: '100%' }}>
                  {seeding ? 'Processing…' : 'Start Fresh (Empty)'}
                </button>
              </div>
              <div style={{ marginTop: '16px', padding: '12px', background: 'var(--m-surface-2)', borderRadius: '8px', fontSize: '12px', color: 'var(--m-ink-2)', lineHeight: '1.5' }}>
                <strong>Load Sample Data</strong> fills the hub with demo accounts, transactions, budgets, and goals so you can explore everything.
                <br /><br />
                <strong>Start Fresh</strong> begins with a blank slate — add your own accounts and import transactions.
              </div>
            </Card>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
              <ErrorBoundary key={activeSection}>
                <Suspense fallback={<SectionLoader />}>
                  {renderSection()}
                </Suspense>
              </ErrorBoundary>
            </div>
          </div>
        )}
      </main>

      <Toasts />
      <ConfirmHost />
    </div>
  );
}
