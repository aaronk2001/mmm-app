'use strict';

// Deterministic financial-advice engine. Pure: takes already-computed metrics
// and data in, returns ranked plain-English recommendations out. No I/O, no DB,
// no model — every number is derived arithmetically, so the advice is instant,
// offline, and can never hallucinate a figure. The optional LLM coach only
// rephrases these findings; it never produces the numbers.
//
// A Finding:
//   { id, severity, category, title, detail, impact, action, proposal? }
// severity: 'critical' | 'warn' | 'info' | 'good'
// impact:   0-100 ranking score (higher = surfaced first / nudged)
// action:   { label, route, params } | null  — deep-link to the fixing screen
// proposal: { action, params, title, fields, consequence, verb, fingerprint } — a reversible
//           apply-action the user can confirm; fingerprint pins the numbers it was built on

const { createHash } = require('node:crypto');
const { localDateFromStr } = require('./calc');

const SEVERITY_FLOOR = { critical: 80, warn: 55, info: 25, good: 5 };

const money = (n) => {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US');
};
const stableJson = (v) => {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
};
const fingerprint = (obj) => createHash('sha1').update(stableJson(obj)).digest('hex').slice(0, 16);
const pct = (n) => `${Math.round((Number(n) || 0) * 100)}%`;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Rank within a severity band by a 0-1 "how bad / how big" factor.
const scored = (severity, factor) =>
  Math.round(SEVERITY_FLOOR[severity] + clamp(Number(factor) || 0, 0, 1) * 18);

