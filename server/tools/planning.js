// Financial planning models — pure, no I/O. Dollars in, dollars out.
// TAX TABLES ARE 2024 (plan ruling R3): every take-home figure carries
// tax_year + grade 'B' so a stale bracket is visible at the point of use.
// Do not invent newer figures; update the table only against a cited source.
const TAX_YEAR = 2024;
const FICA_RATE = 0.0765;
const STANDARD_DEDUCTION = 14600;
const ROTH_IRA_LIMIT = 7000;
const DEFAULT_STATE_RATE = 0.05;

const FEDERAL_BRACKETS = [
  { rate: 0.10, upTo: 11600 },
  { rate: 0.12, upTo: 47150 },
  { rate: 0.22, upTo: 100525 },
  { rate: 0.24, upTo: 191950 },
  { rate: 0.32, upTo: 243725 },
  { rate: 0.35, upTo: 609350 },
  { rate: 0.37, upTo: Infinity },
];

const STATE_TAX_RATES = {
  AZ: 0.025, TX: 0, FL: 0, WA: 0, NV: 0,
  CA: 0.093, NY: 0.0685, IL: 0.0495, CO: 0.044,
};

function calcFederalTax(taxableIncome) {
  let tax = 0;
  let prev = 0;
  for (const bracket of FEDERAL_BRACKETS) {
    if (taxableIncome <= prev) break;
    const taxable = Math.min(taxableIncome, bracket.upTo) - prev;
    tax += taxable * bracket.rate;
    prev = bracket.upTo;
  }
  return tax;
}

/**
 * @param {number} grossAnnual
 * @param {string} [state='AZ']
 * @returns {{gross_annual: number, federal_tax: number, state_tax: number, fica: number,
 *   annual_take_home: number, monthly_take_home: number, effective_rate: number,
 *   tax_year: number, grade: string}}
 */
function calcTakeHome(grossAnnual, state = 'AZ') {
  const stateTaxRate = STATE_TAX_RATES[state.toUpperCase()] ?? DEFAULT_STATE_RATE;
  const taxableIncome = Math.max(0, grossAnnual - STANDARD_DEDUCTION);
  const federalTax = calcFederalTax(taxableIncome);
  const stateTax = grossAnnual * stateTaxRate;
  const fica = grossAnnual * FICA_RATE;
  const annualTakeHome = grossAnnual - federalTax - stateTax - fica;
  return {
    gross_annual: grossAnnual,
    federal_tax: Math.round(federalTax),
    state_tax: Math.round(stateTax),
    fica: Math.round(fica),
    annual_take_home: Math.round(annualTakeHome),
    monthly_take_home: Math.round(annualTakeHome / 12),
    effective_rate: grossAnnual > 0
      ? Math.round(((federalTax + stateTax + fica) / grossAnnual) * 100 * 10) / 10
      : 0,
    tax_year: TAX_YEAR,
    grade: 'B',
  };
}

/**
 * @param {object} snapshot
 * @param {number} newSalary
 * @param {number} [gapWeeks=0]
 */
