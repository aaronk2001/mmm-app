// Runtime theme control. The initial state is applied by the no-flash boot
// script in index.html; these helpers change it live and persist the choice.
// Settings & Privacy (Phase 4) will drive these; exposed on window for now.

const BG = { light: '#f6f7f9', dark: '#0b0e14' };

export function resolveTheme(pref) {
  if (pref === 'dark' || pref === 'light') return pref;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(pref = 'system') {
  const t = resolveTheme(pref);
  const de = document.documentElement;
  de.setAttribute('data-theme', t);
  de.style.colorScheme = t;
  de.style.backgroundColor = BG[t];
  try { localStorage.setItem('mmm-theme', pref); } catch {}
  return t;
}

export function applyDensity(density = 'comfortable') {
  document.documentElement.setAttribute('data-density', density);
  try { localStorage.setItem('mmm-density', density); } catch {}
}

export function applyAccent(hex) {
  if (!hex) return;
  document.documentElement.style.setProperty('--accent', hex);
  try { localStorage.setItem('mmm-accent', hex); } catch {}
}

export function getTheme() { try { return localStorage.getItem('mmm-theme') || 'system'; } catch { return 'system'; } }
export function getDensity() { try { return localStorage.getItem('mmm-density') || 'comfortable'; } catch { return 'comfortable'; } }
export function getAccent() { try { return localStorage.getItem('mmm-accent') || ''; } catch { return ''; } }

// Keep in sync if the user is on "system" and the OS theme changes.
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme('system');
  });
} catch {}

// Dev/runtime handle (Settings UI will import the functions directly).
if (typeof window !== 'undefined') {
  window.mmmTheme = { applyTheme, applyDensity, applyAccent, getTheme, getDensity, getAccent };
}
