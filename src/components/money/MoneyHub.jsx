import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
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
import QuickAdd from './shared/QuickAdd';
import Logo from './shared/Logo';
import { toast } from '../../lib/toast';
import { api } from '../../lib/query';

// Import thunks are kept separately from lazy() so hovering a nav item can
// prefetch a section's chunk before it's clicked.
const IMPORTERS = {
  overview:     () => import('./sections/Overview'),
  accounts:     () => import('./sections/AccountsNetWorth'),
  transactions: () => import('./sections/Transactions'),
  budget:       () => import('./sections/Budget'),
  cashflow:     () => import('./sections/CashFlow'),
  goals:        () => import('./sections/Goals'),
  debt:         () => import('./sections/Debt'),
  investments:  () => import('./sections/Investments'),
  reports:      () => import('./sections/Reports'),
  settings:     () => import('./sections/Settings'),
};
const LAZY = Object.fromEntries(Object.entries(IMPORTERS).map(([id, imp]) => [id, lazy(imp)]));

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

function SectionSkeleton() {
  return (
    <div>
      <div className="m-skeleton" style={{ width: 220, height: 28, marginBottom: 8 }} />
      <div className="m-skeleton" style={{ width: 320, height: 14, marginBottom: 24 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 16 }}>
        <div className="m-skeleton" style={{ height: 96 }} />
        <div className="m-skeleton" style={{ height: 96 }} />
        <div className="m-skeleton" style={{ height: 96 }} />
      </div>
      <div className="m-skeleton" style={{ height: 280 }} />
    </div>
  );
}

export default function MoneyHub() {
  const [isLoading, setIsLoading] = useState(true);
  const [isEmpty, setIsEmpty] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const location = useLocation();

  async function refreshEmpty() {
    try {
      const data = await api('money/overview');
      // overview returns an explicit isEmpty flag (it always has keys otherwise).
      setIsEmpty(data?.isEmpty === true || (data?.accountsCount ?? 0) === 0);
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
      await api('money/seed-sample', { method: 'POST' });
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
      await api('money/reset', { method: 'POST' });
      setIsEmpty(true);
      toast.success('Starting fresh — data cleared.');
    } catch (err) {
      console.error('[MoneyHub] reset failed:', err.message);
      toast.error(`Couldn't reset: ${err.message}`);
    } finally { setSeeding(false); }
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
        <div style={{ marginBottom: '20px' }}>
          <Logo />
        </div>
        <div className="m-sidebar">
          {SECTIONS.map(section => {
            const Icon = section.icon;
            return (
              <NavLink
                key={section.id}
                to={`/${section.id}`}
                onMouseEnter={() => IMPORTERS[section.id]()}
                className={({ isActive }) => `m-nav-item ${isActive ? 'active' : ''}`}
              >
                <Icon size={18} className="m-nav-icon" />
                <span>{section.label}</span>
              </NavLink>
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
              <ErrorBoundary key={location.pathname}>
                <Suspense fallback={<SectionSkeleton />}>
                  <Routes>
                    <Route path="/" element={<Navigate to="/overview" replace />} />
                    {SECTIONS.map(({ id }) => {
                      const Section = LAZY[id];
                      return <Route key={id} path={`/${id}`} element={<Section />} />;
                    })}
                    <Route path="*" element={<Navigate to="/overview" replace />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </div>
          </div>
        )}
      </main>

      {!isEmpty && !isLoading && <QuickAdd />}
      <Toasts />
      <ConfirmHost />
    </div>
  );
}
