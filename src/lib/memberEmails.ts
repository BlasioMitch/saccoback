import { models } from '../models/index.js';
import { TransactionStatus, TransactionType } from '../models/transaction.js';
import { sendInBackground, sendLoanApprovedEmail, sendLoanClearedEmail, sendTransactionEmail } from './mailer.js';

// Emails to the member, looked up fresh after the change is saved: a receipt for each live transaction, the
// statement when a loan is approved (or created by staff), and the certificate when it is fully repaid, whichever
// way that happened (repayment, from savings, an edit).

const memberName = (user: any) => [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Member';

async function loanWithOwner(loanId: string) {
  const loan = await models.Loan.findByPk(loanId, { include: [{ model: models.LoanSummary, as: 'summary' }] });
  const account = loan ? await models.Account.findByPk(loan.accountId) : null;
  const owner = account ? await models.User.findByPk(account.userId) : null;
  return { loan: loan as any, account, owner };
}

export function emailLoanApproved(loanId: string) {
  sendInBackground('loan approved', (async () => {
    const { loan, account, owner } = await loanWithOwner(loanId);
    if (!loan || !account || !owner?.email) return;
    await sendLoanApprovedEmail({
      email: owner.email,
      loanId: loan.id,
      memberName: memberName(owner),
      accountNumber: account.accountNumber,
      amount: Number(loan.amount),
      interestRate: Number(loan.interestRate),
      term: Number(loan.term),
      startDate: loan.startDate,
      endDate: loan.endDate,
      totalInterest: Number(loan.summary?.totalInterest ?? 0),
      monthlyPayment: Number(loan.summary?.monthlyPayment ?? 0),
      purpose: loan.purpose,
      note: loan.decisionNote,
      approvedAt: loan.decidedAt ?? loan.createdAt,
    });
  })());
}

export function emailLoanCleared(loanId: string) {
  sendInBackground('loan cleared', (async () => {
    const { loan, account, owner } = await loanWithOwner(loanId);
    if (!loan || !account || !owner?.email) return;
    const payments = await models.Transaction.findAll({
      where: { loanId, type: TransactionType.LOAN_PAYMENT, status: TransactionStatus.COMPLETED },
      order: [['createdAt', 'ASC']],
    });
    await sendLoanClearedEmail({
      email: owner.email,
      loanId: loan.id,
      memberName: memberName(owner),
      accountNumber: account.accountNumber,
      amount: Number(loan.amount),
      interestRate: Number(loan.interestRate),
      term: Number(loan.term),
      totalInterest: Number(loan.summary?.totalInterest ?? 0),
      startDate: loan.startDate,
      clearedAt: payments[payments.length - 1]?.createdAt ?? new Date(),
      payments: payments.map(payment => ({ date: payment.createdAt, amount: Number(payment.amount) })),
    });
  })());
}

export function emailReceipt(transaction: any, { loanRemaining = null as number | null, description = null as string | null } = {}) {
  sendInBackground('receipt', (async () => {
    const account = await models.Account.findByPk(transaction.accountId);
    const owner = account ? await models.User.findByPk(account.userId) : null;
    if (!account || !owner?.email) return;
    await sendTransactionEmail({
      email: owner.email,
      transactionId: transaction.id,
      memberName: memberName(owner),
      accountNumber: account.accountNumber,
      type: transaction.type,
      amount: Number(transaction.amount),
      status: transaction.status,
      date: transaction.createdAt,
      description: description ?? transaction.description ?? null,
      balanceAfter: Number(account.balance),
      loanRemaining,
    });
  })());
}
