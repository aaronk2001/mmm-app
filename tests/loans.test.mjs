import { describe, it, expect } from 'vitest';
import {
  calcMortgage, calcAutoLoan, calcRefiBreakeven, calcDti,
} from '../server/tools/loans.js';

describe('calcMortgage', () => {
  // Spec fixture (ruling R2): "$400k / 7% / 30y -> $2,661/mo & ~$558k interest" is a
  // $400k LOAN, i.e. zero down. monthly_payment additionally carries a PMI estimate.
  it('matches the spec fixture on a $400k loan at 7% over 30 years', () => {
    const m = calcMortgage({ purchase_price: 400000, down_payment_pct: 0, annual_rate: 7, term_years: 30 });
    expect(m.monthly_pi).toBeCloseTo(2661.21, 2);
    expect(m.total_interest).toBe(558036);
    expect(m.loan_amount).toBe(400000);
    expect(m.down_payment).toBe(0);
  });

  it('charges no PMI at 20% down and reports the smaller principal', () => {
    const m = calcMortgage({ purchase_price: 400000, down_payment_pct: 20, annual_rate: 7, term_years: 30 });
    expect(m.pmi_estimate).toBeNull();
    expect(m.monthly_payment).toBeCloseTo(2128.97, 2);
    expect(m.monthly_payment).toBe(m.monthly_pi);
    expect(m.loan_amount).toBe(320000);
    expect(m.down_payment).toBe(80000);
    expect(m.total_interest).toBe(446428);
  });

  it('adds a PMI estimate below the 20% down threshold', () => {
    const m = calcMortgage({ purchase_price: 400000, down_payment_pct: 10, annual_rate: 7, term_years: 30 });
    expect(m.pmi_estimate).toBeCloseTo(210, 2);
    expect(m.monthly_pi).toBeCloseTo(2395.09, 2);
    expect(m.monthly_payment).toBeCloseTo(2605.09, 2);
  });

  it('amortizes to zero over one row per year', () => {
    const m = calcMortgage({ purchase_price: 400000, down_payment_pct: 20, annual_rate: 7, term_years: 30 });
    expect(m.amortization).toHaveLength(30);
    expect(m.amortization[0]).toEqual({ year: 1, principal_paid: 3251, interest_paid: 22297, balance: 316749 });
    expect(m.amortization[29].balance).toBe(0);
  });

  it('handles a 0% rate as straight-line principal', () => {
    const m = calcMortgage({ purchase_price: 120000, down_payment_pct: 0, annual_rate: 0, term_years: 10 });
    expect(m.monthly_pi).toBeCloseTo(1000, 6);
    expect(m.total_interest).toBe(0);
  });

  it('clamps a down payment over 100% and a negative rate', () => {
    const m = calcMortgage({ purchase_price: 100000, down_payment_pct: 150, annual_rate: -3, term_years: 10 });
    expect(m.loan_amount).toBe(0);
    expect(m.monthly_pi).toBe(0);
  });
});

describe('calcAutoLoan', () => {
  it('nets down payment and trade-in out of the principal', () => {
    const a = calcAutoLoan({ vehicle_price: 35000, down_payment: 5000, annual_rate: 6, term_months: 60 });
    expect(a.loan_amount).toBe(30000);
    expect(a.monthly_payment).toBeCloseTo(579.98, 2);
    expect(a.total_interest).toBe(4799);
    expect(a.total_cost).toBe(39799);
  });

  it('never goes negative when the trade-in exceeds the price', () => {
    const a = calcAutoLoan({ vehicle_price: 10000, down_payment: 2000, trade_in: 12000, annual_rate: 6 });
    expect(a.loan_amount).toBe(0);
    expect(a.monthly_payment).toBe(0);
  });
});

describe('calcRefiBreakeven', () => {
  it('reports breakeven and a strong verdict on a 1.5-point drop', () => {
    const r = calcRefiBreakeven({ current_rate: 7, new_rate: 5.5, balance: 300000, years_remaining: 25, closing_costs: 6000 });
    expect(r.current_monthly_payment).toBeCloseTo(2120.34, 2);
    expect(r.new_monthly_payment).toBeCloseTo(1842.26, 2);
    expect(r.monthly_savings).toBeCloseTo(278.08, 2);
    expect(r.breakeven_months).toBe(22);
    expect(r.breakeven_years).toBeCloseTo(1.83, 2);
    expect(r.verdict).toMatch(/^STRONG YES/);
  });

  it('refuses to invent a breakeven when the new rate is worse', () => {
    const r = calcRefiBreakeven({ current_rate: 5, new_rate: 6, balance: 300000, years_remaining: 25, closing_costs: 6000 });
    expect(r.breakeven_months).toBeNull();
    expect(r.total_savings).toBeNull();
    expect(r.verdict).toMatch(/No benefit/);
  });

  it('downgrades the verdict as the breakeven stretches out', () => {
    const mid = calcRefiBreakeven({ current_rate: 7, new_rate: 6.2, balance: 300000, years_remaining: 25, closing_costs: 6000 });
    expect(mid.breakeven_months).toBeGreaterThan(24);
    expect(mid.verdict).toMatch(/^YES/);
    const slow = calcRefiBreakeven({ current_rate: 7, new_rate: 6.9, balance: 300000, years_remaining: 25, closing_costs: 12000 });
    expect(slow.breakeven_months).toBeGreaterThan(48);
    expect(slow.verdict).toMatch(/^CONSIDER/);
  });
});

describe('calcDti', () => {
  it('bands a 20% ratio as good and sizes the remaining 43% headroom', () => {
    const d = calcDti({ monthly_debts: 1200, gross_monthly_income: 6000 });
    expect(d.dti).toBe(20);
    expect(d.mortgage_readiness).toBe('good');
    expect(d.max_mortgage_payment).toBe(1380);
    expect(d.notes.length).toBe(2);
  });

  it('bands each threshold', () => {
    expect(calcDti({ monthly_debts: 500,  gross_monthly_income: 6000 }).mortgage_readiness).toBe('excellent');
    expect(calcDti({ monthly_debts: 2400, gross_monthly_income: 6000 }).mortgage_readiness).toBe('fair');
    expect(calcDti({ monthly_debts: 3000, gross_monthly_income: 6000 }).mortgage_readiness).toBe('poor');
  });

  it('returns an error instead of dividing by zero income', () => {
    expect(calcDti({ monthly_debts: 1200, gross_monthly_income: 0 }).error).toMatch(/greater than 0/);
  });

  it('never reports negative headroom', () => {
    expect(calcDti({ monthly_debts: 5000, gross_monthly_income: 6000 }).max_mortgage_payment).toBe(0);
  });
});
