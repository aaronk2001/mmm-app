import { useState, useEffect, useRef, useMemo, useCallback, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '../../../lib/query';

// Subsequence fuzzy match (NEXUS CommandPalette's algorithm) — every query
// character must appear in order in the target string, not necessarily
// adjacent. Empty query matches everything.
function fuzzyMatch(query, str) {
  if (!query) return true;
  const q = query.toLowerCase(); const s = str.toLowerCase();
  let qi = 0;
  for (let i = 0; i < s.length && qi < q.length; i++) if (s[i] === q[qi]) qi++;
  return qi === q.length;
}

const ACTIONS = [
  { id: 'act-quickadd', label: 'Add a transaction',  meta: 'Action', run: () => window.dispatchEvent(new CustomEvent('mmm:quickadd')) },
  { id: 'act-settings', label: 'Open Settings',      meta: 'Action', to: '/settings' },
  { id: 'act-offer',    label: 'Model a job offer',  meta: 'Action', to: '/plan/offer' },
];

const GROUP_CAP = 5;

// Ctrl+K command palette: fuzzy search over sections, accounts, payees and
// actions, with full keyboard navigation. Self-mounting — mount it once and
// it owns its own open state and key listeners.
export default function CommandPalette({ sections }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [accounts, setAccounts] = useState([]);
  const [payees, setPayees] = useState([]);
  const fetchedRef = useRef(false);
  const inputRef = useRef(null);
  const listboxId = useId();
  const navigate = useNavigate();

  // `open` is read from a ref inside the listener so the listener itself can
  // be registered exactly once (mount) and torn down exactly once (unmount)
  // instead of being re-subscribed on every open/close.
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);

  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); // block the browser's own find-in-page / address-bar shortcut
        setOpen((o) => !o);
        return;
      }
      if (e.key === 'Escape' && openRef.current) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Reset query + focus the input on open; on close, release focus back to
  // the page rather than leaving it stuck on a now-invisible row/input.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
  }, [open]);

  // Fetch accounts/payees once per open (not once per keystroke). A failed
  // fetch just leaves the list empty — the palette still works with
  // sections + actions, never surfaces an error.
  useEffect(() => {
    if (!open) { fetchedRef.current = false; return; }
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    api('money/accounts').then((r) => setAccounts(r?.accounts || [])).catch(() => setAccounts([]));
    api('money/payees?limit=100').then((r) => setPayees(r?.payees || [])).catch(() => setPayees([]));
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  const close = useCallback(() => setOpen(false), []);

  const runItem = useCallback((item) => {
    if (!item) return;
    if (item.type === 'section') navigate(`/${item.id}`);
    else if (item.type === 'account') navigate('/accounts');
    else if (item.type === 'payee') navigate(`/transactions?payee=${encodeURIComponent(item.label)}`);
    else if (item.type === 'action') {
      if (item.run) item.run();
      else if (item.to) navigate(item.to);
    }
    close();
  }, [navigate, close]);

  // Result groups in a fixed order — Sections, Accounts, Payees, Actions —
  // each capped at 5 rows.
  const groups = useMemo(() => {
    const sectionItems = sections
      .filter((s) => fuzzyMatch(query, s.label))
      .slice(0, GROUP_CAP)
      .map((s) => ({ type: 'section', id: s.id, label: s.label, Icon: s.icon, meta: 'Section' }));
    const accountItems = accounts
      .filter((a) => fuzzyMatch(query, a.name))
      .slice(0, GROUP_CAP)
      .map((a) => ({ type: 'account', id: a.id, label: a.name, meta: 'Account' }));
    const payeeItems = payees
      .filter((p) => fuzzyMatch(query, p.payee))
      .slice(0, GROUP_CAP)
      .map((p) => ({ type: 'payee', id: p.payee, label: p.payee, meta: 'Payee' }));
    const actionItems = ACTIONS
      .filter((a) => fuzzyMatch(query, a.label))
      .slice(0, GROUP_CAP)
      .map((a) => ({ type: 'action', id: a.id, label: a.label, meta: a.meta, run: a.run, to: a.to }));
    return [
      { label: 'Sections', items: sectionItems },
      { label: 'Accounts', items: accountItems },
      { label: 'Payees', items: payeeItems },
      { label: 'Actions', items: actionItems },
    ].filter((g) => g.items.length > 0);
  }, [sections, accounts, payees, query]);

  // The flattened list is what arrow keys actually walk — wrapping happens
  // across this list, not per-group.
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const clampedIndex = flat.length ? Math.min(activeIndex, flat.length - 1) : -1;

  function onInputKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flat.length) setActiveIndex((i) => (i + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length) setActiveIndex((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runItem(flat[clampedIndex]);
    }
  }

  if (!open) return null;

  return (
    <div className="m-palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="m-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="m-palette-input-row">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            className="m-palette-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search sections, accounts, payees, actions…"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={clampedIndex >= 0 ? `${listboxId}-${clampedIndex}` : undefined}
          />
        </div>

        {flat.length > 0 ? (
          <div className="m-palette-list" role="listbox" id={listboxId}>
            {groups.map((group) => (
              <div key={group.label}>
                <div className="m-palette-group-label">{group.label}</div>
                {group.items.map((item) => {
                  const idx = flat.indexOf(item);
                  const isActive = idx === clampedIndex;
                  const Icon = item.Icon;
                  return (
                    <button
                      key={`${item.type}-${item.id}`}
                      type="button"
                      id={`${listboxId}-${idx}`}
                      role="option"
                      aria-selected={isActive}
                      tabIndex={-1}
                      className={`m-palette-row${isActive ? ' active' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => runItem(item)}
                    >
                      {Icon && <span className="m-palette-row-icon"><Icon size={15} aria-hidden="true" /></span>}
                      <span className="m-palette-row-label">{item.label}</span>
                      <span className="m-palette-row-meta">{item.meta}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="m-palette-empty">No results{query ? ` for "${query}"` : ''}.</div>
        )}

        <div className="m-palette-footer">
          <span className="m-palette-hint"><kbd className="m-palette-kbd">↑↓</kbd> navigate</span>
          <span className="m-palette-hint"><kbd className="m-palette-kbd">↵</kbd> select</span>
          <span className="m-palette-hint"><kbd className="m-palette-kbd">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
