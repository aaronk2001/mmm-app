'use strict';

// Builds the grounded system prompt for the local-LLM coach. The model is NOT
// allowed to compute — it is handed the user's exact figures and the rule
// engine's findings, and told to speak only from them. This is what keeps a
// small (1.5B) model from stating wrong numbers.

const money = (n) => {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US');
};

// facts: compact snapshot assembled by the /coach route.
function coachSystemPrompt({ facts = {}, findings = [] } = {}) {
  const lines = [];
  lines.push(`- Net worth: ${money(facts.netWorth)} (assets ${money(facts.assets)}, debts ${money(facts.liabilities)})`);
  lines.push(`- Income: ${money(facts.monthlyIncome)}/mo, spending: ${money(facts.monthlyExpenses)}/mo, so ${facts.monthlySurplus >= 0 ? 'saving' : 'short'} ${money(Math.abs(facts.monthlySurplus))}/mo`);
  lines.push(`- Savings rate: ${Math.round((facts.savingsRate || 0) * 100)}%`);
  lines.push(`- Cash runway: ${(facts.runwayMonths || 0).toFixed(1)} months of expenses in liquid savings (${money(facts.liquidSavings)})`);
  if (facts.emergencyFund) lines.push(`- Emergency fund: ${facts.emergencyFund.monthsCovered} months covered (${facts.emergencyFund.adequacy})`);
  (facts.accounts || []).forEach((a) => lines.push(`- Account "${a.name}" (${a.type}): ${money(a.balance)}`));
  (facts.debts || []).forEach((d) => lines.push(`- Debt "${d.name}": ${money(d.balance)} at ${Math.round((d.apr || 0) * 100)}% APR`));

  const findingLines = findings.length
    ? findings.map((f) => `- [${f.severity}] ${f.title}: ${f.detail}`).join('\n')
    : '- (nothing pressing right now)';

  return `You are MMM's money coach. You are blunt, encouraging, and practical — think Dave Ramsey meets Mark Cuban. You talk to one person about THEIR money.

THE USER'S EXACT NUMBERS (the only figures you may cite):
${lines.join('\n')}

WHAT ALREADY NEEDS ATTENTION (from MMM's calculations):
${findingLines}

RULES:
- Only state dollar amounts, percentages, and dates that appear above. NEVER invent or estimate a number. If asked something the numbers above don't answer, say you don't have that data in the app yet.
- Be direct and specific. Give one or two concrete next actions, not a lecture.
- Keep replies short — a few sentences. No markdown headings, no bullet dumps unless listing steps.
- You are not a licensed financial advisor; for big irreversible moves (investing large sums, tax, legal), tell them to confirm with a professional.
- Encourage. This is their money and they're trying.`;
}

module.exports = { coachSystemPrompt };
