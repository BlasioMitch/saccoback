import type { Transaction as DbTransaction } from 'sequelize';
import { models } from '../models/index.js';
import { recalculateLoanSummary } from '../lib/loans.js';
import { moneyFieldError } from '../lib/money.js';
import { ServiceError } from './errors.js';
import { LoanStatus } from '../models/loan.js';
import { AccountStatus } from '../models/account.js';
import { DEFAULT_LOAN_RATE } from '../lib/settings.js';
import { formatUGX, notifyAccountOwner } from '../lib/notifications.js';
import { NotificationCategory, NotificationTarget } from '../models/notification.js';

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

const addMonths = (date: Date, months: number) => {
  const result = new Date(date);
  const day = result.getDate();
  result.setMonth(result.getMonth() + months);
  // 31 Jan + 1 month -> last day of February, not 3 March
  if (result.getDate() !== day) result.setDate(0);
  return result;
};

// Calendar date in Kampala (UTC+3), as YYYY-MM-DD
const kampalaDate = (date = new Date()) => new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
const MAX_START_DAYS_AHEAD = 92;

// The member's proposed start date: today up to about three months ahead (defaults to today)
const proposedStartDate = (value: unknown) => {
  if (value == null || value === '') return new Date(`${kampalaDate()}T00:00:00Z`);
  const text = String(value).slice(0, 10);
  const date = new Date(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime())) throw new ServiceError(400, 'Invalid start date');
  if (text < kampalaDate()) throw new ServiceError(400, 'The start date cannot be in the past');
  if (text > kampalaDate(new Date(Date.now() + MAX_START_DAYS_AHEAD * 24 * 60 * 60 * 1000))) {
    throw new ServiceError(400, 'Choose a start date within the next 3 months');
  }
  return date;
};

// A member applies from the app; the loan waits as PENDING until a manager decides
export async function applyForLoan(userId: string, input: Record<string, any>, { transaction }: { transaction?: DbTransaction } = {}) {
  const { amount, term, purpose } = input;

  const moneyError = moneyFieldError(input, ['amount']);
  if (moneyError) throw new ServiceError(400, moneyError);
  if (!userId) throw new ServiceError(400, 'userId is required');
  if (!amount || amount <= 0) throw new ServiceError(400, 'Enter the amount you want to borrow');
  if (!Number.isInteger(Number(term)) || Number(term) < 1 || Number(term) > 120) {
    throw new ServiceError(400, 'Choose a repayment period between 1 and 120 months');
  }

  const account = await models.Account.findOne({ where: { userId, is_deleted: false }, transaction });
  if (!account) throw new ServiceError(404, 'You do not have a SACCO account yet');
  if (account.status !== AccountStatus.ACTIVE) throw new ServiceError(409, 'Your account must be active to apply for a loan');
  if (!account.paidMembership) throw new ServiceError(409, 'Pay your membership fee before applying for a loan');
  if (account.hasLoan) throw new ServiceError(409, 'You already have an open loan');
  const pending = await models.Loan.count({ where: { accountId: account.id, status: LoanStatus.PENDING }, transaction });
  if (pending) throw new ServiceError(409, 'You already have a loan application waiting for approval');

  const startDate = proposedStartDate(input.startDate);
  const loan = await models.Loan.create({
    accountId: account.id,
    amount,
    interestRate: DEFAULT_LOAN_RATE,
    term: Number(term),
    status: LoanStatus.PENDING,
    startDate,
    endDate: addMonths(startDate, Number(term)),
    purpose: purpose ? String(purpose).trim().slice(0, 500) : null,
  }, { transaction });

  // Estimated repayments at the default rate (does not mark the account as having a loan)
  await recalculateLoanSummary(loan.id, transaction);
  await notifyAccountOwner(account.id, NotificationCategory.UPDATE, {
    title: 'Loan application received',
    body: `Your application for ${formatUGX(amount)} over ${Number(term)} months is waiting for approval.`,
    targetType: NotificationTarget.LOAN,
    targetId: loan.id,
  }, transaction);
  return loan;
}

const findPendingLoan = async (id: string, transaction?: DbTransaction) => {
  const loan = await models.Loan.findByPk(id, { transaction });
  if (!loan) throw new ServiceError(404, 'Loan application not found');
  if (loan.status !== LoanStatus.PENDING) throw new ServiceError(409, `This application was already ${loan.status.toLowerCase()}`);
  return loan;
};

// Manager approval: confirm (or change) the rate and start date (defaults to the member's proposed date)
export async function approveLoan(id: string, input: Record<string, any>, { transaction }: { transaction?: DbTransaction } = {}) {
  const loan = await findPendingLoan(id, transaction);
  const account = await models.Account.findByPk(loan.accountId, { transaction });
  if (!account) throw new ServiceError(404, 'Account not found');
  if (account.hasLoan) throw new ServiceError(409, 'This member already has an open loan');

  const interestRate = input.interestRate ?? loan.interestRate;
  if (!(Number(interestRate) > 0 && Number(interestRate) <= 100)) throw new ServiceError(400, 'Interest rate must be between 0 and 100');
  const startDate = input.startDate ? new Date(input.startDate) : new Date(loan.startDate);
  if (Number.isNaN(startDate.getTime())) throw new ServiceError(400, 'Invalid start date');

  await loan.update({
    status: LoanStatus.ACTIVE,
    interestRate,
    startDate,
    endDate: addMonths(startDate, Number(loan.term)),
    decisionNote: input.note ? String(input.note).trim() : null,
    decidedAt: new Date(),
  }, { transaction });
  const recalculated = await recalculateLoanSummary(loan.id, transaction);
  await notifyAccountOwner(loan.accountId, NotificationCategory.LOAN_DECISION, {
    title: 'Loan approved',
    body: `Your loan of ${formatUGX(loan.amount)} was approved at ${Number(interestRate)}%. `
      + `Monthly payment ${formatUGX(recalculated?.summary.monthlyPayment ?? 0)}.`,
    targetType: NotificationTarget.LOAN,
    targetId: loan.id,
  }, transaction);
  return loan;
}

export async function rejectLoan(id: string, input: Record<string, any>, { transaction }: { transaction?: DbTransaction } = {}) {
  const reason = String(input.reason || '').trim();
  if (!reason) throw new ServiceError(400, 'Give the member a reason for the rejection');
  const loan = await findPendingLoan(id, transaction);
  await loan.update({ status: LoanStatus.REJECTED, decisionNote: reason, decidedAt: new Date() }, { transaction });
  await notifyAccountOwner(loan.accountId, NotificationCategory.LOAN_DECISION, {
    title: 'Loan application declined',
    body: `Your application for ${formatUGX(loan.amount)} was declined: ${reason}`,
    targetType: NotificationTarget.LOAN,
    targetId: loan.id,
  }, transaction);
  return loan;
}
