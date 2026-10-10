// Double-entry bookkeeping derived from the SACCO's own records. Nothing here is stored: COMPLETED
// transactions and disbursed loans are posted to a small chart of accounts whenever a report is built,
// so every report (cash book, income statement, trial balance, balance sheet) balances by construction.
//
// Pure functions only (no database), so the posting rules can be tested on their own.

export type LedgerAccountKey = 'CASH' | 'LOANS_RECEIVABLE' | 'MEMBER_SAVINGS' | 'FEE_INCOME' | 'INTEREST_INCOME';
export type LedgerAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

export interface LedgerAccount {
  key: LedgerAccountKey;
  code: string;
  name: string;
  type: LedgerAccountType;
}

export const CHART_OF_ACCOUNTS: Record<LedgerAccountKey, LedgerAccount> = {
  CASH: { key: 'CASH', code: '1000', name: 'Cash and bank', type: 'ASSET' },
  LOANS_RECEIVABLE: { key: 'LOANS_RECEIVABLE', code: '1100', name: 'Loans to members', type: 'ASSET' },
  MEMBER_SAVINGS: { key: 'MEMBER_SAVINGS', code: '2000', name: 'Member savings deposits', type: 'LIABILITY' },
  FEE_INCOME: { key: 'FEE_INCOME', code: '4000', name: 'Membership fee income', type: 'INCOME' },
  INTEREST_INCOME: { key: 'INTEREST_INCOME', code: '4100', name: 'Loan interest income', type: 'INCOME' },
};

// Assets and expenses grow with debits; liabilities, equity and income with credits
export const DEBIT_NORMAL: ReadonlySet<LedgerAccountType> = new Set(['ASSET', 'EXPENSE']);

export type LedgerEventKind =
  | 'SAVINGS_DEPOSIT'
  | 'ACCOUNT_WITHDRAW'
  | 'CLOSURE_WITHDRAW'
  | 'MEMBERSHIP_FEE'
  | 'LOAN_PAYMENT'
  | 'LOAN_DISBURSEMENT';

export interface LedgerEvent {
  kind: LedgerEventKind;
  amount: number;
  // LOAN_PAYMENT only: the part of the payment that is interest (see interestShare)
  interest?: number;
}

export interface JournalLine {
  account: LedgerAccountKey;
  debit: number;
  credit: number;
}

const dr = (account: LedgerAccountKey, amount: number): JournalLine => ({ account, debit: amount, credit: 0 });
const cr = (account: LedgerAccountKey, amount: number): JournalLine => ({ account, debit: 0, credit: amount });

// Flat interest, as the loan book charges it (lib/utils.ts calculateTotalInterest)
export const totalInterest = (principal: number, interestRate: number) => Math.round(Number(principal) * Number(interestRate) / 100);

// Each repayment is part principal, part interest, in the loan's own proportion of interest to total owed
export function interestShare(payment: number, principal: number, interestRate: number) {
  const interest = totalInterest(principal, interestRate);
  const owed = Number(principal) + interest;
  if (!(owed > 0) || !(payment > 0)) return 0;
  return Math.min(Number(payment), Math.round(Number(payment) * interest / owed));
}

// The journal lines for one event. Debits always equal credits.
export function postEvent(event: LedgerEvent): JournalLine[] {
  const amount = Math.max(0, Math.round(Number(event.amount) || 0));
  if (!amount) return [];
  switch (event.kind) {
    case 'SAVINGS_DEPOSIT':
      return [dr('CASH', amount), cr('MEMBER_SAVINGS', amount)];
    case 'ACCOUNT_WITHDRAW':
    case 'CLOSURE_WITHDRAW':
      return [dr('MEMBER_SAVINGS', amount), cr('CASH', amount)];
    case 'MEMBERSHIP_FEE':
      // The fee is taken from the member's savings balance (services/transactions.ts)
      return [dr('MEMBER_SAVINGS', amount), cr('FEE_INCOME', amount)];
    case 'LOAN_DISBURSEMENT':
      return [dr('LOANS_RECEIVABLE', amount), cr('CASH', amount)];
    case 'LOAN_PAYMENT': {
      const interest = Math.min(amount, Math.max(0, Math.round(Number(event.interest) || 0)));
      const lines = [dr('CASH', amount), cr('LOANS_RECEIVABLE', amount - interest)];
      if (interest) lines.push(cr('INTEREST_INCOME', interest));
      return lines.filter(line => line.debit || line.credit);
    }
    default:
      return [];
  }
}

// Cash moved by an event: positive in, negative out, 0 when no cash moved (a fee comes out of savings)
export function cashEffect(event: LedgerEvent) {
  return postEvent(event)
    .filter(line => line.account === 'CASH')
    .reduce((total, line) => total + line.debit - line.credit, 0);
}

export interface AccountBalance extends LedgerAccount {
  debit: number;
  credit: number;
  // On the account's normal side: positive is normal (e.g. cash held), negative is unusual (overdrawn)
  balance: number;
}

