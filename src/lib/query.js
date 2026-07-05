import { QueryClient, useQuery } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

export async function api(path, opts) {
  const res = await fetch('/api/' + String(path).replace(/^\/+/, ''), opts);
  const text = await res.text();
  if (!res.ok) {
    // Surface the server's error field (validators return real messages there).
    let msg = `${path} → ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) msg = parsed.error;
    } catch { /* keep the status message */ }
    throw new Error(msg);
  }
  return text ? JSON.parse(text) : null;
}

// Simple GET hook keyed by path.
export function useApi(path, options) {
  return useQuery({ queryKey: [path], queryFn: () => api(path), ...options });
}

export const fetchSettings = () => api('settings');
export const saveSettings = (partial) =>
  api('settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(partial) });
