// Fills a *_demo database with about two years of SACCO history (members, savings, fees, loans,
// repayments, a few in arrears or defaulted) so the dashboard and reports have something to show.
//
//   DATABASE_URL=postgresql://user:pass@localhost:5432/finapp_demo npm run db:demo            (once)
//   DATABASE_URL=postgresql://user:pass@localhost:5432/finapp_demo npm run db:demo -- --reset (start over)
//
// Refuses to run against any database whose name does not end in "_demo", so live data is never touched.
// Seeded with a fixed number, so every run produces the same history. Members sign in with "member123".
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { QueryTypes, Sequelize } from 'sequelize';
import { syncDatabase, models, sequelize } from '../models/index.js';
import { seedDatabase } from '../seed.js';
import { Gender, UserRole, UserStatus } from '../models/user.js';
import { AccountStatus } from '../models/account.js';
import { TransactionStatus, TransactionType } from '../models/transaction.js';
import { LoanStatus } from '../models/loan.js';
import { calculateMonthlyPayment, calculateTotalInterest } from '../lib/utils.js';

const MEMBERS = 40;
const MONTHS = 24;
const MEMBERSHIP_FEE = 20_000;
const DAY = 24 * 60 * 60 * 1000;

const databaseUrl = process.env.DATABASE_URL || '';
const databaseName = new URL(databaseUrl.replace(/^postgres(ql)?:/, 'http:')).pathname.replace(/^\//, '');
if (!databaseName.endsWith('_demo')) {
  console.error(`Refusing to write demo data to "${databaseName}": use a database whose name ends in _demo.`);
  process.exit(1);
}
const reset = process.argv.includes('--reset');

// Deterministic random numbers (mulberry32)
let seed = 20261010;
const random = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
const roundTo = (value: number, step: number) => Math.max(step, Math.round(value / step) * step);
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];
const chance = (probability: number) => random() < probability;

const addMonths = (date: Date, months: number) => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};
const atHour = (date: Date, hour: number) => {
  const result = new Date(date);
  result.setUTCHours(hour - 3, between(0, 59), 0, 0); // hour in Kampala (UTC+3)
  return result;
};

const FIRST_NAMES = ['Aisha', 'Brian', 'Grace', 'Isaac', 'Joan', 'Moses', 'Ruth', 'Samuel', 'Faith', 'Peter', 'Esther', 'David', 'Mercy', 'Joseph', 'Sarah', 'Daniel', 'Agnes', 'Paul', 'Lydia', 'Ronald'];
const LAST_NAMES = ['Nakato', 'Okello', 'Namubiru', 'Mugisha', 'Achieng', 'Ssebunya', 'Atim', 'Kato', 'Nansubuga', 'Ouma', 'Nabirye', 'Tumusiime', 'Akello', 'Wasswa', 'Namatovu'];
const PURPOSES = ['School fees', 'Shop stock', 'Farm inputs', 'Boda boda', 'Building materials', 'Medical bills', 'Poultry project'];

async function ensureDatabase() {
  const admin = new Sequelize(databaseUrl.replace(/\/[^/?]+(\?|$)/, '/postgres$1'), { logging: false });
  const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = :name', { replacements: { name: databaseName }, type: QueryTypes.SELECT });
  if (!found.length) {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    console.log(`Created database ${databaseName}`);
  }
  await admin.close();
}

