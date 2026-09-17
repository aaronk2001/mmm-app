// WCAG contrast gate over src/styles/theme.css.
// Text tokens must reach 4.5:1 on every surface; chart lines 3:1 on bg + surface;
// accent-ink 4.5:1 on accent. Run: node scripts/check-contrast.mjs (exit 1 on failure).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TEXT_TOKENS = ['--ink', '--ink-2', '--muted', '--accent', '--positive', '--negative', '--warning'];
const SURFACES = ['--bg', '--surface', '--surface-2'];
const CHART_TOKENS = Array.from({ length: 8 }, (_, i) => `--chart-${i + 1}`);
const TEXT_MIN = 4.5;
const CHART_MIN = 3;

export function parseThemes(css) {
  const blocks = {};
  const grab = (selector) => {
    const re = new RegExp(selector.replace(/[[\]"=]/g, (c) => `\\${c}`) + '\\s*\\{([\\s\\S]*?)\\}');
    const m = css.match(re);
    if (!m) throw new Error(`block not found: ${selector}`);
    const vars = {};
    for (const line of m[1].split('\n')) {
      const v = line.match(/^\s*(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/);
      if (v) vars[v[1]] = v[2].toLowerCase();
    }
    return vars;
  };
  blocks.light = grab(':root');
  const dark = grab('[data-theme="dark"]');
  blocks.dark = { ...blocks.light, ...dark };
  return blocks;
}

export function luminance(hex) {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export function checkContrast(css) {
  const themes = parseThemes(css);
  const failures = [];
  const rows = [];
  for (const [theme, t] of Object.entries(themes)) {
    for (const tok of TEXT_TOKENS) {
      for (const sf of SURFACES) {
        const ratio = contrast(t[tok], t[sf]);
        rows.push({ theme, a: tok, b: sf, ratio, min: TEXT_MIN });
        if (ratio < TEXT_MIN) failures.push({ theme, a: tok, b: sf, ratio, min: TEXT_MIN });
      }
    }
    const ai = contrast(t['--accent-ink'], t['--accent']);
    rows.push({ theme, a: '--accent-ink', b: '--accent', ratio: ai, min: TEXT_MIN });
    if (ai < TEXT_MIN) failures.push({ theme, a: '--accent-ink', b: '--accent', ratio: ai, min: TEXT_MIN });
    for (const tok of CHART_TOKENS) {
      for (const sf of ['--bg', '--surface']) {
        const ratio = contrast(t[tok], t[sf]);
        rows.push({ theme, a: tok, b: sf, ratio, min: CHART_MIN });
        if (ratio < CHART_MIN) failures.push({ theme, a: tok, b: sf, ratio, min: CHART_MIN });
      }
    }
  }
  return { rows, failures };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/styles/theme.css');
  const { rows, failures } = checkContrast(readFileSync(file, 'utf8'));
  for (const r of rows) {
    const flag = r.ratio < r.min ? 'FAIL' : ' ok ';
    console.log(`${flag} ${r.theme.padEnd(5)} ${r.a.padEnd(12)} on ${r.b.padEnd(11)} ${r.ratio.toFixed(2)}:1 (min ${r.min})`);
  }
  console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall pairs pass');
  process.exit(failures.length ? 1 : 0);
}
