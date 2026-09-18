import { useEffect, useRef } from 'react';

// Shared behaviour for the app's modal dialogs. Three things that only work
// if every dialog agrees on them:
//   - Mutual exclusion. Two elements claiming aria-modal="true" at once is a
//     lie to assistive tech, and they also render as overlapping backdrops.
//     Opening one closes any other.
//   - Focus release on a real open -> close transition only, not on every
//     render where `open` happens to be false (which includes first mount).
//   - Tab and Shift+Tab wrap inside the panel, so the aria-modal claim is
//     honest for sighted keyboard users too.
const OPEN_EVENT = 'mmm:dialog-open';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function useDialog({ id, open, onClose, panelRef, initialFocusRef }) {
  const openerRef = useRef(null);

  useEffect(() => {
    if (open) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
  }, [open, id]);

  useEffect(() => {
    function onOtherOpened(e) { if (e.detail !== id) onClose(); }
    window.addEventListener(OPEN_EVENT, onOtherOpened);
    return () => window.removeEventListener(OPEN_EVENT, onOtherOpened);
  }, [id, onClose]);

  useEffect(() => {
    if (open) {
      // Remember who opened us so focus can go back there on close — the
      // WAI-ARIA dialog contract. Blurring instead would dump the user at the
      // top of the document on the next Tab.
      const opener = document.activeElement;
      openerRef.current = opener instanceof HTMLElement && opener !== document.body ? opener : null;
      const t = setTimeout(() => (initialFocusRef?.current || panelRef.current)?.focus(), 30);
      return () => clearTimeout(t);
    }
    const opener = openerRef.current;
    if (opener) {
      openerRef.current = null;
      if (opener.isConnected) opener.focus();
    }
    return undefined;
  }, [open, panelRef, initialFocusRef]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      // tabIndex >= 0 matters: the palette's option rows are <button
      // tabIndex={-1}>, so a selector-only match would make `last` an element
      // the browser never focuses — neither branch below would fire and Tab
      // would walk straight out of the panel.
      const items = [...panel.querySelectorAll(FOCUSABLE)]
        .filter((el) => el.offsetParent !== null && el.tabIndex >= 0);
      if (!items.length) { e.preventDefault(); panel.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, panelRef]);
}
