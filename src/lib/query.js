import { QueryClient, useQuery } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

export async function api(path, opts = {}) {
  // Default the JSON Content-Type whenever a string body is sent — Express's
  // json middleware only parses when it's set, so without this a POST/PUT body
  // is silently dropped and validators 400. Callers can't forget it now.
  // X-MMM-Client marks the request as coming from this app: the server refuses
  // writes without it, which a cross-site form or beacon can't forge (see
  // server/request-guard.js).
  const options = { ...opts, headers: { 'X-MMM-Client': '1', ...opts.headers } };
  if (typeof options.body === 'string') {
    options.headers = { 'Content-Type': 'application/json', ...options.headers };
  }
  const res = await fetch('/api/' + String(path).replace(/^\/+/, ''), options);
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
