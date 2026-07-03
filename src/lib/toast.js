import { useEffect, useState } from 'react';

// Tiny module-level toast store — no context provider needed. Components call
// toast.success/error/info; the <Toasts/> host (mounted once in MoneyHub)
// subscribes via useToasts().

let nextId = 1;
let items = [];
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn(items);
}

export function showToast(message, type = 'info', ttl = 4000) {
  const id = nextId++;
  items = [...items, { id, message, type }];
  emit();
  if (ttl > 0) setTimeout(() => dismissToast(id), ttl);
  return id;
}

export function dismissToast(id) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function useToasts() {
  const [list, setList] = useState(items);
  useEffect(() => {
    listeners.add(setList);
    return () => listeners.delete(setList);
  }, []);
  return list;
}

export const toast = {
  success: (m) => showToast(m, 'success'),
  error: (m) => showToast(m, 'error', 6000),
  info: (m) => showToast(m, 'info'),
};
