import type { Transaction as DbTransaction } from 'sequelize';
import { models } from '../models/index.js';
import { TransactionStatus, TransactionType } from '../models/transaction.js';
import { OPEN_LOAN_STATUSES } from '../models/loan.js';
import { recalculateLoanSummary } from '../lib/loans.js';
import { moneyFieldError } from '../lib/money.js';
import { ServiceError } from './errors.js';
import { notifyTransaction } from '../lib/notifications.js';

// Allow for small clock differences between the browser and the server
const CLOCK_SKEW_MS = 5 * 60 * 1000;

interface CreateTransactionOptions {
  transaction?: DbTransaction;
  // Only bulk imports may record historical transactions
  allowBackdate?: boolean;
}

export async function createTransaction(input: Record<string, any>, { transaction, allowBackdate = false }: CreateTransactionOptions = {}) {
  const { accountId, type, amount, status, loanId, description, createdAt } = input;

  const moneyError = moneyFieldError(input, ['amount']);
  if (moneyError) throw new ServiceError(400, moneyError);
  if (!accountId || !type || !amount || !status) throw new ServiceError(400, 'All fields are required');
  if (type === TransactionType.LOAN_PAYMENT && !loanId) throw new ServiceError(400, 'Loan ID is required for Loan_Payment type');

  let recordedAt: Date | undefined;
  if (createdAt) {
    if (!allowBackdate) throw new ServiceError(400, 'createdAt can only be set by bulk import');
    recordedAt = new Date(createdAt);
    if (Number.isNaN(recordedAt.getTime())) throw new ServiceError(400, `Invalid date: ${createdAt}`);
    if (recordedAt.getTime() > Date.now() + CLOCK_SKEW_MS) throw new ServiceError(400, 'Transaction date cannot be in the future');
  }

  const account = await models.Account.findByPk(accountId, { transaction });
  if (!account) throw new ServiceError(404, 'Account not found');

  const balance = Number(account.balance);
  if (type === TransactionType.LOAN_PAYMENT && !(await models.Loan.findByPk(loanId, { transaction }))) {
    throw new ServiceError(404, 'Loan not found');
  }
  if (type === TransactionType.MEMBERSHIP_FEE && account.paidMembership) {
    throw new ServiceError(409, 'Membership fee already paid for this account');
  }
  if ((type === TransactionType.ACCOUNT_WITHDRAW || type === TransactionType.CLOSURE_WITHDRAW) && Number(amount) > balance) {
    throw new ServiceError(400, `Insufficient balance: ${balance} available`);
  }

  const newTransaction = await models.Transaction.create({
    accountId,
    accountName: account.accountNumber,
    type,
    amount,
    status,
    loanId,
    description,
    ...(recordedAt && { createdAt: recordedAt, updatedAt: recordedAt }),
  } as any, { transaction });

  if (type === TransactionType.LOAN_PAYMENT && loanId) {
    // Balance = total owed - COMPLETED payments; also flips the loan to PAID when cleared
    await recalculateLoanSummary(loanId, transaction);
  } else if (type === TransactionType.ACCOUNT_WITHDRAW || type === TransactionType.CLOSURE_WITHDRAW) {
    await account.update({ balance: balance - Number(amount) }, { transaction });
  } else if (type === TransactionType.SAVINGS_DEPOSIT) {
    await account.update({ balance: balance + Number(amount) }, { transaction });
  } else if (type === TransactionType.MEMBERSHIP_FEE) {
    await account.update({ balance: balance - Number(amount), paidMembership: true }, { transaction });
  }

  // Bulk imports load history: only live transactions notify the member
  if (!allowBackdate) await notifyTransaction(newTransaction, transaction);

  return { transaction: newTransaction, account };
}

// Repay a loan from the member's savings: a COMPLETED withdrawal from the account plus a COMPLETED
// payment on the loan, recorded together (run inside one DB transaction so neither exists alone)
export async function payLoanFromSavings(loanId: string, input: Record<string, any>, { transaction }: { transaction?: DbTransaction } = {}) {
  const moneyError = moneyFieldError(input, ['amount']);
  if (moneyError) throw new ServiceError(400, moneyError);
  const amount = Number(input.amount);
  if (!(amount > 0)) throw new ServiceError(400, 'Amount must be greater than 0');

  const loan = await models.Loan.findByPk(loanId, { transaction });
  if (!loan) throw new ServiceError(404, 'Loan not found');
  if (!OPEN_LOAN_STATUSES.includes(loan.status)) throw new ServiceError(409, `This loan is ${loan.status.toLowerCase()} and takes no payments`);

  const account = await models.Account.findByPk(loan.accountId, { transaction, lock: transaction ? true : undefined });
  if (!account) throw new ServiceError(404, 'Account not found');
  const balance = Number(account.balance);
  if (amount > balance) throw new ServiceError(400, `Insufficient savings: ${balance} available`);

  const summary = (await recalculateLoanSummary(loan.id, transaction))?.summary;
  const remaining = Number(summary?.remainingBalance ?? 0);
  if (amount > remaining) throw new ServiceError(400, `Amount is more than the ${remaining} still owed on this loan`);

  const base = { accountId: account.id, amount, status: TransactionStatus.COMPLETED };
  const { transaction: withdrawal } = await createTransaction({ ...base, type: TransactionType.ACCOUNT_WITHDRAW }, { transaction });
  const { transaction: payment } = await createTransaction({ ...base, type: TransactionType.LOAN_PAYMENT, loanId: loan.id }, { transaction });
  return { withdrawal, payment, loan, account };
}
