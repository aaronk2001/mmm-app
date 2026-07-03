import { QueryClient, useQuery } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

export async function api(path, opts) {
  const res = await fetch('/api/' + String(path).replace(/^\/+/, ''), opts);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Simple GET hook keyed by path.
export function useApi(path, options) {
  return useQuery({ queryKey: [path], queryFn: () => api(path), ...options });
}

export const fetchSettings = () => api('settings');
export const saveSettings = (partial) =>
  api('settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(partial) });