export function balancesOf(events: LedgerEvent[]): AccountBalance[] {
  const totals = new Map<LedgerAccountKey, { debit: number; credit: number }>();
  for (const key of Object.keys(CHART_OF_ACCOUNTS) as LedgerAccountKey[]) totals.set(key, { debit: 0, credit: 0 });
  for (const event of events) {
    for (const line of postEvent(event)) {
      const total = totals.get(line.account)!;
      total.debit += line.debit;
      total.credit += line.credit;
    }
  }
  return [...totals.entries()].map(([key, { debit, credit }]) => {
    const account = CHART_OF_ACCOUNTS[key];
    const balance = DEBIT_NORMAL.has(account.type) ? debit - credit : credit - debit;
    return { ...account, debit, credit, balance };
  });
}

// Trial balance: each account's net balance in the debit or credit column
export function trialBalance(events: LedgerEvent[]) {
  const rows = balancesOf(events).map(account => {
    const net = account.debit - account.credit;
    return {
      code: account.code,
      name: account.name,
      type: account.type,
      debit: net > 0 ? net : 0,
      credit: net < 0 ? -net : 0,
    };
  });
  const totals = rows.reduce((sum, row) => ({ debit: sum.debit + row.debit, credit: sum.credit + row.credit }), { debit: 0, credit: 0 });
  return { rows, totals, balanced: totals.debit === totals.credit };
}

// Balance sheet: assets = liabilities + equity, where equity is the surplus earned so far (income less expenses)
export function balanceSheet(events: LedgerEvent[]) {
  const balances = balancesOf(events);
  const line = (account: AccountBalance) => ({ code: account.code, name: account.name, amount: account.balance });
  const assets = balances.filter(account => account.type === 'ASSET').map(line);
  const liabilities = balances.filter(account => account.type === 'LIABILITY').map(line);
  const income = balances.filter(account => account.type === 'INCOME').reduce((sum, account) => sum + account.balance, 0);
  const expenses = balances.filter(account => account.type === 'EXPENSE').reduce((sum, account) => sum + account.balance, 0);
  const equity = [{ code: '3000', name: 'Accumulated surplus', amount: income - expenses }];
  const sum = (rows: { amount: number }[]) => rows.reduce((total, row) => total + row.amount, 0);
  const totals = {
    assets: sum(assets),
    liabilities: sum(liabilities),
    equity: sum(equity),
  };
  return { assets, liabilities, equity, totals, balanced: totals.assets === totals.liabilities + totals.equity };
}

export const AGING_BUCKETS = [
  { key: 'CURRENT', label: 'Current', minDays: 0, maxDays: 0 },
  { key: 'D1_30', label: '1–30 days', minDays: 1, maxDays: 30 },
  { key: 'D31_60', label: '31–60 days', minDays: 31, maxDays: 60 },
  { key: 'D61_90', label: '61–90 days', minDays: 61, maxDays: 90 },
  { key: 'D90_PLUS', label: 'Over 90 days', minDays: 91, maxDays: Infinity },
] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number]['key'];

const DAY_MS = 24 * 60 * 60 * 1000;

const addMonths = (date: Date, months: number) => {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  // 31 Jan + 1 month is the last day of February, not 3 March
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
};

export interface LoanForArrears {
  amount: number;
  interestRate: number;
  term: number;
  startDate: Date | string;
  // COMPLETED repayments up to the report date
  paid: number;
}

// Where a loan stands on a date: one instalment (monthlyPayment) falls due each month after the start date.
// Arrears = what should have been repaid by now minus what was; days overdue counts from the first
// instalment that is not fully covered.
export function loanArrears(loan: LoanForArrears, asAt: Date) {
  const principal = Number(loan.amount);
  const term = Math.max(1, Number(loan.term));
  const interest = totalInterest(principal, loan.interestRate);
  const owed = principal + interest;
  const monthlyPayment = Math.ceil(owed / term);
  const paid = Math.max(0, Number(loan.paid) || 0);
  const outstanding = Math.max(0, owed - paid);
  const start = new Date(loan.startDate);

  let instalmentsDue = 0;
  while (instalmentsDue < term && addMonths(start, instalmentsDue + 1).getTime() <= asAt.getTime()) instalmentsDue += 1;
  const expectedPaid = Math.min(owed, instalmentsDue * monthlyPayment);
  const arrears = outstanding > 0 ? Math.max(0, expectedPaid - paid) : 0;

  let daysOverdue = 0;
  if (arrears > 0) {
    const instalmentsCovered = Math.floor(paid / monthlyPayment);
    const firstUnpaidDue = addMonths(start, instalmentsCovered + 1);
    daysOverdue = Math.max(0, Math.floor((asAt.getTime() - firstUnpaidDue.getTime()) / DAY_MS));
  }
  const bucket = (AGING_BUCKETS.find(entry => daysOverdue >= entry.minDays && daysOverdue <= entry.maxDays) ?? AGING_BUCKETS[0]).key;

  return { owed, interest, monthlyPayment, paid, outstanding, instalmentsDue, expectedPaid, arrears, daysOverdue, bucket };
}