function modelRaise(snapshot, newSalary, gapWeeks = 0) {
  const gross = snapshot.income?.current_gross;
  // Ruling R5: a missing current salary is not a fact we can guess at ($65k
  // in the source). Flag it instead of computing a fabricated delta.
  if (!gross || gross <= 0) {
    return {
      needs_profile: true,
      current_salary: gross ?? null,
      new_salary: newSalary,
      current_monthly_takehome: null,
      new_monthly_takehome: null,
      monthly_delta: null,
      annual_delta: null,
      gap_cost: null,
      net_12mo_gain: null,
      months_to_emergency_fund: null,
      allocation_plan: [],
      tax_comparison: null,
    };
  }

  const state = snapshot.context?.state || 'AZ';
  const expenses = snapshot.expenses?.total_monthly || 0;
  const liquid = (snapshot.assets?.checking || 0) + (snapshot.assets?.savings || 0);
  const emergencyTarget = snapshot.goals?.emergency_fund_target || expenses * 6;
  const currentLiquid = liquid;

  const current = calcTakeHome(gross, state);
  const newPay = calcTakeHome(newSalary, state);

  const weeklyBurn = expenses / 4.33;
  const gapCost = Math.round(gapWeeks * weeklyBurn);
  const monthlyDelta = newPay.monthly_take_home - current.monthly_take_home;
  const annualDelta = monthlyDelta * 12;
  const net12moGain = annualDelta - gapCost;

  const emergencyDeficit = Math.max(0, emergencyTarget - currentLiquid);
  const rothTarget = snapshot.goals?.roth_ira_monthly || 583;

  const allocationPlan = [];
  if (monthlyDelta > 0) {
    let remaining = monthlyDelta;
    if (emergencyDeficit > 0) {
      const emergencyContrib = Math.min(remaining, monthlyDelta * 0.6);
      allocationPlan.push({
        goal: 'Emergency Fund',
        monthly: Math.round(emergencyContrib),
        months_to_goal: Math.ceil(emergencyDeficit / emergencyContrib),
      });
      remaining -= emergencyContrib;
    }
    if (remaining > 0) {
      const rothContrib = Math.min(remaining, rothTarget);
      allocationPlan.push({ goal: 'Roth IRA', monthly: Math.round(rothContrib) });
      remaining -= rothContrib;
    }
    if (remaining > 0) {
      allocationPlan.push({ goal: 'Taxable Investments / Savings', monthly: Math.round(remaining) });
    }
  }

  // Ruling R6: read the emergency-fund timeline off the allocation plan
  // itself rather than recomputing it from the full monthly delta — the two
  // disagree on the same input (ported behavior computed 9 vs 14 months).
  const ef = allocationPlan.find((a) => a.goal === 'Emergency Fund');

  return {
    current_salary: gross,
    new_salary: newSalary,
    needs_profile: false,
    current_monthly_takehome: current.monthly_take_home,
    new_monthly_takehome: newPay.monthly_take_home,
    monthly_delta: monthlyDelta,
    annual_delta: annualDelta,
    gap_cost: gapCost,
    net_12mo_gain: net12moGain,
    months_to_emergency_fund: ef ? ef.months_to_goal : 0,
    allocation_plan: allocationPlan,
    tax_comparison: {
      current_effective_rate: current.effective_rate,
      new_effective_rate: newPay.effective_rate,
    },
  };
}

/**
 * @param {object} snapshot
 */
function modelEmergencyFund(snapshot) {
  const expenses = snapshot.expenses?.total_monthly || 0;
  const liquid = (snapshot.assets?.checking || 0) + (snapshot.assets?.savings || 0);
  const target3mo = expenses * 3;
  const target6mo = expenses * 6;
  const currentMonths = expenses > 0 ? liquid / expenses : 0;
  const deficit6mo = Math.max(0, target6mo - liquid);

  // Ruling R4: derive the surplus from real take-home math instead of the
  // ported 0.74 flat factor.
  const gross = snapshot.income?.current_gross || 0;
  const state = snapshot.context?.state || 'AZ';
  const surplus = gross > 0 ? calcTakeHome(gross, state).monthly_take_home - expenses : 0;
  const monthsTo6mo = surplus > 0 ? Math.ceil(deficit6mo / surplus) : null;

  return {
    current_liquid: liquid,
    monthly_expenses: expenses,
    current_months_covered: Math.round(currentMonths * 10) / 10,
    target_3mo: target3mo,
    target_6mo: target6mo,
    deficit_to_6mo: deficit6mo,
    funded_pct: target6mo > 0 ? Math.round((liquid / target6mo) * 100) : 0,
    estimated_monthly_surplus: Math.round(surplus),
    months_to_6mo_goal: monthsTo6mo,
  };
}

/**
 * @param {number} annualContribution
 * @param {number} [startAge=25]
 * @param {number} [retirementAge=65]
 * @param {number} [rate=0.07]
 */
function modelRothIra(annualContribution, startAge = 25, retirementAge = 65, rate = 0.07) {
  const years = Math.max(0, retirementAge - startAge);
  const contribution = Math.min(annualContribution, ROTH_IRA_LIMIT);
  let balance = 0;
  for (let y = 0; y < years; y++) {
    balance = (balance + contribution) * (1 + rate);
  }
  return {
    annual_contribution: contribution,
    monthly_contribution: Math.round(contribution / 12),
    years,
    // Ruling R8: `${rate * 100}%` renders float noise (7.000000000000001%);
    // round to one decimal place of percent first.
    assumed_rate: `${Math.round(rate * 1000) / 10}%`,
    balance_at_retirement: Math.round(balance),
    total_contributions: contribution * years,
    investment_growth: Math.round(balance - contribution * years),
    irs_limit: ROTH_IRA_LIMIT,
    tax_year: TAX_YEAR,
  };
}

/**
 * @param {object} snapshot
 * @param {number} newSalary
 * @param {number} [savingsRatePct=0.30]
 */
