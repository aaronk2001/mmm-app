const express = require('express');
const store   = require('../money/store');
const repo    = require('../db/repo');
const { db }  = require('../db/connection');
const loans   = require('./loans');
const planning = require('./planning');
const { profileFromMmm, inBaseCurrency, currencyConfig, validateProfile } = require('./profile');
const calc = require('../money/calc');
const { computeRunway } = require('../money/runway');
const { isLiability } = require('../money/account-types');

const router = express.Router();

function snapshot() {
  return profileFromMmm(store.readData(), repo.getSettings(db()) || {});
}
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
function need(res, name, v) {
  if (v === null || !Number.isFinite(v)) { res.status(400).json({ error: `${name} is required` }); return false; }
  return true;
}

// The one liquid account that would actually receive a new paycheck deposit —
// checking first, then savings/cash. Injecting into every checking account
// would double-count the raise for anyone with more than one.
const LIQUID_PRIORITY = ['checking', 'savings', 'cash'];
function pickLiquidAccountId(accounts) {
  for (const type of LIQUID_PRIORITY) {
    const acct = accounts.find((a) => a.type === type);
    if (acct) return acct.id;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Snapshot / profile
// ────────────────────────────────────────────────────────────────────────────

router.get('/snapshot', (req, res) => {
  try {
    res.json(snapshot());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/profile', (req, res) => {
  try {
    const profile = repo.getSettings(db()).profile || {};
    const complete = Boolean(profile.gross_salary && profile.state);
    res.json({ profile, complete });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/profile', (req, res) => {
  try {
    const { ok, errors, value } = validateProfile(req.body);
    if (!ok) return res.status(400).json({ error: errors.join('; ') });
    const existing = repo.getSettings(db()).profile || {};
    const profile = { ...existing, ...value };
    repo.setSettings(db(), { profile });
    res.json({ profile });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// Take-home / raise / offer
// ────────────────────────────────────────────────────────────────────────────

// State and filing status come from the body, else the saved profile. There is
// no default state: unset means no state tax, flagged in the response.
router.post('/take-home', (req, res) => {
  try {
    const gross = num(req.body.gross_salary);
    if (!need(res, 'gross_salary', gross)) return;
    const profile = repo.getSettings(db()).profile || {};
    const state = req.body.state !== undefined ? req.body.state : (profile.state || null);
    const filingStatus = req.body.filing_status || profile.filing_status || 'single';
    res.json(planning.calcTakeHome(gross, state, filingStatus));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/offer', (req, res) => {
  try {
    const newSalary = num(req.body.new_salary);
    if (!need(res, 'new_salary', newSalary)) return;
    const gapWeeks = num(req.body.gap_weeks) || 0;
    const snap = snapshot();
    const state = req.body.state || snap.context.state;
    const filingStatus = req.body.filing_status || snap.context.filing_status;
    // Balances and spending in the base currency, like the snapshot.
    const raw = store.readData();
    const data = { ...raw, ...inBaseCurrency(raw, repo.getSettings(db()) || {}) };

    const current = snap.income.current_gross
      ? planning.calcTakeHome(snap.income.current_gross, state, filingStatus) : null;
    const offer = planning.calcTakeHome(newSalary, state, filingStatus);

    // Δ runway: re-run the real runway engine with the new monthly take-home
    // added to liquid cash for one month. Same engine as the Overview headline,
    // so the two can never disagree. Inject into exactly ONE liquid account —
    // mapping every `checking` account would double (or triple) count the
    // raise for anyone with more than one checking account.
    const baseRunway = computeRunway({ ...data });
    const injectId = pickLiquidAccountId(data.accounts);
    const withOffer = computeRunway({
      ...data,
      accounts: injectId
        ? data.accounts.map((a) => (a.id === injectId
          ? { ...a, balance: (parseFloat(a.balance) || 0) + offer.monthly_take_home }
          : a))
        : data.accounts, // no liquid account at all — nothing to inject into
    });

    // Net-worth deltas: the employment gap belongs to the OFFER scenario only.
    // Staying in the current job means no unpaid gap, so the baseline snapshot
    // must keep gap_period_weeks at 0 even when the offer carries one — do not
    // "fix" this back to symmetric, the two scenarios are not the same.
    const nwBase = snap.income.current_gross
      ? planning.modelNetWorth18mo(snap, snap.income.current_gross, 0.30).final_net_worth : null;
    const offerSnap = { ...snap, context: { ...snap.context, gap_period_weeks: gapWeeks } };
    const nwOffer = planning.modelNetWorth18mo(offerSnap, newSalary, 0.30).final_net_worth;
    const raise = planning.modelRaise(snap, newSalary, gapWeeks);

    res.json({
      current, offer,
      delta_monthly_take_home: current ? offer.monthly_take_home - current.monthly_take_home : null,
      // withOffer/baseRunway.months is null when there is no burn to divide by.
      delta_runway_months: (withOffer.months == null || baseRunway.months == null)
        ? null : Math.round((withOffer.months - baseRunway.months) * 10) / 10,
      delta_net_worth_18mo: nwBase === null ? null : nwOffer - nwBase,
      net_12mo_gain: raise.net_12mo_gain,
      needs_profile: raise.needs_profile === true,
      tax_year: offer.tax_year,
      grade: snap.grade === 'A' ? 'B' : snap.grade, // projection off a dated bracket table
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/raise', (req, res) => {
  try {
    const newSalary = num(req.body.new_salary);
    if (!need(res, 'new_salary', newSalary)) return;
    const gapWeeks = num(req.body.gap_weeks) || 0;
    res.json(planning.modelRaise(snapshot(), newSalary, gapWeeks));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// Emergency fund / Roth / FIRE / what-if
// ────────────────────────────────────────────────────────────────────────────

router.get('/emergency-fund', (req, res) => {
  try {
    res.json(planning.modelEmergencyFund(snapshot()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/roth', (req, res) => {
  try {
    const annual = num(req.body.annual_contribution);
    if (!need(res, 'annual_contribution', annual)) return;
    const startAge = num(req.body.start_age) ?? undefined;
    const retirementAge = num(req.body.retirement_age) ?? undefined;
    const rate = num(req.body.rate) ?? undefined;
    res.json(planning.modelRothIra(annual, startAge, retirementAge, rate));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/fire', (req, res) => {
  try {
    res.json(planning.modelFireNumber(snapshot()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/what-if', (req, res) => {
  try {
    const newSalary = num(req.body.new_salary);
    if (!need(res, 'new_salary', newSalary)) return;
    const savingsRate = num(req.body.savings_rate) ?? undefined;
    const gapWeeks = num(req.body.gap_weeks) || 0;
    const snap = snapshot();
    if (req.body.expenses_monthly !== undefined) {
      const expenses = num(req.body.expenses_monthly);
      if (!need(res, 'expenses_monthly', expenses)) return;
      snap.expenses = { ...snap.expenses, total_monthly: expenses };
    }
    snap.context = { ...snap.context, gap_period_weeks: gapWeeks };
    const result = planning.modelNetWorth18mo(snap, newSalary, savingsRate);
    res.json({ ...result, milestones: planning.generateMilestones(result.timeline, snap) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ────────────────────────────────────────────────────────────────────────────
// Loan calculators
// ────────────────────────────────────────────────────────────────────────────

router.post('/mortgage', (req, res) => {
  try {
    const { purchase_price, down_payment_pct, annual_rate, term_years } = req.body;
    if (!need(res, 'purchase_price', num(purchase_price))) return;
    if (!need(res, 'annual_rate', num(annual_rate))) return;
    res.json(loans.calcMortgage({
      purchase_price: num(purchase_price),
      down_payment_pct: down_payment_pct === undefined ? undefined : num(down_payment_pct),
      annual_rate: num(annual_rate),
      term_years: term_years === undefined ? undefined : num(term_years),
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/auto-loan', (req, res) => {
  try {
    const { vehicle_price, down_payment, trade_in, annual_rate, term_months } = req.body;
    if (!need(res, 'vehicle_price', num(vehicle_price))) return;
    if (!need(res, 'annual_rate', num(annual_rate))) return;
    res.json(loans.calcAutoLoan({
      vehicle_price: num(vehicle_price),
      down_payment: down_payment === undefined ? undefined : num(down_payment),
      trade_in: trade_in === undefined ? undefined : num(trade_in),
      annual_rate: num(annual_rate),
      term_months: term_months === undefined ? undefined : num(term_months),
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/refi', (req, res) => {
  try {
    const { current_rate, new_rate, balance, years_remaining, closing_costs } = req.body;
    if (!need(res, 'current_rate', num(current_rate))) return;
    if (!need(res, 'new_rate', num(new_rate))) return;
    if (!need(res, 'balance', num(balance))) return;
    if (!need(res, 'years_remaining', num(years_remaining))) return;
    if (!need(res, 'closing_costs', num(closing_costs))) return;
    res.json(loans.calcRefiBreakeven({
      current_rate: num(current_rate),
      new_rate: num(new_rate),
      balance: num(balance),
      years_remaining: num(years_remaining),
      closing_costs: num(closing_costs),
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/dti', (req, res) => {
  try {
    const snap = snapshot();
    const data = store.readData();
    // The stored minimum payment where there is one, in the base currency.
    const { baseCurrency, fxRates } = currencyConfig(repo.getSettings(db()) || {});
    const defaultDebts = data.accounts
      .filter((a) => isLiability(a.type))
      .reduce((sum, a) => sum + calc.convertAmount(
        a.min_payment || Math.max(2, Math.abs(parseFloat(a.balance) || 0) * 0.02),
        a.currency || baseCurrency, baseCurrency, fxRates), 0);
    const grossMonthlyIncome = num(req.body.gross_monthly_income)
      ?? (snap.income.current_gross ? snap.income.current_gross / 12 : null);
    const monthlyDebts = num(req.body.monthly_debts) ?? defaultDebts;
    if (!need(res, 'gross_monthly_income', grossMonthlyIncome)) return;
    const result = loans.calcDti({ monthly_debts: monthlyDebts, gross_monthly_income: grossMonthlyIncome });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ...result, gross_monthly_income: grossMonthlyIncome, monthly_debts: monthlyDebts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