async function main() {
  await ensureDatabase();
  await syncDatabase();
  await seedDatabase();

  const existing = await models.Transaction.count();
  if (existing > 20 && !reset) {
    console.log(`${databaseName} already has ${existing} transactions. Run with --reset to start over.`);
    return;
  }
  if (reset) {
    await sequelize.query(`TRUNCATE transactions, loan_summaries, loans, accounts, notifications, password_reset_requests, trusted_devices, passkey_credentials, idempotency_keys, audit_logs CASCADE`);
    await sequelize.query(`DELETE FROM users WHERE email NOT IN ('admin@example.com', 'user@example.com')`);
    console.log('Cleared previous demo data');
  }

  const now = new Date();
  const start = addMonths(now, -MONTHS);
  const password = await bcrypt.hash('member123', 10);

  const users: any[] = [];
  const accounts: any[] = [];
  const transactions: any[] = [];
  const loans: any[] = [];
  const summaries: any[] = [];

  // A manager to approve loans, plus the members
  users.push({
    first_name: 'Mary', last_name: 'Manager', email: 'manager@example.com', password: await bcrypt.hash('manager123', 10),
    role: UserRole.MANAGER, status: UserStatus.ACTIVE, contact: '0700000001', gender: Gender.FEMALE, dob: new Date('1988-03-14'),
    joinDate: start, createdAt: start,
  });

  for (let index = 0; index < MEMBERS; index += 1) {
    const first = FIRST_NAMES[index % FIRST_NAMES.length];
    const last = LAST_NAMES[(index * 7) % LAST_NAMES.length];
    // Most joined in the first 18 months; a few recently
    const joined = atHour(new Date(start.getTime() + (index < 34 ? between(0, 540) : between(560, 700)) * DAY), between(8, 16));
    if (joined > now) continue;
    const user = {
      first_name: first, last_name: last, email: `${first}.${last}${index}@demo.sacco`.toLowerCase(), password,
      role: UserRole.USER, status: index % 17 === 16 ? UserStatus.INACTIVE : UserStatus.ACTIVE,
      contact: `07${String(between(10000000, 99999999))}`, gender: index % 2 ? Gender.MALE : Gender.FEMALE,
      dob: new Date(Date.UTC(between(1965, 2002), between(0, 11), between(1, 28))),
      joinDate: joined, hasAccount: true, createdAt: joined, lastLogin: chance(0.7) ? atHour(new Date(now.getTime() - between(0, 30) * DAY), 10) : null,
    };
    users.push(user);
  }

  const createdUsers = await models.User.bulkCreate(users as any, { returning: true });
  const members = createdUsers.filter(user => user.role === UserRole.USER && user.email.endsWith('@demo.sacco'));
  console.log(`Created ${members.length} members`);

  for (const user of members) {
    const joined = new Date(user.joinDate);
    const accountNumber = `${user.first_name[0]}${user.last_name[0]}-${between(1000000, 9999999)}`;
    const account = { userId: user.id, accountNumber, balance: 0, status: AccountStatus.ACTIVE, paidMembership: true, hasLoan: false, createdAt: joined };
    accounts.push(account);
  }
  const createdAccounts = await models.Account.bulkCreate(accounts as any, { returning: true });

  for (const account of createdAccounts) {
    const user = members.find(member => member.id === account.userId)!;
    const joined = new Date(user.joinDate);
    const saverSize = pick([30_000, 60_000, 120_000, 250_000]);
    let balance = 0;
    const tx = (type: TransactionType, amount: number, at: Date, status = TransactionStatus.COMPLETED, loanId?: string) => {
      transactions.push({ accountId: account.id, accountName: account.accountNumber, type, amount, status, loanId, createdAt: at, updatedAt: at });
      if (status !== TransactionStatus.COMPLETED) return;
      if (type === TransactionType.SAVINGS_DEPOSIT) balance += amount;
      if (type === TransactionType.ACCOUNT_WITHDRAW || type === TransactionType.CLOSURE_WITHDRAW || type === TransactionType.MEMBERSHIP_FEE) balance -= amount;
    };

    // Opening deposit, then the membership fee taken from it
    tx(TransactionType.SAVINGS_DEPOSIT, roundTo(saverSize * (1 + random()), 1000) + MEMBERSHIP_FEE, joined);
    tx(TransactionType.MEMBERSHIP_FEE, MEMBERSHIP_FEE, new Date(joined.getTime() + 60 * 60 * 1000));

    // Monthly savings, the odd withdrawal, and a few pending or failed entries
    for (let month = 1; ; month += 1) {
      const day = atHour(addMonths(joined, month), between(8, 17));
      day.setDate(Math.min(28, day.getDate() + between(-5, 5)));
      if (day > now) break;
      if (chance(0.82)) tx(TransactionType.SAVINGS_DEPOSIT, roundTo(saverSize * (0.5 + random() * 1.2), 1000), day);
      const withdrawnAt = new Date(day.getTime() + between(2, 9) * DAY);
      if (chance(0.12) && balance > 100_000 && withdrawnAt <= now) {
        tx(TransactionType.ACCOUNT_WITHDRAW, roundTo(balance * (0.1 + random() * 0.3), 1000), withdrawnAt);
      }
      const retriedAt = new Date(day.getTime() + DAY);
      if (chance(0.03) && retriedAt <= now) tx(TransactionType.SAVINGS_DEPOSIT, roundTo(saverSize, 1000), retriedAt, pick([TransactionStatus.PENDING, TransactionStatus.FAILED]));
    }

    // About half the members borrow: on-time payers, late payers, and a few who stopped paying
    if (chance(0.55)) {
      const loanStart = atHour(addMonths(joined, between(3, 8)), 11);
      if (loanStart < addMonths(now, -1)) {
        const amount = roundTo(between(300_000, 3_000_000), 50_000);
        const interestRate = pick([10, 12, 15]);
        const term = pick([6, 12, 12, 18, 24]);
        const behaviour = pick(['good', 'good', 'good', 'late', 'late', 'stopped']);
        const totalInterest = calculateTotalInterest(amount, interestRate, term);
        const monthlyPayment = calculateMonthlyPayment(amount, interestRate, term);
        const owed = amount + totalInterest;
        const loan: any = {
          accountId: account.id, amount, interestRate, term, startDate: loanStart, endDate: addMonths(loanStart, term),
          purpose: pick(PURPOSES), decidedAt: new Date(loanStart.getTime() - 2 * DAY), createdAt: new Date(loanStart.getTime() - 5 * DAY),
          status: LoanStatus.ACTIVE,
        };
        loans.push(loan);
        let paid = 0;
        let lastPayment = loanStart;
        const payments: Array<{ amount: number; at: Date }> = [];
        for (let instalment = 1; instalment <= term + 3 && paid < owed; instalment += 1) {
          const due = addMonths(loanStart, instalment);
          const at = new Date(due.getTime() + between(-3, behaviour === 'late' ? 25 : 6) * DAY);
          if (at > now) break;
          if (behaviour === 'stopped' && instalment > Math.max(2, Math.floor(term / 3))) break;
          if (behaviour === 'late' && chance(0.25)) continue;
          const amountDue = Math.min(owed - paid, monthlyPayment);
          payments.push({ amount: amountDue, at });
          paid += amountDue;
          lastPayment = at;
        }
        loan.payments = payments;
        loan.paid = paid;
        loan.monthlyPayment = monthlyPayment;
        loan.totalInterest = totalInterest;
        if (paid >= owed) loan.status = LoanStatus.PAID;
        else if (behaviour === 'stopped' && now.getTime() - lastPayment.getTime() > 120 * DAY) loan.status = LoanStatus.DEFAULTED;
      }
    }

    // A few recent applications still waiting, and one turned down
    if (chance(0.08)) {
      loans.push({
        accountId: account.id, amount: roundTo(between(200_000, 1_500_000), 50_000), interestRate: 10, term: 12,
        startDate: atHour(new Date(now.getTime() + 7 * DAY), 9), endDate: addMonths(new Date(now.getTime() + 7 * DAY), 12),
        purpose: pick(PURPOSES), status: chance(0.7) ? LoanStatus.PENDING : LoanStatus.REJECTED,
        decisionNote: null, createdAt: new Date(now.getTime() - between(1, 10) * DAY), payments: [],
      });
    }

    account.balance = balance;
  }

  const createdLoans = await models.Loan.bulkCreate(loans.map(({ payments, paid, monthlyPayment, totalInterest, ...loan }) => loan) as any, { returning: true });
  createdLoans.forEach((loan, index) => {
    const source = loans[index];
    for (const payment of source.payments) {
      const account = createdAccounts.find(item => item.id === loan.accountId)!;
      transactions.push({
        accountId: loan.accountId, accountName: account.accountNumber, type: TransactionType.LOAN_PAYMENT, amount: payment.amount,
        status: TransactionStatus.COMPLETED, loanId: loan.id, createdAt: payment.at, updatedAt: payment.at,
      });
    }
    const totalInterest = calculateTotalInterest(Number(loan.amount), Number(loan.interestRate), Number(loan.term));
    summaries.push({
      loanId: loan.id,
      monthlyPayment: calculateMonthlyPayment(Number(loan.amount), Number(loan.interestRate), Number(loan.term)),
      totalInterest,
      remainingBalance: Math.max(0, Number(loan.amount) + totalInterest - (source.paid ?? 0)),
    });
  });

  await models.Transaction.bulkCreate(transactions, { validate: false });
  await models.LoanSummary.bulkCreate(summaries);
  for (const account of createdAccounts) {
    const hasLoan = createdLoans.some(loan => loan.accountId === account.id && [LoanStatus.ACTIVE, LoanStatus.DEFAULTED].includes(loan.status));
    await account.update({ balance: account.balance, hasLoan });
  }

  console.log(`Created ${createdAccounts.length} accounts, ${createdLoans.length} loans and ${transactions.length} transactions in ${databaseName}`);
  console.log('Sign in as admin@example.com / admin123, manager@example.com / manager123, or any member with member123');
}

main()
  .then(() => sequelize.close())
  .catch(async (error) => {
    console.error('Demo data failed:', error);
    await sequelize.close();
    process.exit(1);
  });
