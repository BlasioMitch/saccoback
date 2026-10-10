import { QueryTypes } from 'sequelize';
import sequelize from '../lib/sequelize.js';
import {
  AGING_BUCKETS, balanceSheet, cashEffect, CHART_OF_ACCOUNTS, LedgerEvent, LedgerEventKind, loanArrears, trialBalance,
} from '../lib/ledger.js';
import { ServiceError } from './errors.js';

// Report dates are calendar days in Kampala (EAT, UTC+3, no daylight saving)
export const TIME_ZONE = 'Africa/Kampala';
const EAT_OFFSET = '+03:00';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const startOfDay = (day: string) => new Date(`${day}T00:00:00${EAT_OFFSET}`);
const endOfDay = (day: string) => new Date(`${day}T23:59:59.999${EAT_OFFSET}`);
export const todayInKampala = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

function parseDay(value: unknown, name: string, fallback?: string): string {
  if (value === undefined || value === null || value === '') {
    if (fallback) return fallback;
    throw new ServiceError(400, `${name} is required (YYYY-MM-DD)`);
  }
  const text = String(value);
  if (!DATE_PATTERN.test(text) || Number.isNaN(startOfDay(text).getTime())) throw new ServiceError(400, `${name} must be a date (YYYY-MM-DD)`);
  return text;
}

export function parseRange(query: Record<string, unknown>) {
  const to = parseDay(query.to, 'to', todayInKampala());
  const from = parseDay(query.from, 'from', `${to.slice(0, 4)}-01-01`);
  if (from > to) throw new ServiceError(400, '"from" must be on or before "to"');
  return { from, to, start: startOfDay(from), end: endOfDay(to) };
}

export const parseAsAt = (query: Record<string, unknown>) => {
  const asAt = parseDay(query.asAt, 'asAt', todayInKampala());
  return { asAt, end: endOfDay(asAt) };
};

// Loans count as disbursed once approved (applications never are)
const DISBURSED = `('ACTIVE','PAID','DEFAULTED')`;

// Interest part of a COMPLETED repayment, in proportion to the loan's interest (lib/ledger.ts interestShare)
const INTEREST_SQL = `
  CASE WHEN t.type = 'LOAN_PAYMENT' AND l.id IS NOT NULL THEN
    LEAST(t.amount, ROUND(t.amount * ROUND(l.amount * l."interestRate" / 100)
      / NULLIF(l.amount + ROUND(l.amount * l."interestRate" / 100), 0)))
  ELSE 0 END`;

export type Grain = 'week' | 'month' | 'quarter';

interface EventRow {
  period: string | null;
  kind: LedgerEventKind;
  amount: string | number;
  interest: string | number;
  count: string | number;
}

// Every ledger event between two moments, summed by kind (and by week/month/quarter when a grain is given)
export async function ledgerEvents({ after, before, grain }: { after?: Date | null; before: Date; grain?: Grain | null }) {
  const period = grain
    ? `to_char(date_trunc('${grain}', %COL% AT TIME ZONE '${TIME_ZONE}'), 'YYYY-MM-DD')`
    : 'NULL';
  const rows = await sequelize.query<EventRow>(`
    SELECT ${period.replace('%COL%', 't."createdAt"')} AS period, t.type::text AS kind,
           SUM(t.amount) AS amount, SUM(${INTEREST_SQL}) AS interest, COUNT(*) AS count
      FROM transactions t
      LEFT JOIN loans l ON l.id = t."loanId"
     WHERE t.status = 'COMPLETED' AND t."createdAt" <= :before ${after ? 'AND t."createdAt" >= :after' : ''}
     GROUP BY 1, 2
    UNION ALL
    SELECT ${period.replace('%COL%', 'l."startDate"')} AS period, 'LOAN_DISBURSEMENT' AS kind,
           SUM(l.amount) AS amount, 0 AS interest, COUNT(*) AS count
      FROM loans l
     WHERE l.status IN ${DISBURSED} AND l."startDate" <= :before ${after ? 'AND l."startDate" >= :after' : ''}
     GROUP BY 1
  `, { type: QueryTypes.SELECT, replacements: { before, after } });

  return rows.map(row => ({
    period: row.period,
    kind: row.kind,
    amount: Number(row.amount) || 0,
    interest: Number(row.interest) || 0,
    count: Number(row.count) || 0,
  }));
}

