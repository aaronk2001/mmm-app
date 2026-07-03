import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { queryClient, fetchSettings } from './lib/query';
import './styles/theme.css';
import './styles/money-theme.css';
import { applyTheme, applyDensity, applyAccent } from './lib/theme';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);

// Hydrate appearance from the server only when local prefs are unset (fresh device
// or packaged first run). No-op when localStorage already has them, so no flash.
fetchSettings().then((s) => {
  const a = s?.appearance;
  if (!a) return;
  if (!localStorage.getItem('mmm-theme') && a.theme) applyTheme(a.theme);
  if (!localStorage.getItem('mmm-density') && a.density) applyDensity(a.density);
  if (!localStorage.getItem('mmm-accent') && a.accent) applyAccent(a.accent);
}).catch(() => {});
