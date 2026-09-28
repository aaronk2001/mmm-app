// Financial planning models — pure, no I/O. Dollars in, dollars out.
//
// TAX MODEL: federal tax year 2026, every figure checked against a cited source
// on 2026-09-28. Direct fetches of irs.gov / ssa.gov / taxfoundation.org are
// blocked by this build environment's egress policy, so the official pages were
// read through search extracts (URLs below); HoH and MFS schedules were
// cross-checked against two secondary summaries of Rev. Proc. 2025-32.
//  - Brackets and standard deductions: IRS, "IRS releases tax inflation
//    adjustments for tax year 2026, including amendments from the One, Big,
//    Beautiful Bill" (Rev. Proc. 2025-32)
//    https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill
//    https://www.irs.gov/pub/irs-drop/rp-25-32.pdf
//    Head of household / married filing separately: TIAA 2026 quick tax
//    reference guide https://www.tiaa.org/public/pdf/q/quick_tax_reference_guide.pdf
//    and KPMG's Rev. Proc. 2025-32 summary
//    https://kpmg.com/kpmg-us/content/dam/kpmg/taxnewsflash/pdf/2025/10/25297.pdf
//  - Social Security wage base $184,500 (2026): SSA
//    https://www.ssa.gov/oact/cola/cbb.html ; SS 6.2% / Medicare 1.45%: IRS
//    Topic 751 https://www.irs.gov/taxtopics/tc751
//  - Additional Medicare Tax 0.9% over $200k ($250k MFJ, $125k MFS): IRS Topic
//    560 https://www.irs.gov/taxtopics/tc560
//  - IRA $7,500 (+$1,100 catch-up at 50+), 401(k) $24,500 (+$8,000 at 50+):
//    IRS Notice 2025-67
//    https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500
// Take-home is wages only: no pre-tax 401(k)/HSA deductions, credits, or the
// new 2025 deductions (tips, overtime, seniors). Every figure carries tax_year
// and grade 'B' so the model's age and precision are visible where it's used.
// Update the tables only against a cited source.
const TAX_YEAR = 2026;

const FILING_STATUSES = ['single', 'married_joint', 'married_separate', 'head_of_household'];

const STANDARD_DEDUCTION = {
  single: 16100,
  married_joint: 32200,
  married_separate: 16100,
  head_of_household: 24150,
};

// [rate, upper bound of the bracket]
const FEDERAL_BRACKETS = {
  single: [[0.10, 12400], [0.12, 50400], [0.22, 105700], [0.24, 201775], [0.32, 256225], [0.35, 640600], [0.37, Infinity]],
  married_joint: [[0.10, 24800], [0.12, 100800], [0.22, 211400], [0.24, 403550], [0.32, 512450], [0.35, 768700], [0.37, Infinity]],
  married_separate: [[0.10, 12400], [0.12, 50400], [0.22, 105700], [0.24, 201775], [0.32, 256225], [0.35, 384350], [0.37, Infinity]],
  head_of_household: [[0.10, 17700], [0.12, 67450], [0.22, 105700], [0.24, 201750], [0.32, 256200], [0.35, 640600], [0.37, Infinity]],
};

const SOCIAL_SECURITY_RATE = 0.062;
const SOCIAL_SECURITY_WAGE_BASE = 184500;
const MEDICARE_RATE = 0.0145;
const ADDITIONAL_MEDICARE_RATE = 0.009;
// Filing-status thresholds. With one salary modelled, a joint filer's
// spouse's wages are unknown, so the joint threshold is applied to this salary.
const ADDITIONAL_MEDICARE_THRESHOLD = {
  single: 200000, head_of_household: 200000, married_joint: 250000, married_separate: 125000,
};

const IRA_LIMIT = 7500;
const IRA_CATCH_UP = 1100; // age 50+
const K401_LIMIT = 24500;
const K401_CATCH_UP = 8000; // age 50+
const ROTH_IRA_LIMIT = IRA_LIMIT;