const asEvents = (rows: Array<{ kind: LedgerEventKind; amount: number; interest: number }>): LedgerEvent[] =>
  rows.map(row => ({ kind: row.kind, amount: row.amount, interest: row.interest }));

const KIND_LABELS: Record<LedgerEventKind, string> = {
  SAVINGS_DEPOSIT: 'Savings deposit',
  ACCOUNT_WITHDRAW: 'Withdrawal',
  CLOSURE_WITHDRAW: 'Account closure payout',
  MEMBERSHIP_FEE: 'Membership fee',
  LOAN_PAYMENT: 'Loan repayment',
  LOAN_DISBURSEMENT: 'Loan disbursement',
};

const MAX_CASH_BOOK_LINES = 10_000;

interface CashRow {
  id: string;
  at: Date;
  kind: LedgerEventKind;
  amount: string | number;
  interest: string | number;
  accountNumber: string | null;
  member: string | null;
  loanId: string | null;
}

// Cash book: every movement of cash in the period, oldest first, with a running balance
export async function cashBook(query: Record<string, unknown>) {
  const { from, to, start, end } = parseRange(query);
  const kind = typeof query.kind === 'string' && query.kind ? query.kind : null;
  const accountNumber = typeof query.accountNumber === 'string' && query.accountNumber ? query.accountNumber : null;

  const before = await ledgerEvents({ before: new Date(start.getTime() - 1) });
  const opening = before.reduce((total, row) => total + cashEffect(row), 0);

  const rows = await sequelize.query<CashRow>(`
    SELECT * FROM (
      SELECT t.id, t."createdAt" AS at, t.type::text AS kind, t.amount, ${INTEREST_SQL} AS interest,
             a."accountNumber" AS "accountNumber", TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS member, t."loanId" AS "loanId"
        FROM transactions t
        JOIN accounts a ON a.id = t."accountId"
        LEFT JOIN users u ON u.id = a."userId"
        LEFT JOIN loans l ON l.id = t."loanId"
       WHERE t.status = 'COMPLETED' AND t.type <> 'MEMBERSHIP_FEE' AND t."createdAt" BETWEEN :start AND :end
      UNION ALL
      SELECT l.id, l."startDate" AS at, 'LOAN_DISBURSEMENT' AS kind, l.amount, 0 AS interest,
             a."accountNumber", TRIM(CONCAT(u.first_name, ' ', u.last_name)), l.id
        FROM loans l
        JOIN accounts a ON a.id = l."accountId"
        LEFT JOIN users u ON u.id = a."userId"
       WHERE l.status IN ${DISBURSED} AND l."startDate" BETWEEN :start AND :end
    ) cash
    ORDER BY at, id
    LIMIT ${MAX_CASH_BOOK_LINES + 1}
  `, { type: QueryTypes.SELECT, replacements: { start, end } });

  const truncated = rows.length > MAX_CASH_BOOK_LINES;
  let balance = opening;
  let totalIn = 0;
  let totalOut = 0;
  const allLines = rows.slice(0, MAX_CASH_BOOK_LINES).map(row => {
    const effect = cashEffect({ kind: row.kind, amount: Number(row.amount), interest: Number(row.interest) });
    balance += effect;
    if (effect > 0) totalIn += effect;
    else totalOut -= effect;
    return {
      id: row.id,
      date: new Date(row.at).toISOString(),
      kind: row.kind,
      description: KIND_LABELS[row.kind] ?? row.kind,
      member: row.member || null,
      accountNumber: row.accountNumber,
      inflow: effect > 0 ? effect : 0,
      outflow: effect < 0 ? -effect : 0,
      balance,
    };
  });
  // Filters narrow the lines shown; the balances always describe the whole cash position
  const lines = allLines.filter(line => (!kind || line.kind === kind) && (!accountNumber || line.accountNumber === accountNumber));

  return { from, to, opening, closing: balance, totalIn, totalOut, lines, truncated, filtered: Boolean(kind || accountNumber) };
}