function modelNetWorth18mo(snapshot, newSalary, savingsRatePct = 0.30) {
  const state = snapshot.context?.state || 'AZ';
  const expenses = snapshot.expenses?.total_monthly || 0;
  const startNw = snapshot.context?.current_net_worth || 0;
  const gapWeeks = snapshot.context?.gap_period_weeks || 0;
  const newPay = calcTakeHome(newSalary, state);
  const monthlyTakeHome = newPay.monthly_take_home;
  const monthlySurplus = monthlyTakeHome - expenses;
  const monthlySave = monthlySurplus * savingsRatePct;
  const gapCost = Math.round((expenses / 4.33) * gapWeeks);

  const timeline = [];
  let nw = startNw - gapCost;
  for (let m = 1; m <= 18; m++) {
    nw += monthlySave;
    timeline.push({ month: m, net_worth: Math.round(nw), monthly_save: Math.round(monthlySave) });
  }

  const target = snapshot.goals?.target_net_worth_18mo || 35000;
  const monthToTarget = timeline.findIndex((t) => t.net_worth >= target);

  return {
    new_salary: newSalary,
    monthly_take_home: monthlyTakeHome,
    monthly_surplus: Math.round(monthlySurplus),
    monthly_save: Math.round(monthlySave),
    gap_cost: gapCost,
    savings_rate: `${Math.round(savingsRatePct * 100)}%`,
    target_net_worth: target,
    months_to_target: monthToTarget >= 0 ? monthToTarget + 1 : null,
    final_net_worth: timeline[17]?.net_worth,
    timeline,
  };
}

/**
 * @param {object} snapshot
 */
function modelFireNumber(snapshot) {
  const annualExpenses = (snapshot.expenses?.total_monthly || 0) * 12;
  const fireNumber = annualExpenses * 25;
  const currentNw = snapshot.context?.current_net_worth || 0;
  const deficit = Math.max(0, fireNumber - currentNw);
  return {
    annual_expenses: annualExpenses,
    fire_number: fireNumber,
    current_net_worth: currentNw,
    deficit_to_fire: deficit,
    funded_pct: fireNumber > 0 ? Math.round((currentNw / fireNumber) * 100) : 0,
    rule: '25x annual expenses (4% safe withdrawal rate)',
  };
}

/**
 * Milestone events derived from an 18-month net-worth timeline.
 * NEXUS's route handler took the snapshot twice (snap, normalSnap); here
 * there is only ever one snapshot shape, so this takes it once.
 * @param {Array<{month: number, net_worth: number, monthly_save: number}>} timeline
 * @param {object} snapshot
 */
function generateMilestones(timeline, snapshot) {
  const milestones = [];
  const expenses = snapshot.expenses?.total_monthly || 0;
  const efTarget = expenses * 6;
  const liquid = (snapshot.assets?.checking || 0) + (snapshot.assets?.savings || 0);
  const monthly_save = timeline[0]?.monthly_save || 0;

  let efReached = liquid >= efTarget;
  let rothAccum = 0;
  let rothDone = false;

  timeline.forEach((t) => {
    const m = t.month;
    rothAccum += monthly_save;

    if (!efReached && t.net_worth >= (snapshot.context?.current_net_worth || 0) + (efTarget - liquid)) {
      efReached = true;
      milestones.push({
        month: m, type: 'emergency_fund', net_worth: t.net_worth,
        label: '6-Month Emergency Fund Complete',
        description: `$${Math.round(efTarget).toLocaleString()} fully funded. You can now focus entirely on wealth building.`,
      });
    }

    if (!rothDone && rothAccum >= ROTH_IRA_LIMIT) {
      rothDone = true;
      milestones.push({
        month: m, type: 'roth_ira', net_worth: t.net_worth,
        label: 'Roth IRA Annual Limit Reached',
        description: "You've contributed $7,000 to your Roth IRA — tax-free growth for retirement.",
      });
    }

    if (m === 6 || m === 12 || m === 18) {
      milestones.push({
        month: m, type: 'net_worth', net_worth: t.net_worth,
        label: `Month ${m} Net Worth Checkpoint`,
        description: `Net worth: $${Math.round(t.net_worth).toLocaleString()}`,
      });
    }
  });

  return milestones.sort((a, b) => a.month - b.month);
}

module.exports = {
  TAX_YEAR, STATE_TAX_RATES, calcTakeHome, modelRaise, modelEmergencyFund,
  modelRothIra, modelNetWorth18mo, modelFireNumber, generateMilestones,
};
