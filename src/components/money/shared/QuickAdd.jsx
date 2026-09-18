import { useEffect, useMemo, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import { api, useApi, queryClient } from '../../../lib/query';
import { toast } from '../../../lib/toast';

// Global keyboard-first transaction entry. Ctrl+N opens it from anywhere;
// Enter saves, Shift+Enter saves and stays open for rapid entry, Esc closes.
// Payee autocompletes from history (/payees) and auto-suggests the category.

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const BLANK = { date: today(), payee: '', amount: '', category_id: '', account_id: '', note: '' };

export default function QuickAdd() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [kind, setKind] = useState('expense'); // expense | income
  const [hl, setHl] = useState(-1);            // highlighted suggestion index
  const [saving, setSaving] = useState(false);
  const payeeRef = useRef(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const { data: accountsRes } = useApi('money/accounts', { enabled: open });
  const { data: categoriesRes } = useApi('money/categories', { enabled: open });
  const { data: payeesRes } = useApi('money/payees', { enabled: open });
  const accounts = accountsRes?.accounts || [];
  const categories = categoriesRes?.categories || [];
  const payees = payeesRes?.payees || [];

  // Default account: first checking account, else first account.
  useEffect(() => {
    if (open && !form.account_id && accounts.length) {
      const def = accounts.find((a) => a.type === 'checking') || accounts[0];
      setForm((f) => ({ ...f, account_id: def.id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accounts.length]);

  useEffect(() => {
    const onKey = (e) => {
      // Never hijack Ctrl+N while the user is typing in some other field.
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n' && !typing) {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => payeeRef.current?.focus(), 30);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Escape only while the modal is actually open (so it can't race other
  // Escape handlers like ConfirmDialog's).
  useEffect(() => {
    if (!open) return;
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open]);

  // Lets the command palette's "Add a transaction" action open Quick Add
  // without either component knowing about the other directly.
  useEffect(() => {
    const onOpenEvent = () => {
      setOpen(true);
      setTimeout(() => payeeRef.current?.focus(), 30);
    };
    window.addEventListener('mmm:quickadd', onOpenEvent);
    return () => window.removeEventListener('mmm:quickadd', onOpenEvent);
  }, []);

  const suggestions = useMemo(() => {
    const q = form.payee.trim().toLowerCase();
    if (!q) return [];
    return payees
      .filter((p) => p.payee.toLowerCase().includes(q) && p.payee.toLowerCase() !== q)
      .slice(0, 6);
  }, [form.payee, payees]);

  function pickSuggestion(p) {
    setForm((f) => ({ ...f, payee: p.payee, category_id: f.category_id || p.category_id || '' }));
    setShowSuggestions(false);
    setHl(-1);
  }

  // When the typed payee exactly matches history, suggest its usual category.
  function onPayeeBlurSuggest() {
    const hit = payees.find((p) => p.payee.toLowerCase() === form.payee.trim().toLowerCase());
    if (hit && !form.category_id && hit.category_id) {
      setForm((f) => ({ ...f, category_id: hit.category_id }));
    }
  }

  async function save({ stayOpen = false } = {}) {
    const amt = Math.abs(parseFloat(form.amount));
    if (!form.account_id || !form.date || !Number.isFinite(amt) || amt === 0) {
      toast.error('Need a date, an account, and a non-zero amount.');
      return;
    }
    setSaving(true);
    try {
      await api('money/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: form.account_id,
          date: form.date,
          amount: kind === 'expense' ? -amt : amt,
          payee: form.payee.trim(),
          category_id: form.category_id || undefined,
          note: form.note || '',
        }),
      });
      toast.success(`${form.payee.trim() || 'Transaction'} saved.`);
      queryClient.invalidateQueries();
      if (stayOpen) {
        setForm((f) => ({ ...BLANK, date: f.date, account_id: f.account_id }));
        setHl(-1);
        payeeRef.current?.focus();
      } else {
        setForm(BLANK);
        setOpen(false);
      }
    } catch (err) {
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const onFormKeyDown = (e) => {
    if (e.target?.type === 'date') return; // let the native date picker keep its Enter
    if (e.key === 'Enter' && showSuggestions && hl >= 0 && suggestions[hl]) {
      e.preventDefault();
      pickSuggestion(suggestions[hl]);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      save({ stayOpen: e.shiftKey });
    }
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault();
      setShowSuggestions(true);
      setHl((h) => (h + 1) % suggestions.length);
    }
    if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault();
      setHl((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
    }
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1050, background: 'rgba(9, 12, 18, 0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh' }}
    >
      <div
        role="dialog"
        aria-label="Quick add transaction"
        onKeyDown={onFormKeyDown}
        style={{ background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 14, boxShadow: 'var(--m-shadow)', padding: 20, width: '100%', maxWidth: 460 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Zap size={16} style={{ color: 'var(--m-accent)' }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--m-ink)', flex: 1 }}>Quick add</div>
          <div style={{ fontSize: 11, color: 'var(--m-muted)' }}>Enter saves · Shift+Enter keeps going · Esc closes</div>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['expense', '− Expense'], ['income', '+ Income']].map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className="m-no-drag"
                style={{
                  flex: 1, fontSize: 13, fontWeight: 600, padding: '8px 0', borderRadius: 8, cursor: 'pointer',
                  border: '1px solid var(--m-border)',
                  background: kind === k ? (k === 'expense' ? 'var(--m-red)' : 'var(--m-green)') : 'var(--m-surface-2)',
                  color: kind === k ? '#fff' : 'var(--m-ink-2)',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ position: 'relative' }}>
            <input
              ref={payeeRef}
              className="m-input"
              placeholder="Payee"
              value={form.payee}
              onChange={(e) => { setForm((f) => ({ ...f, payee: e.target.value })); setShowSuggestions(true); setHl(-1); }}
              onBlur={() => { setTimeout(() => setShowSuggestions(false), 120); onPayeeBlurSuggest(); }}
              style={{ width: '100%' }}
            />
            {showSuggestions && suggestions.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, marginTop: 4, background: 'var(--m-surface)', border: '1px solid var(--m-border)', borderRadius: 10, boxShadow: 'var(--m-shadow)', overflow: 'hidden' }}>
                {suggestions.map((p, i) => (
                  <button
                    key={p.payee}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); pickSuggestion(p); }}
                    style={{
                      display: 'flex', justifyContent: 'space-between', width: '100%', padding: '8px 12px',
                      border: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left',
                      background: i === hl ? 'var(--m-surface-2)' : 'transparent', color: 'var(--m-ink)',
                    }}
                  >
                    <span>{p.payee}</span>
                    <span style={{ color: 'var(--m-muted)', fontSize: 12 }}>{p.uses}×</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="m-input"
              type="number"
              step="0.01"
              min="0.01"
              inputMode="decimal"
              placeholder="Amount"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              style={{ flex: 1, fontVariantNumeric: 'tabular-nums' }}
            />
            <input
              className="m-input"
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              style={{ width: 150 }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <select
              className="m-input"
              value={form.category_id}
              onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
              style={{ flex: 1 }}
            >
              <option value="">Auto category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              className="m-input"
              value={form.account_id}
              onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))}
              style={{ flex: 1 }}
            >
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <input
            className="m-input"
            placeholder="Note (optional)"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button className="m-btn m-btn-secondary m-btn-sm" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="m-btn m-btn-primary m-btn-sm" type="button" disabled={saving} onClick={() => save()}>
              {saving ? 'Saving…' : 'Add transaction'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
