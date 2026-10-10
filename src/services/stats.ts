import { QueryTypes } from 'sequelize';
import sequelize from '../lib/sequelize.js';
import { balancesOf, LedgerEvent } from '../lib/ledger.js';
import { Grain, ledgerEvents, loanPortfolio, TIME_ZONE, todayInKampala } from './reports.js';
import { ServiceError } from './errors.js';

// Dashboard figures for a period (3 months, 6 months, a year, or everything), computed by Postgres
// (grouped by week, month or quarter) so loading stays fast however much history there is.

export const RANGES = ['3M', '6M', '1Y', 'ALL'] as const;
export type Range = (typeof RANGES)[number];

const MONTHS_BY_RANGE: Record<Exclude<Range, 'ALL'>, number> = { '3M': 3, '6M': 6, '1Y': 12 };
const CACHE_MS = 60_000;
const cache = new Map<Range, { at: number; value: unknown }>();

const endOfToday = () => new Date(`${todayInKampala()}T23:59:59.999+03:00`);

const monthsBack = (date: Date, months: number) => {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() - months);
  result.setUTCHours(-3, 0, 0, 0); // start of that day in Kampala
  return result;
};

async function firstActivity() {
  const row = await sequelize.query<{ first: Date | null }>(`
    SELECT LEAST(
      (SELECT MIN("createdAt") FROM transactions WHERE status = 'COMPLETED'),
      (SELECT MIN("startDate") FROM loans WHERE status IN ('ACTIVE','PAID','DEFAULTED')),
      (SELECT MIN("joinDate") FROM users WHERE role = 'USER')
    ) AS first
  `, { type: QueryTypes.SELECT, plain: true });
  return row?.first ? new Date(row.first) : null;
}

type Flow = Record<'deposits' | 'withdrawals' | 'repayments' | 'disbursed' | 'feeIncome' | 'interestIncome', number> & { transactions: number };

const emptyFlow = (): Flow => ({ deposits: 0, withdrawals: 0, repayments: 0, disbursed: 0, feeIncome: 0, interestIncome: 0, transactions: 0 });

const addToFlow = (flow: Flow, row: { kind: string; amount: number; interest: number; count: number }) => {
  if (row.kind !== 'LOAN_DISBURSEMENT') flow.transactions += row.count;
  switch (row.kind) {
    case 'SAVINGS_DEPOSIT': flow.deposits += row.amount; break;
    case 'ACCOUNT_WITHDRAW':
    case 'CLOSURE_WITHDRAW': flow.withdrawals += row.amount; break;
    case 'MEMBERSHIP_FEE': flow.feeIncome += row.amount; break;
    case 'LOAN_PAYMENT': flow.repayments += row.amount; flow.interestIncome += row.interest; break;
    case 'LOAN_DISBURSEMENT': flow.disbursed += row.amount; break;
  }
  return flow;
};

const toEvents = (rows: Array<{ kind: string; amount: number; interest: number }>) =>
  rows.map(row => ({ kind: row.kind, amount: row.amount, interest: row.interest }) as LedgerEvent);

const balanceOf = (events: LedgerEvent[], key: string) => balancesOf(events).find(account => account.key === key)?.balance ?? 0;

async function bucketKeys(start: Date, end: Date, grain: Grain) {
  const rows = await sequelize.query<{ bucket: string }>(`
    SELECT to_char(g, 'YYYY-MM-DD') AS bucket
      FROM generate_series(
        date_trunc('${grain}', CAST(:start AS timestamptz) AT TIME ZONE '${TIME_ZONE}'),
        date_trunc('${grain}', CAST(:end AS timestamptz) AT TIME ZONE '${TIME_ZONE}'),
        INTERVAL '1 ${grain}'
      ) AS g
  `, { type: QueryTypes.SELECT, replacements: { start, end } });
  return rows.map(row => row.bucket);
}

async function newMembers(start: Date | null, end: Date, grain?: Grain) {
  const period = grain ? `to_char(date_trunc('${grain}', "joinDate" AT TIME ZONE '${TIME_ZONE}'), 'YYYY-MM-DD')` : 'NULL';
  const rows = await sequelize.query<{ period: string | null; count: string }>(`
    SELECT ${period} AS period, COUNT(*) AS count
      FROM users
     WHERE role = 'USER' AND "joinDate" <= :end ${start ? 'AND "joinDate" >= :start' : ''}
     GROUP BY 1
  `, { type: QueryTypes.SELECT, replacements: { start, end } });
  return rows.map(row => ({ period: row.period, count: Number(row.count) || 0 }));
}

const change = (current: number, previous: number | null) =>
  previous === null ? null : previous === 0 ? (current === 0 ? 0 : null) : (current - previous) / Math.abs(previous);