// input shape (all optional — every rule guards its own inputs):
//   metrics        getMetrics(): savings_rate, runway_months, monthly_income,
//                  monthly_expenses, monthly_surplus, liquid_savings, debt_total, …
//   goalInsights   computeGoalInsights(): { emergencyFund: { adequacy, monthsCovered, targetAmount, currentSaved, monthlyExpenses } }
//   budgetStatus   [{ category_id, limit, spent, pct }]
//   categories     [{ id, name }]
//   cashflow       projectCashflow(): { summary: { lowestBalance, lowestDate, endBalance }, lowBalanceWarnings: [] }
//   debts          [{ name, balance, apr }]
//   goals          [{ id, name, target, current, monthly_contribution, target_date, linked_account_id }]
//   accounts       [{ id, balance }]  (for linked-goal balances)
//   recurring      detectRecurring(): [{ payee, amount, cadence, kind }]
//   investments    computeInvestmentMetrics(): { marketValue, allocation: [{ symbol, pct }] }
//   spendThisMonth number  (absolute expense total, current month)
//   spendLastMonth number  (absolute expense total, previous full month)
function computeAdvice(input = {}, { dismissed = {} } = {}) {
  const {
    metrics = {},
    goalInsights = {},
    budgetStatus = [],
    categories = [],
    cashflow = {},
    debts = [],
    goals = [],
    accounts = [],
    recurring = [],
    investments = {},
    spendThisMonth = 0,
    spendLastMonth = 0,
  } = input;

  const catName = (id) => categories.find((c) => c.id === id)?.name || 'that category';
  const findings = [];
  const add = (f) => findings.push(f);

  const income = Number(metrics.monthly_income) || 0;
  const expenses = Number(metrics.monthly_expenses) || 0;
  const hasActivity = income > 0 || expenses > 0 || accounts.length > 0;
  if (!hasActivity) return []; // nothing to advise on yet

  // ── 1. Emergency fund ──────────────────────────────────────────────────────
  const ef = goalInsights.emergencyFund;
  const efProposal = () => {
    if (!(ef.targetAmount > 0) || goals.some((g) => /emergency/i.test(g.name))) return undefined;
    const target = Math.round(ef.targetAmount);
    const current = Math.round(ef.currentSaved || 0);
    return {
      action: 'create_goal',
      params: { name: 'Emergency fund', target, current },
      title: `Create a goal "Emergency fund" for ${money(target)}`,
      fields: [
        { label: 'Target', value: money(target) },
        { label: 'Already saved', value: money(current) },
        { label: 'Covers', value: `${ef.targetMonths || 6} months of expenses` },
      ],
      consequence: 'Adds a goal to track. Nothing moves money.',
      verb: 'Create goal',
      fingerprint: fingerprint({ rule: 'emergency-fund', target, current }),
    };
  };
  if (ef && ef.monthlyExpenses > 0) {
    if (ef.adequacy === 'low') {
      add({
        id: 'emergency-fund-low',
        severity: 'critical',
        category: 'emergency',
        title: 'Your safety net is thin',
        detail: `You've got about ${ef.monthsCovered} month${ef.monthsCovered === 1 ? '' : 's'} of expenses saved. Build to at least 3 — that's ${money(ef.monthlyExpenses * 3)}. This comes before anything else.`,
        impact: scored('critical', 1 - clamp(ef.monthsCovered / 3, 0, 1)),
        action: { label: 'Set an emergency-fund goal', route: '/goals', params: {} },
        proposal: efProposal(),
      });
    } else if (ef.adequacy === 'ok') {
      add({
        id: 'emergency-fund-ok',
        severity: 'info',
        category: 'emergency',
        title: 'Emergency fund is getting there',
        detail: `${ef.monthsCovered} months banked. Push to a full 6 months (${money(ef.targetAmount)}) and you're bulletproof.`,
        impact: scored('info', 0.6),
        action: { label: 'Review goals', route: '/goals', params: {} },
        proposal: efProposal(),
      });
    } else if (ef.adequacy === 'good') {
      add({
        id: 'emergency-fund-good',
        severity: 'good',
        category: 'emergency',
        title: 'Emergency fund is solid',
        detail: `${ef.monthsCovered} months saved — you're covered. Any extra cash can go to debt or investing now.`,
        impact: scored('good', 0.5),
        action: null,
      });
    }
  }

  // ── 2. Cash runway ─────────────────────────────────────────────────────────
  const runway = Number(metrics.runway_months) || 0;
  if (expenses > 0 && runway > 0 && runway < 3) {
    const critical = runway < 1;
    add({
      id: 'runway-low',
      severity: critical ? 'critical' : 'warn',
      category: 'cashflow',
      title: critical ? 'You have under a month of runway' : 'Short runway',
      detail: `Your liquid cash covers about ${runway.toFixed(1)} months of spending. ${critical ? 'One surprise bill and you\'re in trouble — hold spending and pad the buffer now.' : 'Aim for 3+ months so a bad month can\'t sink you.'}`,
      impact: scored(critical ? 'critical' : 'warn', 1 - clamp(runway / 3, 0, 1)),
      action: { label: 'See cash flow', route: '/cashflow', params: {} },
    });
  }

  // ── 3. Savings rate ────────────────────────────────────────────────────────
  const sr = Number(metrics.savings_rate) || 0;
  if (income > 0) {
    if (metrics.monthly_surplus < 0) {
      add({
        id: 'savings-negative',
        severity: 'critical',
        category: 'savings',
        title: "You're spending more than you earn",
        detail: `You're ${money(Math.abs(metrics.monthly_surplus))}/mo in the red. That's the fire to put out first — find the biggest cut below and make it this week.`,
        impact: scored('critical', clamp(Math.abs(metrics.monthly_surplus) / (income || 1), 0, 1)),
        action: { label: 'Find spending to cut', route: '/reports', params: {} },
      });
    } else if (sr < 0.1) {
      add({
        id: 'savings-rate-low',
        severity: 'warn',
        category: 'savings',
        title: 'Savings rate is low',
        detail: `You're keeping ${pct(sr)} of what you earn. Get that to 20% (${money(income * 0.2)}/mo) and everything else — emergency fund, debt, retirement — gets easier.`,
        impact: scored('warn', 1 - clamp(sr / 0.2, 0, 1)),
        action: { label: 'See income vs. expenses', route: '/reports', params: {} },
      });
    }
  }

  // ── 4. Budget overspend ────────────────────────────────────────────────────
  budgetStatus
    .filter((b) => b.limit > 0)
    .forEach((b) => {
      const over = b.pct > 100;
      if (!over && b.pct < 85) return;
      const name = catName(b.category_id);
      add({
        id: `budget-${b.category_id}`,
        severity: over ? 'warn' : 'info',
        category: 'budget',
        title: over ? `Over budget on ${name}` : `Close to your ${name} limit`,
        detail: over
          ? `You've spent ${money(b.spent)} of your ${money(b.limit)} ${name} budget — ${b.pct - 100}% over. Ease off for the rest of the month.`
          : `${b.pct}% of your ${name} budget used. Watch it the rest of the month.`,
        impact: scored(over ? 'warn' : 'info', clamp((b.pct - 85) / 60, 0, 1)),
        action: { label: `Review ${name}`, route: '/transactions', params: { category: name } },
      });
    });

  // ── 5. Cash-flow dip (projection goes low/negative) ────────────────────────
  const cf = cashflow.summary;
  if (cf && Number.isFinite(cf.lowestBalance)) {
    if (cf.lowestBalance < 0) {
      add({
        id: 'cashflow-negative',
        severity: 'critical',
        category: 'cashflow',
        title: 'Your balance is projected to go negative',
        detail: `Based on your bills and spending pace, your cash dips to ${money(cf.lowestBalance)} around ${cf.lowestDate}. Move money or cut a bill before then.`,
        impact: scored('critical', 0.8),
        action: { label: 'See the projection', route: '/cashflow', params: {} },
      });
    } else if (cf.lowestBalance < 500) {
      add({
        id: 'cashflow-tight',
        severity: 'warn',
        category: 'cashflow',
        title: 'Cash gets tight soon',
        detail: `Your projected low is ${money(cf.lowestBalance)} around ${cf.lowestDate}. Keep a cushion so an autopay doesn't bounce.`,
        impact: scored('warn', 1 - clamp(cf.lowestBalance / 500, 0, 1)),
        action: { label: 'See the projection', route: '/cashflow', params: {} },
      });
    }
  }

  // ── 6. Highest-APR debt (avalanche target) ─────────────────────────────────
  const activeDebts = debts.filter((d) => (Number(d.balance) || 0) > 0);
  if (activeDebts.length) {
    const target = activeDebts.slice().sort((a, b) => (b.apr || 0) - (a.apr || 0))[0];
    const apr = Number(target.apr) || 0;
    const monthlyInterest = (Number(target.balance) || 0) * (apr / 12);
    if (apr >= 0.1) {
      add({
        id: 'debt-avalanche-target',
        severity: 'warn',
        category: 'debt',
        title: `Attack ${target.name} first`,
        detail: `At ${pct(apr)} APR it's your most expensive debt — costing about ${money(monthlyInterest)}/mo in interest on ${money(target.balance)}. Throw every extra dollar here.`,
        impact: scored('warn', clamp(monthlyInterest / 100, 0, 1)),
        action: { label: 'Plan the payoff', route: '/debt', params: {} },
      });
    }
  }

  // ── 7. Goals off-pace ──────────────────────────────────────────────────────
  const balanceOf = (id) => {
    const a = accounts.find((x) => x.id === id);
    return a && Number.isFinite(Number(a.balance)) ? Number(a.balance) : null;
  };
  const today = new Date();
  goals.forEach((g) => {
    const target = Number(g.target) || 0;
    const contrib = Number(g.monthly_contribution) || 0;
    if (!target || !contrib || !g.target_date) return;
    const linked = g.linked_account_id ? balanceOf(g.linked_account_id) : null;
    const current = linked != null ? linked : Number(g.current) || 0;
    const remaining = Math.max(0, target - current);
    if (remaining <= 0) return;
    const td = localDateFromStr(g.target_date);
    const monthsLeft = (td.getFullYear() - today.getFullYear()) * 12 + (td.getMonth() - today.getMonth());
    if (monthsLeft <= 0) return;
    const needed = remaining / monthsLeft;
    if (needed > contrib * 1.05) {
      const raised = Math.ceil(needed);
      add({
        id: `goal-behind-${g.id}`,
        severity: 'info',
        category: 'goals',
        title: `"${g.name}" is behind pace`,
        detail: `To hit ${money(target)} by ${g.target_date} you'd need ${money(needed)}/mo, but you're putting in ${money(contrib)}. Bump it ${money(needed - contrib)} or push the date.`,
        impact: scored('info', clamp((needed - contrib) / (needed || 1), 0, 1)),
        action: { label: 'Adjust the goal', route: '/goals', params: {} },
        proposal: {
          action: 'update_goal_contribution',
          params: { goal_id: g.id, monthly_contribution: raised },
          title: `Raise "${g.name}" to ${money(raised)}/mo`,
          fields: [
            { label: 'Now', value: `${money(contrib)}/mo` },
            { label: 'Needed', value: `${money(raised)}/mo` },
            { label: 'By', value: g.target_date },
          ],
          consequence: 'Changes the plan only. Nothing moves money.',
          verb: 'Raise contribution',
          fingerprint: fingerprint({
            rule: 'goal-behind', goal_id: g.id, target: g.target, current,
            monthly_contribution: g.monthly_contribution, target_date: g.target_date,
            monthly_contribution_proposed: raised,
          }),
        },
      });
    }
  });

  // ── 8. Recurring-bill load ─────────────────────────────────────────────────
  const bills = recurring.filter((r) => r.kind === 'bill');
  if (bills.length && income > 0) {
    const monthlyBill = (r) => (
      r.cadence === 'weekly' ? r.amount * 4.33
        : r.cadence === 'biweekly' ? r.amount * 2.17
        : r.cadence === 'quarterly' ? r.amount / 3
        : r.cadence === 'annual' ? r.amount / 12
        : r.amount // monthly
    );
    const totalBills = bills.reduce((s, r) => s + monthlyBill(r), 0);
    const biggest = bills.slice().sort((a, b) => monthlyBill(b) - monthlyBill(a))[0];
    if (totalBills > income * 0.4) {
      add({
        id: 'recurring-heavy',
        severity: 'info',
        category: 'subscriptions',
        title: 'Recurring bills eat a big slice',
        detail: `Your ${bills.length} recurring bills run about ${money(totalBills)}/mo — ${pct(totalBills / income)} of income. ${biggest.payee} (${money(monthlyBill(biggest))}/mo) is the largest; cancel one you don't use.`,
        impact: scored('info', clamp(totalBills / income, 0, 1)),
        action: { label: 'Review subscriptions', route: '/cashflow', params: { hash: 'subscriptions' } },
      });
    }
  }

  // ── 9. Investment concentration ────────────────────────────────────────────
  const alloc = investments.allocation || [];
  if ((investments.marketValue || 0) > 0 && alloc.length > 1) {
    const top = alloc[0];
    if (top && top.pct > 60) {
      add({
        id: 'concentration',
        severity: 'info',
        category: 'concentration',
        title: `${top.symbol} is a big bet`,
        detail: `${top.symbol} is ${Math.round(top.pct)}% of your holdings. Great if it runs, painful if it drops — consider spreading it out.`,
        impact: scored('info', clamp((top.pct - 60) / 40, 0, 1)),
        action: { label: 'See investments', route: '/investments', params: {} },
      });
    }
  }

  // ── 10. Month-over-month spending spike ────────────────────────────────────
  if (spendLastMonth > 0 && spendThisMonth > spendLastMonth * 1.25) {
    const up = (spendThisMonth - spendLastMonth) / spendLastMonth;
    add({
      id: 'spending-spike',
      severity: 'info',
      category: 'spending',
      title: 'Spending is up this month',
      detail: `You've spent ${money(spendThisMonth)} so far vs ${money(spendLastMonth)} all of last month — up ${pct(up)}. Worth a look before it becomes the new normal.`,
      impact: scored('info', clamp(up, 0, 1)),
      action: { label: 'See reports', route: '/reports', params: {} },
    });
  }

  for (const f of findings) {
    if (!f.proposal || dismissed[f.id] === f.proposal.fingerprint) delete f.proposal;
  }

  return findings.sort((a, b) => b.impact - a.impact);
}

