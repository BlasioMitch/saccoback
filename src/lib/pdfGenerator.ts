import {
  amountPanel, brandHeader, COLORS, footer, formatUGX, kampalaDate, kampalaDateTime, keyValues, newDocument, paragraph,
  reference, sectionHeading, table, toBuffer, typeLabel,
} from './brandPdf.js';
import { repaymentSchedule } from './loanSchedule.js';

// The documents members receive by email: a receipt for each transaction, a confirmation when their account
// opens, a statement (with the repayment plan) when a loan is approved, and a certificate when it is cleared.
// Each returns the PDF as a Buffer.

export interface ReceiptData {
  transactionId: string;
  memberName: string;
  accountNumber: string;
  type: string;
  amount: number;
  status: string;
  date: Date | string;
  description?: string | null;
  // Savings balance after this transaction; for a loan repayment, what is still owed on the loan
  balanceAfter?: number | null;
  loanRemaining?: number | null;
}

const STATUS_TONE: Record<string, 'good' | 'warning' | 'danger'> = { COMPLETED: 'good', PENDING: 'warning', FAILED: 'danger' };
const statusLabel = (status: string) => status.charAt(0) + status.slice(1).toLowerCase();

export async function transactionReceipt(data: ReceiptData) {
  const doc = newDocument();
  const ref = reference('TX', data.transactionId);
  doc.info.Title = `Receipt ${ref}`;
  brandHeader(doc, { title: 'Transaction receipt', reference: `Receipt no. ${ref}`, subtitle: kampalaDateTime(data.date) });

  amountPanel(doc, {
    label: typeLabel(data.type),
    amount: formatUGX(data.amount),
    chip: statusLabel(data.status),
    chipTone: STATUS_TONE[data.status] ?? 'good',
  });

  sectionHeading(doc, 'Details');
  keyValues(doc, [
    ['Member', data.memberName],
    ['Account number', data.accountNumber],
    ['Date and time', `${kampalaDateTime(data.date)} (Kampala)`],
    ['Receipt number', ref],
    ...(data.loanRemaining != null ? [['Still owed on the loan', formatUGX(data.loanRemaining)] as [string, string]] : []),
    ...(data.balanceAfter != null && data.type !== 'LOAN_PAYMENT' ? [['Savings balance after', formatUGX(data.balanceAfter)] as [string, string]] : []),
    ...(data.description ? [['Description', data.description] as [string, string]] : []),
  ]);

  paragraph(doc, data.status === 'COMPLETED'
    ? 'This transaction has been recorded on your account. Thank you for saving with Green Sprout SACCO.'
    : data.status === 'PENDING'
      ? 'This transaction is waiting to be completed. You will receive another receipt when it is.'
      : 'This transaction did not go through and has not changed your balance.', { color: COLORS.muted, size: 9.5 });

  footer(doc, `Green Sprout SACCO · Receipt ${ref} · Keep this receipt for your records.`);
  return toBuffer(doc);
}

export interface AccountConfirmationData {
  memberName: string;
  email: string;
  contact?: string | null;
  accountNumber: string;
  openedAt: Date | string;
  openingDeposit?: number | null;
  membershipFeePaid?: boolean;
}

export async function accountConfirmation(data: AccountConfirmationData) {
  const doc = newDocument();
  doc.info.Title = `Account ${data.accountNumber}`;
  brandHeader(doc, { title: 'Account confirmation', reference: `Account ${data.accountNumber}`, subtitle: `Opened ${kampalaDate(data.openedAt)}` });

  paragraph(doc, `Welcome to Green Sprout SACCO, ${data.memberName}. Your savings account is open and ready to use.`, { size: 11 });
  amountPanel(doc, { label: 'Your account number', amount: data.accountNumber, chip: 'Active' });

  sectionHeading(doc, 'Member');
  keyValues(doc, [
    ['Name', data.memberName],
    ['Email', data.email],
    ...(data.contact ? [['Phone', data.contact] as [string, string]] : []),
    ['Opened on', kampalaDate(data.openedAt)],
  ]);

  sectionHeading(doc, 'At opening');
  keyValues(doc, [
    ['Opening deposit', formatUGX(data.openingDeposit ?? 0)],
    ['Membership fee', data.membershipFeePaid ? 'Paid' : 'Not paid yet'],
  ]);

  sectionHeading(doc, 'Next steps');
  paragraph(doc, [
    '• Sign in to the Green Sprout app with your email to see your balance, statement and loans.',
    '• Pay the membership fee to become eligible for loans.',
    '• Every deposit and withdrawal sends you a receipt by email.',
  ].join('\n'), { size: 10 });

  footer(doc);
  return toBuffer(doc);
}

