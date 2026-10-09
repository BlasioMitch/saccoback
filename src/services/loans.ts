import type { Transaction as DbTransaction } from 'sequelize';
import { models } from '../models/index.js';
import { recalculateLoanSummary } from '../lib/loans.js';
import { moneyFieldError } from '../lib/money.js';
import { ServiceError } from './errors.js';

export async function createLoan(input: Record<string, any>, { transaction }: { transaction?: DbTransaction } = {}) {
  const { accountId, amount, interestRate, term, status, startDate, endDate } = input;

  const moneyError = moneyFieldError(input, ['amount']);
  if (moneyError) throw new ServiceError(400, moneyError);
  if (!accountId || !amount || !interestRate || !term || !status || !startDate || !endDate) {
    throw new ServiceError(400, 'All fields are required');
  }
  if (!Number.isInteger(Number(term)) || Number(term) < 1) throw new ServiceError(400, 'term must be a whole number of months, at least 1');
  if (!(new Date(endDate) > new Date(startDate))) throw new ServiceError(400, 'endDate must be after startDate');

  const account = await models.Account.findByPk(accountId, {
    include: [{ model: models.User, as: 'owner', attributes: ['id', 'first_name', 'last_name', 'other_name', 'email'] }],
    transaction,
  });
  if (!account) throw new ServiceError(404, 'Account not found');
  if (account.hasLoan) throw new ServiceError(409, 'This account already has an open loan');

  const loan = await models.Loan.create({ accountId, amount, interestRate, term, status, startDate, endDate }, { transaction });
  await models.Account.update({ hasLoan: true }, { where: { id: accountId }, transaction });

  // Summary uses the same logic as edits and payments
  const recalculated = await recalculateLoanSummary(loan.id, transaction);
  return {
    loan,
    account,
    monthlyPayment: Number(recalculated?.summary.monthlyPayment || 0),
    totalInterest: Number(recalculated?.summary.totalInterest || 0),
  };
}
