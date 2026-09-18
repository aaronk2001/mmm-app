import { useEffect, useRef, useState } from 'react';

// Only the shortcuts that actually exist — no G-prefixed navigation, that
// isn't implemented this phase.
const SHORTCUTS = [
  ['Ctrl K', 'Open the command palette'],
  ['?', 'Show this shortcut sheet'],
  ['Esc', 'Close dialogs'],
];

// `?` shortcut sheet. Self-mounting, like CommandPalette. Ignores `?` while
// the user is typing so it never blocks typing a literal question mark.
export default function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if (e.key === '?') {
        const t = e.target;
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        if (!typing) setOpen(true);
        return;
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => panelRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="m-palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div ref={panelRef} className="m-shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabIndex={-1}>
        <div className="m-shortcuts-title">Keyboard shortcuts</div>
        <table className="m-shortcuts-table">
          <tbody>
            {SHORTCUTS.map(([key, desc]) => (
              <tr key={key}>
                <td><kbd className="m-palette-kbd">{key}</kbd></td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