// ── state income tax (an ESTIMATE, labelled as one in every response) ───────
// States with no tax on wages. (WA taxes only capital gains; NH ended its
// interest-and-dividends tax in 2025.)
const NO_INCOME_TAX_STATES = new Set(['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY']);

// Modelled states: the ones this module special-cased before. Anything else is
// reported as not modelled (0, flagged) rather than guessed — the old 5%
// "blended" default charged Tennessee residents $3,000 on $60k.
//  - AZ: 2.5% flat; Arizona conforms to the federal standard deduction.
//    https://azdor.gov/forms/individual-income-tax-highlights
//  - IL: 4.95% flat less a $2,925 exemption per person (2026).
//    https://tax.illinois.gov/research/taxrates/income.html
//    (the exemption's high-income phase-out is not modelled)
//  - CO: 4.4% of federal taxable income (the 2025 rate; 2026 not yet published).
//    https://tax.colorado.gov/individual-income-tax-guide
//  - CA: 2025 FTB rate schedules (2026 schedules aren't published yet), less the
//    standard deduction and the personal exemption credit.
//    https://www.ftb.ca.gov/forms/2025/2025-540-tax-rate-schedules.pdf
//    https://www.ftb.ca.gov/file/personal/deductions/index.html
//    Joint brackets are the single brackets doubled (Schedule Y). Head of
//    household uses the single schedule — Schedule Z's thresholds couldn't be
//    verified — which over-states it slightly; the response says so. The 1%
//    mental health services tax over $1M is not modelled.
//  - NY is not modelled: its 2026 schedule is mid-way through a rate phase-in
//    and couldn't be verified from the Department of Taxation's pages.
const CA_SINGLE_BRACKETS = [
  [0.01, 11079], [0.02, 26264], [0.04, 41452], [0.06, 57542], [0.08, 72724],
  [0.093, 371479], [0.103, 445771], [0.113, 742953], [0.123, Infinity],
];
const doubled = (brackets) => brackets.map(([rate, upTo]) => [rate, upTo * 2]);

const STATE_MODELS = {
  AZ: { kind: 'flat', rate: 0.025, base: 'federal_taxable', year: 2026 },
  IL: { kind: 'flat', rate: 0.0495, base: 'gross_less_exemptions', exemption: 2925, year: 2026 },
  CO: { kind: 'flat', rate: 0.044, base: 'federal_taxable', year: 2025 },
  CA: {
    kind: 'brackets',
    year: 2025,
    brackets: {
      single: CA_SINGLE_BRACKETS,
      married_separate: CA_SINGLE_BRACKETS,
      married_joint: doubled(CA_SINGLE_BRACKETS),
      head_of_household: CA_SINGLE_BRACKETS,
    },
    standardDeduction: { single: 5706, married_separate: 5706, married_joint: 11412, head_of_household: 11412 },
    exemptionCredit: { single: 153, married_separate: 153, married_joint: 306, head_of_household: 153 },
    notes: { head_of_household: 'uses the single-filer schedule, which slightly over-states California tax for heads of household' },
  },
};

function bracketTax(taxable, brackets) {
  let tax = 0;
  let prev = 0;
  for (const [rate, upTo] of brackets) {
    if (taxable <= prev) break;
    tax += (Math.min(taxable, upTo) - prev) * rate;
    prev = upTo;
  }
  return tax;
}

function calcFederalTax(taxableIncome, filingStatus = 'single') {
  return bracketTax(taxableIncome, FEDERAL_BRACKETS[filingStatus] || FEDERAL_BRACKETS.single);
}

const normalizeState = (state) => {
  const s = typeof state === 'string' ? state.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(s) ? s : null;
};
const normalizeFilingStatus = (fs) => (FILING_STATUSES.includes(fs) ? fs : 'single');

