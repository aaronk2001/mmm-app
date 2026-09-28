'use strict';

// One list of account types and how each one counts. The Add Account form, the
// validator and every aggregation (net worth, runway, planning, debt) used to
// carry their own copies and had drifted apart: the form offered brokerage,
// retirement, crypto, real_estate and vehicle, and the validator rejected all
// five. src/lib/accountTypes.js mirrors this list for the UI.

const ACCOUNT_TYPES = [
  'checking', 'savings', 'cash',
  'investment', 'brokerage', 'retirement', 'crypto',
  'real_estate', 'vehicle', 'other',
  'credit', 'loan',
];

const LIABILITY_TYPES = new Set(['credit', 'loan']);
// Spendable within days: what runway and the cash-flow forecast count.
const LIQUID_TYPES = new Set(['checking', 'savings', 'cash']);
const INVESTMENT_TYPES = new Set(['investment', 'brokerage', 'crypto']);
const RETIREMENT_TYPES = new Set(['retirement']);

const isLiability = (type) => LIABILITY_TYPES.has(type);
const isLiquid = (type) => LIQUID_TYPES.has(type);

// Liabilities are stored negative (money owed). People naturally type the
// amount they owe as a positive number, and a positive card balance used to
// make a $500 purchase *lower* the debt — so a liability's balance is always
// normalized to -|balance| on the way in.
function normalizeBalance(type, balance) {
  if (balance === undefined || balance === null || balance === '') return balance;
  if (!isLiability(type)) return balance;
  const n = Number(balance);
  return Number.isFinite(n) ? -Math.abs(n) : balance;
}

// What an account contributes to net worth, whatever sign it was entered with.
function signedBalance(account) {
  const b = Number(account && account.balance) || 0;
  return isLiability(account && account.type) ? -Math.abs(b) : b;
}

module.exports = {
  ACCOUNT_TYPES, LIABILITY_TYPES, LIQUID_TYPES, INVESTMENT_TYPES, RETIREMENT_TYPES,
  isLiability, isLiquid, normalizeBalance, signedBalance,
};