export async function dashboardStats(rawRange: unknown) {
  const range = String(rawRange || '6M').toUpperCase() as Range;
  if (!RANGES.includes(range)) throw new ServiceError(400, `range must be one of ${RANGES.join(', ')}`);

  const cached = cache.get(range);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const end = endOfToday();
  const first = range === 'ALL' ? await firstActivity() : null;
  const start = range === 'ALL'
    ? (first ?? monthsBack(end, 1))
    : monthsBack(end, MONTHS_BY_RANGE[range]);
  const spanMonths = (end.getTime() - start.getTime()) / (30.44 * 24 * 60 * 60 * 1000);
  const grain: Grain = range === '3M' ? 'week' : range === 'ALL' && spanMonths > 36 ? 'quarter' : 'month';
  // The same length of time just before, for the "vs previous period" figures (none for everything)
  const previousStart = range === 'ALL' ? null : new Date(start.getTime() - (end.getTime() - start.getTime()));

  const [opening, inPeriod, previous, buckets, members, previousMembers, totalMembers, portfolio, pendingApplications] = await Promise.all([
    ledgerEvents({ before: new Date(start.getTime() - 1) }),
    ledgerEvents({ after: start, before: end, grain }),
    previousStart ? ledgerEvents({ after: previousStart, before: new Date(start.getTime() - 1) }) : Promise.resolve(null),
    bucketKeys(start, end, grain),
    newMembers(start, end, grain),
    previousStart ? newMembers(previousStart, new Date(start.getTime() - 1)) : Promise.resolve(null),
    sequelize.query<{ active: string; total: string }>(`
      SELECT COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active, COUNT(*) AS total
        FROM users WHERE role = 'USER' AND is_deleted IS NOT TRUE
    `, { type: QueryTypes.SELECT, plain: true }),
    loanPortfolio({}),
    sequelize.query<{ count: string }>(`SELECT COUNT(*) AS count FROM loans WHERE status = 'PENDING'`, { type: QueryTypes.SELECT, plain: true }),
  ]);

  // Totals for the period and the one before
  const flow = inPeriod.reduce(addToFlow, emptyFlow());
  const previousFlow = previous ? previous.reduce(addToFlow, emptyFlow()) : null;
  const joined = members.reduce((total, row) => total + row.count, 0);
  const previousJoined = previousMembers ? previousMembers.reduce((total, row) => total + row.count, 0) : null;

  // One point per week/month/quarter; balances carry forward from everything before the period
  const openingEvents = toEvents(opening);
  let savings = balanceOf(openingEvents, 'MEMBER_SAVINGS');
  let loanBook = balanceOf(openingEvents, 'LOANS_RECEIVABLE');
  let cash = balanceOf(openingEvents, 'CASH');
  const series = buckets.map(bucket => {
    const rows = inPeriod.filter(row => row.period === bucket);
    const bucketFlow = rows.reduce(addToFlow, emptyFlow());
    const events = toEvents(rows);
    savings += balanceOf(events, 'MEMBER_SAVINGS');
    loanBook += balanceOf(events, 'LOANS_RECEIVABLE');
    cash += balanceOf(events, 'CASH');
    return {
      period: bucket,
      ...bucketFlow,
      netSavings: bucketFlow.deposits - bucketFlow.withdrawals - bucketFlow.feeIncome,
      newMembers: members.find(row => row.period === bucket)?.count ?? 0,
      savingsBalance: savings,
      loanBook,
      cash,
    };
  });

  const kpi = (current: number, before: number | null) => ({ value: current, previous: before, change: change(current, before) });
  const typeMix = [
    { kind: 'SAVINGS_DEPOSIT', label: 'Deposits', amount: flow.deposits },
    { kind: 'ACCOUNT_WITHDRAW', label: 'Withdrawals', amount: flow.withdrawals },
    { kind: 'LOAN_PAYMENT', label: 'Loan repayments', amount: flow.repayments },
    { kind: 'MEMBERSHIP_FEE', label: 'Membership fees', amount: flow.feeIncome },
  ].map(entry => ({
    ...entry,
    count: inPeriod.filter(row => row.kind === entry.kind || (entry.kind === 'ACCOUNT_WITHDRAW' && row.kind === 'CLOSURE_WITHDRAW'))
      .reduce((total, row) => total + row.count, 0),
  }));

  const value = {
    range,
    grain,
    from: start.toISOString(),
    to: end.toISOString(),
    generatedAt: new Date().toISOString(),
    kpis: {
      totalSavings: { value: savings, previous: null, change: null },
      outstandingLoans: { value: portfolio.summary.outstanding, previous: null, change: null },
      cash: { value: cash, previous: null, change: null },
      portfolioAtRisk: { value: portfolio.summary.portfolioAtRisk30, previous: null, change: null },
      deposits: kpi(flow.deposits, previousFlow?.deposits ?? null),
      withdrawals: kpi(flow.withdrawals, previousFlow?.withdrawals ?? null),
      repayments: kpi(flow.repayments, previousFlow?.repayments ?? null),
      disbursed: kpi(flow.disbursed, previousFlow?.disbursed ?? null),
      income: kpi(flow.feeIncome + flow.interestIncome, previousFlow ? previousFlow.feeIncome + previousFlow.interestIncome : null),
      newMembers: kpi(joined, previousJoined),
      transactions: kpi(flow.transactions, previousFlow?.transactions ?? null),
    },
    members: { active: Number(totalMembers?.active) || 0, total: Number(totalMembers?.total) || 0 },
    loans: {
      byStatus: [
        ...portfolio.byStatus.map(entry => ({ status: entry.status, count: entry.count, amount: entry.principal })),
        { status: 'PENDING', count: Number(pendingApplications?.count) || 0, amount: 0 },
      ],
      aging: portfolio.aging.map(bucket => ({ key: bucket.key, label: bucket.label, count: bucket.count, outstanding: bucket.outstanding })),
      arrears: portfolio.summary.arrears,
      loansInArrears: portfolio.summary.loansInArrears,
    },
    typeMix,
    series,
  };
  cache.set(range, { at: Date.now(), value });
  return value;
}
