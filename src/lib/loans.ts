import type { Transaction as DbTransaction } from 'sequelize';
import { models } from '../models/index.js';
import { LoanStatus } from '../models/loan.js';
import { TransactionStatus, TransactionType } from '../models/transaction.js';
import { calculateMonthlyPayment, calculateTotalInterest } from './utils.js';

// Single source of truth for a loan's summary: total owed (principal + interest) minus COMPLETED payments.
// Call it after anything that changes a loan's terms or its payments, so the order of edits never matters.
export async function recalculateLoanSummary(loanId: string, transaction?: DbTransaction) {
  const loan = await models.Loan.findByPk(loanId, { transaction });
  if (!loan) return null;

  const amount = Number(loan.amount);
  const interestRate = Number(loan.interestRate);
  const term = Number(loan.term);
  const totalInterest = calculateTotalInterest(amount, interestRate, term);
  const monthlyPayment = calculateMonthlyPayment(amount, interestRate, term);

  // SUM over BIGINT comes back as numeric text
  const paid = Number(await models.Transaction.sum('amount', {
    where: { loanId, type: TransactionType.LOAN_PAYMENT, status: TransactionStatus.COMPLETED },
    transaction,
  }) || 0);
  const remainingBalance = Math.max(0, amount + totalInterest - paid);

  const values = { monthlyPayment, totalInterest, remainingBalance };
  const existing = await models.LoanSummary.findOne({ where: { loanId }, transaction });
  const summary = existing
    ? await existing.update(values, { transaction })
    : await models.LoanSummary.create({ loanId, ...values }, { transaction });

  // PAID follows the balance: cleared -> PAID; a PAID loan that owes again (e.g. amount raised) -> ACTIVE.
  // DEFAULTED is an officer's decision and is left alone while money is owed.
  const previousStatus = loan.status;
  let status = previousStatus;
  if (remainingBalance === 0) status = LoanStatus.PAID;
  else if (previousStatus === LoanStatus.PAID) status = LoanStatus.ACTIVE;
  if (status !== previousStatus) {
    await loan.update({ status }, { transaction });
  }
  await models.Account.update(
    { hasLoan: status !== LoanStatus.PAID },
    { where: { id: loan.accountId }, transaction }
  );

  return {
    loan,
    summary,
    paid,
    statusChangedToPaid: status === LoanStatus.PAID && previousStatus !== LoanStatus.PAID,
  };
}
