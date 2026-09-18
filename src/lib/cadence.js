// Client mirror of the server's per-month normalization (server/money/runway.js
// perMonth, duplicated again in calc.js and tools/profile.js). A browser module
// can't import those CommonJS files, so this is the one client-side copy —
// tests/cadence-client.test.mjs pins it against the same table. Do not add a
// second copy inline in a component.
export function perMonth(amount, cadence) {
  const a = Math.abs(Number(amount) || 0);
  if (cadence === 'weekly') return a * 52 / 12;
  if (cadence === 'biweekly') return a * 26 / 12;
  if (cadence === 'quarterly') return a / 3;
  if (cadence === 'annual') return a / 12;
  return a; // monthly
}

export const perYear = (amount, cadence) => perMonth(amount, cadence) * 12;