// Weekly digest — a once-a-week, opinionated summary of the last 7 days.
// Pure: the route sums the week's transactions and passes the totals in.
//   input = {
//     weekOf,          'YYYY-MM-DD' start of this week
//     savedThisWeek,   income - expenses over the last 7 days
//     spendThisWeek, spendLastWeek,
//     netWorthDelta,   change vs ~7 days ago (null if no history)
//     topMover,        { category, delta } | null  (biggest category increase)
//     emergencyFund,   goalInsights.emergencyFund | null
//     findings,        ranked findings from computeAdvice()
//   }
function computeDigest(input = {}) {
  const {
    weekOf = '',
    savedThisWeek = 0,
    spendThisWeek = 0,
    spendLastWeek = 0,
    netWorthDelta = null,
    topMover = null,
    emergencyFund = null,
    findings = [],
  } = input;

  const saved = Math.round(savedThisWeek);
  const headline = saved > 0
    ? `Good week — you saved ${money(saved)}.`
    : saved < 0
      ? `Tight week — you spent ${money(-saved)} more than you earned.`
      : 'You broke even this week.';

  const stats = [];
  stats.push({ label: 'Saved this week', value: money(saved), tone: saved >= 0 ? 'good' : 'bad' });

  if (spendLastWeek > 0) {
    const change = (spendThisWeek - spendLastWeek) / spendLastWeek;
    stats.push({
      label: 'Spending vs last week',
      value: money(spendThisWeek),
      delta: `${change >= 0 ? '+' : ''}${pct(change)}`,
      tone: change > 0.1 ? 'bad' : change < -0.1 ? 'good' : 'neutral',
    });
  } else {
    stats.push({ label: 'Spent this week', value: money(spendThisWeek), tone: 'neutral' });
  }

  if (netWorthDelta != null) {
    stats.push({
      label: 'Net worth',
      value: `${netWorthDelta >= 0 ? '+' : ''}${money(netWorthDelta)}`,
      tone: netWorthDelta >= 0 ? 'good' : 'bad',
    });
  }

  if (emergencyFund && emergencyFund.monthlyExpenses > 0) {
    stats.push({
      label: 'Emergency fund',
      value: `${emergencyFund.monthsCovered} mo`,
      tone: emergencyFund.adequacy === 'good' ? 'good' : emergencyFund.adequacy === 'ok' ? 'neutral' : 'bad',
    });
  }

  if (topMover && topMover.delta > 0) {
    stats.push({ label: `${topMover.category} up`, value: money(topMover.delta), tone: 'bad' });
  }

  return {
    weekOf,
    headline,
    stats,
    topFindings: findings.filter((f) => f.severity !== 'good').slice(0, 2),
  };
}

module.exports = { computeAdvice, computeDigest, fingerprint };
