export function requiredAnnualReturn(current, monthly, target, years) {
  if (years <= 0) return null;
  const n = years * 12;
  const fv = (i) =>
    i === 0 ? current + monthly * n : current * (1 + i) ** n + monthly * (((1 + i) ** n - 1) / i);
  if (fv(0) >= target) return 0;
  if (fv(1) < target) return null;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (fv(mid) < target) lo = mid;
    else hi = mid;
  }
  return (1 + (lo + hi) / 2) ** 12 - 1;
}

export function assessReturn(r) {
  if (r === null) return { tone: 'bad', text: 'Unreachable at this pace. Raise the contribution or push the date.' };
  if (r <= 0) return { tone: 'good', text: 'On track without any investment growth.' };
  if (r <= 0.04) return { tone: 'good', text: 'Conservative: feasible with a low-risk allocation.' };
  if (r <= 0.08) return { tone: 'info', text: 'Moderate: in line with a diversified long-term portfolio.' };
  if (r <= 0.12) return { tone: 'warn', text: 'Aggressive: high risk, not guaranteed.' };
  return { tone: 'bad', text: 'Unrealistic: extend the date, raise contributions, or lower the target.' };
}

export function monthsBetweenDates(fromStr, toStr) {
  const [fy, fm] = fromStr.split('-').map(Number);
  const [ty, tm] = toStr.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function requiredReturnFor({ current, monthly, target, targetDate, today = new Date() }) {
  if (!targetDate || target <= 0 || target <= current) return null;
  const todayStr = isoDate(today);
  const months = monthsBetweenDates(todayStr, targetDate);
  const years = months / 12;
  if (targetDate < todayStr) {
    return { years, annualReturn: null, assessment: { tone: 'warn', text: 'Target date has passed.' } };
  }
  const annualReturn = requiredAnnualReturn(current, monthly || 0, target, years);
  return { years, annualReturn, assessment: assessReturn(annualReturn) };
}