export interface LoanStatementData {
  loanId: string;
  memberName: string;
  accountNumber: string;
  amount: number;
  interestRate: number;
  term: number;
  startDate: Date | string;
  endDate: Date | string;
  totalInterest: number;
  monthlyPayment: number;
  purpose?: string | null;
  note?: string | null;
  approvedAt?: Date | string | null;
}

export async function loanStatement(data: LoanStatementData) {
  const doc = newDocument();
  const ref = reference('LN', data.loanId);
  doc.info.Title = `Loan statement ${ref}`;
  brandHeader(doc, { title: 'Loan statement', reference: `Loan ${ref}`, subtitle: `Approved ${kampalaDate(data.approvedAt ?? new Date())}` });

  const totalDue = Number(data.amount) + Number(data.totalInterest);
  amountPanel(doc, {
    label: 'Loan amount',
    amount: formatUGX(data.amount),
    chip: 'Approved',
    note: `${data.term} monthly payments of about ${formatUGX(data.monthlyPayment)} · total to repay ${formatUGX(totalDue)}`,
  });

  sectionHeading(doc, 'Terms');
  keyValues(doc, [
    ['Member', data.memberName],
    ['Account number', data.accountNumber],
    ['Interest rate', `${Number(data.interestRate)}% (flat, on the amount borrowed)`],
    ['Repayment period', `${data.term} month${data.term === 1 ? '' : 's'}`],
    ['Start date', kampalaDate(data.startDate)],
    ['Last payment due', kampalaDate(data.endDate)],
    ['Total interest', formatUGX(data.totalInterest)],
    ['Total to repay', formatUGX(totalDue)],
    ...(data.purpose ? [['Purpose', data.purpose] as [string, string]] : []),
    ...(data.note ? [['Note from the SACCO', data.note] as [string, string]] : []),
  ]);

  sectionHeading(doc, 'Repayment plan');
  const schedule = repaymentSchedule(data.amount, data.interestRate, data.term, new Date(data.startDate));
  table(
    doc,
    [{ label: 'No.', width: 0.6 }, { label: 'Due date', width: 2 }, { label: 'Payment', width: 2, align: 'right' }, { label: 'Owed after', width: 2, align: 'right' }],
    schedule.map(row => [String(row.number), kampalaDate(row.dueDate), formatUGX(row.amount), formatUGX(row.balanceAfter)]),
    ['', 'Total', formatUGX(schedule.reduce((sum, row) => sum + row.amount, 0)), ''],
  );
  paragraph(doc, 'Payments can be made at the SACCO office or from your savings. Paying early reduces what is still owed; the interest does not change.', { color: COLORS.muted, size: 9 });

  footer(doc, `Green Sprout SACCO · Loan ${ref} · Keep this statement for your records.`);
  return toBuffer(doc);
}

export interface LoanClearedData {
  loanId: string;
  memberName: string;
  accountNumber: string;
  amount: number;
  interestRate: number;
  term: number;
  totalInterest: number;
  startDate: Date | string;
  clearedAt: Date | string;
  payments: Array<{ date: Date | string; amount: number }>;
}

export async function loanClearedCertificate(data: LoanClearedData) {
  const doc = newDocument();
  const ref = reference('LN', data.loanId);
  doc.info.Title = `Loan cleared ${ref}`;
  brandHeader(doc, { title: 'Loan cleared', reference: `Loan ${ref}`, subtitle: `Cleared ${kampalaDate(data.clearedAt)}` });

  const totalRepaid = data.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  paragraph(doc, `Congratulations, ${data.memberName}. This certifies that the loan below has been repaid in full and nothing more is owed on it.`, { size: 11 });
  amountPanel(doc, { label: 'Total repaid', amount: formatUGX(totalRepaid), chip: 'Paid in full' });

  sectionHeading(doc, 'Loan');
  keyValues(doc, [
    ['Member', data.memberName],
    ['Account number', data.accountNumber],
    ['Amount borrowed', formatUGX(data.amount)],
    ['Interest', `${formatUGX(data.totalInterest)} (${Number(data.interestRate)}%)`],
    ['Started', kampalaDate(data.startDate)],
    ['Cleared', kampalaDate(data.clearedAt)],
  ]);

  sectionHeading(doc, 'Repayments');
  table(
    doc,
    [{ label: 'No.', width: 0.6 }, { label: 'Date', width: 3 }, { label: 'Amount', width: 2, align: 'right' }],
    data.payments.map((payment, index) => [String(index + 1), kampalaDate(payment.date), formatUGX(payment.amount)]),
    ['', 'Total', formatUGX(totalRepaid)],
  );
  paragraph(doc, 'You can apply for a new loan from the Green Sprout app whenever you are ready.', { color: COLORS.muted, size: 9 });

  footer(doc, `Green Sprout SACCO · Loan ${ref} cleared · Keep this certificate for your records.`);
  return toBuffer(doc);
}