const monthsBetween = (from: string, to: string) => {
  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const last = to.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (key >= last) break;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
};

// Income statement: what the SACCO earned in the period, month by month
export async function incomeStatement(query: Record<string, unknown>) {
  const { from, to, start, end } = parseRange(query);
  const rows = await ledgerEvents({ after: start, before: end, grain: 'month' });
  const months = monthsBetween(from, to).map(month => ({ month, feeIncome: 0, interestIncome: 0, total: 0 }));
  const byMonth = new Map(months.map(entry => [entry.month, entry]));
  for (const row of rows) {
    const entry = byMonth.get(String(row.period).slice(0, 7));
    if (!entry) continue;
    if (row.kind === 'MEMBERSHIP_FEE') entry.feeIncome += row.amount;
    if (row.kind === 'LOAN_PAYMENT') entry.interestIncome += row.interest;
    entry.total = entry.feeIncome + entry.interestIncome;
  }
  const totals = months.reduce(
    (sum, entry) => ({ feeIncome: sum.feeIncome + entry.feeIncome, interestIncome: sum.interestIncome + entry.interestIncome, total: sum.total + entry.total }),
    { feeIncome: 0, interestIncome: 0, total: 0 },
  );
  return {
    from,
    to,
    income: [
      { code: CHART_OF_ACCOUNTS.FEE_INCOME.code, name: CHART_OF_ACCOUNTS.FEE_INCOME.name, amount: totals.feeIncome },
      { code: CHART_OF_ACCOUNTS.INTEREST_INCOME.code, name: CHART_OF_ACCOUNTS.INTEREST_INCOME.name, amount: totals.interestIncome },
    ],
    // Running costs are not recorded in the system yet
    expenses: [],
    expensesRecorded: false,
    totals: { income: totals.total, expenses: 0, surplus: totals.total },
    months,
  };
}

export async function trialBalanceReport(query: Record<string, unknown>) {
  const { asAt, end } = parseAsAt(query);
  const events = asEvents(await ledgerEvents({ before: end }));
  return { asAt, ...trialBalance(events) };
}

// Balance sheet, with a check of the ledger's member savings against the balances on the accounts
export async function balanceSheetReport(query: Record<string, unknown>) {
  const { asAt, end } = parseAsAt(query);
  const events = asEvents(await ledgerEvents({ before: end }));
  const sheet = balanceSheet(events);
  const reconciliation = asAt === todayInKampala()
    ? await sequelize.query<{ total: string }>('SELECT COALESCE(SUM(balance), 0) AS total FROM accounts', { type: QueryTypes.SELECT, plain: true })
    : null;
  const ledgerSavings = sheet.liabilities.find(line => line.code === CHART_OF_ACCOUNTS.MEMBER_SAVINGS.code)?.amount ?? 0;
  return {
    asAt,
    ...sheet,
    // Only for today: account balances are kept as current values, not history
    savingsCheck: reconciliation ? {
      ledger: ledgerSavings,
      accounts: Number(reconciliation.total) || 0,
      difference: (Number(reconciliation.total) || 0) - ledgerSavings,
    } : null,
  };
}

interface LoanRow {
  id: string;
  amount: string | number;
  interestRate: string | number;
  term: number;
  startDate: Date;
  endDate: Date;
  status: string;
  accountNumber: string | null;
  member: string | null;
  paid: string | number;
}