// -> { state, state_tax, basis, estimated, year, note }
function calcStateTax(gross, state, filingStatus) {
  const code = normalizeState(state);
  if (!code) {
    return { state: null, state_tax: 0, basis: 'no_state', estimated: false, year: null, note: 'No state set — state income tax is not included.' };
  }
  if (NO_INCOME_TAX_STATES.has(code)) {
    return { state: code, state_tax: 0, basis: 'no_income_tax', estimated: false, year: TAX_YEAR, note: `${code} has no state income tax on wages.` };
  }
  const model = STATE_MODELS[code];
  if (!model) {
    return { state: code, state_tax: 0, basis: 'not_modeled', estimated: false, year: null, note: `${code} state income tax isn't modelled yet — it is not included in take-home.` };
  }
  let tax;
  if (model.kind === 'flat') {
    const base = model.base === 'federal_taxable'
      ? Math.max(0, gross - STANDARD_DEDUCTION[filingStatus])
      : Math.max(0, gross - model.exemption * (filingStatus === 'married_joint' ? 2 : 1));
    tax = base * model.rate;
  } else {
    const taxable = Math.max(0, gross - model.standardDeduction[filingStatus]);
    tax = Math.max(0, bracketTax(taxable, model.brackets[filingStatus]) - model.exemptionCredit[filingStatus]);
  }
  const caveat = model.notes && model.notes[filingStatus];
  return {
    state: code,
    state_tax: tax,
    basis: model.kind,
    estimated: true,
    year: model.year,
    note: `Estimate from ${code}'s ${model.year} ${model.kind === 'flat' ? 'flat rate' : 'brackets'}${caveat ? `; ${caveat}` : ''}.`,
  };
}

/**
 * Annual and monthly take-home for one W-2 salary.
 * @param {number} grossAnnual
 * @param {string|null} [state=null]  2-letter code; unset => no state tax (flagged)
 * @param {string} [filingStatus='single']  single | married_joint | married_separate | head_of_household
 * @returns {{gross_annual: number, federal_tax: number, state_tax: number, fica: number,
 *   social_security: number, medicare: number, annual_take_home: number, monthly_take_home: number,
 *   effective_rate: number, filing_status: string, state: string|null, state_tax_estimated: boolean,
 *   state_tax_basis: string, state_tax_year: number|null, state_tax_note: string, tax_year: number, grade: string}}
 */
