import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { queryClient, fetchSettings } from './lib/query';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/space-grotesk';
import './styles/theme.css';
import './styles/money-theme.css';
import { applyTheme, applyDensity, applyAccent, clearAccent } from './lib/theme';

// Pre-teal accents that must not resurrect the old blue identity.
const RETIRED_ACCENTS = new Set(['#0071e3', '#2f86ff']);

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
  // 'system' was the pre-v3 default; dark is the v3 default, so only honour an explicit pick.
  if (!localStorage.getItem('mmm-theme') && a.theme && a.theme !== 'system') applyTheme(a.theme);
  if (!localStorage.getItem('mmm-density') && a.density) applyDensity(a.density);
  if (!localStorage.getItem('mmm-accent') && a.accent) {
    // Ignore retired blue accents saved by earlier builds so MMM's teal
    // identity is what shows; also scrub it from the server settings.
    if (RETIRED_ACCENTS.has(a.accent)) {
      clearAccent();
      import('./lib/query').then(({ saveSettings }) => saveSettings({ appearance: { accent: '' } }).catch(() => {}));
    } else {
      applyAccent(a.accent);
    }
  }
}).catch(() => {});