// Loan portfolio and arrears as at a date: every disbursed loan, its standing, and the aging of overdue amounts
export async function loanPortfolio(query: Record<string, unknown>) {
  const { asAt, end } = parseAsAt(query);
  const rows = await sequelize.query<LoanRow>(`
    SELECT l.id, l.amount, l."interestRate" AS "interestRate", l.term, l."startDate" AS "startDate", l."endDate" AS "endDate", l.status,
           a."accountNumber" AS "accountNumber", TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS member,
           COALESCE(p.paid, 0) AS paid
      FROM loans l
      JOIN accounts a ON a.id = l."accountId"
      LEFT JOIN users u ON u.id = a."userId"
      LEFT JOIN (
        SELECT "loanId", SUM(amount) AS paid FROM transactions
         WHERE type = 'LOAN_PAYMENT' AND status = 'COMPLETED' AND "createdAt" <= :end
         GROUP BY "loanId"
      ) p ON p."loanId" = l.id
     WHERE l.status IN ${DISBURSED} AND l."startDate" <= :end
     ORDER BY l."startDate" DESC
  `, { type: QueryTypes.SELECT, replacements: { end } });

  const loans = rows.map(row => {
    const standing = loanArrears({
      amount: Number(row.amount),
      interestRate: Number(row.interestRate),
      term: Number(row.term),
      startDate: row.startDate,
      paid: Number(row.paid),
    }, end);
    // Status on the report date: paid off by then, written off as defaulted, or still being repaid
    const status = standing.outstanding === 0 ? 'PAID' : row.status === 'DEFAULTED' ? 'DEFAULTED' : 'ACTIVE';
    return {
      id: row.id,
      member: row.member || null,
      accountNumber: row.accountNumber,
      principal: Number(row.amount),
      interestRate: Number(row.interestRate),
      term: Number(row.term),
      startDate: new Date(row.startDate).toISOString(),
      endDate: row.endDate ? new Date(row.endDate).toISOString() : null,
      status,
      ...standing,
    };
  });

  const open = loans.filter(loan => loan.status !== 'PAID');
  const outstanding = open.reduce((total, loan) => total + loan.outstanding, 0);
  const aging = AGING_BUCKETS.map(bucket => {
    const inBucket = open.filter(loan => loan.bucket === bucket.key);
    return {
      key: bucket.key,
      label: bucket.label,
      count: inBucket.length,
      outstanding: inBucket.reduce((total, loan) => total + loan.outstanding, 0),
      arrears: inBucket.reduce((total, loan) => total + loan.arrears, 0),
    };
  });
  // Portfolio at risk: share of the outstanding book on loans more than 30 days overdue
  const atRisk = open.filter(loan => loan.daysOverdue > 30).reduce((total, loan) => total + loan.outstanding, 0);
  const byStatus = ['ACTIVE', 'DEFAULTED', 'PAID'].map(status => ({
    status,
    count: loans.filter(loan => loan.status === status).length,
    principal: loans.filter(loan => loan.status === status).reduce((total, loan) => total + loan.principal, 0),
  }));

  return {
    asAt,
    summary: {
      loans: loans.length,
      openLoans: open.length,
      disbursed: loans.reduce((total, loan) => total + loan.principal, 0),
      repaid: loans.reduce((total, loan) => total + loan.paid, 0),
      outstanding,
      arrears: open.reduce((total, loan) => total + loan.arrears, 0),
      loansInArrears: open.filter(loan => loan.arrears > 0).length,
      portfolioAtRisk30: outstanding > 0 ? atRisk / outstanding : 0,
    },
    byStatus,
    aging,
    loans,
  };
}

export const REPORTS = {
  'cash-book': cashBook,
  'income-statement': incomeStatement,
  'trial-balance': trialBalanceReport,
  'balance-sheet': balanceSheetReport,
  'loan-portfolio': loanPortfolio,
} as const;

export type ReportType = keyof typeof REPORTS;
export const isReportType = (value: string): value is ReportType => value in REPORTS;