function calcTakeHome(grossAnnual, state = null, filingStatus = 'single') {
  const gross = Math.max(0, Number(grossAnnual) || 0);
  const status = normalizeFilingStatus(filingStatus);
  const taxableIncome = Math.max(0, gross - STANDARD_DEDUCTION[status]);
  const federalTax = calcFederalTax(taxableIncome, status);
  const socialSecurity = Math.min(gross, SOCIAL_SECURITY_WAGE_BASE) * SOCIAL_SECURITY_RATE;
  const medicare = gross * MEDICARE_RATE
    + Math.max(0, gross - ADDITIONAL_MEDICARE_THRESHOLD[status]) * ADDITIONAL_MEDICARE_RATE;
  const fica = socialSecurity + medicare;
  const st = calcStateTax(gross, state, status);
  const annualTakeHome = gross - federalTax - st.state_tax - fica;
  return {
    gross_annual: gross,
    federal_tax: Math.round(federalTax),
    state_tax: Math.round(st.state_tax),
    fica: Math.round(fica),
    social_security: Math.round(socialSecurity),
    medicare: Math.round(medicare),
    annual_take_home: Math.round(annualTakeHome),
    monthly_take_home: Math.round(annualTakeHome / 12),
    effective_rate: gross > 0
      ? Math.round(((federalTax + st.state_tax + fica) / gross) * 100 * 10) / 10
      : 0,
    filing_status: status,
    state: st.state,
    state_tax_estimated: st.estimated,
    state_tax_basis: st.basis,
    state_tax_year: st.year,
    state_tax_note: st.note,
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

  // No state default: an unset state means no state tax, flagged in the take-home.
  const state = snapshot.context?.state || null;
  const filingStatus = snapshot.context?.filing_status || 'single';
  const expenses = snapshot.expenses?.total_monthly || 0;
  const liquid = (snapshot.assets?.checking || 0) + (snapshot.assets?.savings || 0);
  const emergencyTarget = snapshot.goals?.emergency_fund_target || expenses * 6;
  const currentLiquid = liquid;

  const current = calcTakeHome(gross, state, filingStatus);
  const newPay = calcTakeHome(newSalary, state, filingStatus);

  const weeklyBurn = expenses / 4.33;
  const gapCost = Math.round(gapWeeks * weeklyBurn);
  const monthlyDelta = newPay.monthly_take_home - current.monthly_take_home;
  const annualDelta = monthlyDelta * 12;
  const net12moGain = annualDelta - gapCost;

  const emergencyDeficit = Math.max(0, emergencyTarget - currentLiquid);
  const rothTarget = snapshot.goals?.roth_ira_monthly || Math.round(ROTH_IRA_LIMIT / 12);

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
  const state = snapshot.context?.state || null;
  const filingStatus = snapshot.context?.filing_status || 'single';
  const surplus = gross > 0 ? calcTakeHome(gross, state, filingStatus).monthly_take_home - expenses : 0;
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
 * Roth IRA growth to retirement. Contributions are capped at the IRS limit —
 * plus the age-50 catch-up in the years it applies — held at 2026 dollars.
 * @param {number} annualContribution
 * @param {number} [startAge=25]
 * @param {number} [retirementAge=65]
 * @param {number} [rate=0.07]
 */
function modelRothIra(annualContribution, startAge = 25, retirementAge = 65, rate = 0.07) {
  const years = Math.max(0, retirementAge - startAge);
  const wanted = Math.max(0, Number(annualContribution) || 0);
  const capFor = (age) => ROTH_IRA_LIMIT + (age >= 50 ? IRA_CATCH_UP : 0);
  const contribution = Math.min(wanted, capFor(startAge));
  let balance = 0;
  let total = 0;
  for (let y = 0; y < years; y++) {
    const c = Math.min(wanted, capFor(startAge + y));
    total += c;
    balance = (balance + c) * (1 + rate);
  }
  return {
    annual_contribution: contribution,
    monthly_contribution: Math.round(contribution / 12),
    years,
    // Ruling R8: `${rate * 100}%` renders float noise (7.000000000000001%);
    // round to one decimal place of percent first.
    assumed_rate: `${Math.round(rate * 1000) / 10}%`,
    balance_at_retirement: Math.round(balance),
    total_contributions: total,
    investment_growth: Math.round(balance - total),
    irs_limit: ROTH_IRA_LIMIT,
    catch_up_limit: IRA_CATCH_UP,
    tax_year: TAX_YEAR,
  };
}

/**
 * @param {object} snapshot
 * @param {number} newSalary
 * @param {number} [savingsRatePct=0.30]
 */
function modelNetWorth18mo(snapshot, newSalary, savingsRatePct = 0.30) {
  const state = snapshot.context?.state || null;
  const filingStatus = snapshot.context?.filing_status || 'single';
  const expenses = snapshot.expenses?.total_monthly || 0;
  const startNw = snapshot.context?.current_net_worth || 0;
  const gapWeeks = snapshot.context?.gap_period_weeks || 0;
  const newPay = calcTakeHome(newSalary, state, filingStatus);
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
        description: `You've contributed $${ROTH_IRA_LIMIT.toLocaleString('en-US')} to your Roth IRA — tax-free growth for retirement.`,
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
  TAX_YEAR, FILING_STATUSES, STANDARD_DEDUCTION, FEDERAL_BRACKETS, SOCIAL_SECURITY_WAGE_BASE,
  ADDITIONAL_MEDICARE_THRESHOLD, IRA_LIMIT, IRA_CATCH_UP, K401_LIMIT, K401_CATCH_UP,
  NO_INCOME_TAX_STATES, STATE_MODELS,
  calcFederalTax, calcStateTax, calcTakeHome, modelRaise, modelEmergencyFund,
  modelRothIra, modelNetWorth18mo, modelFireNumber, generateMilestones,
};
