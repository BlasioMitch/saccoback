// Bookkeeping reports built from the SACCO's own records: they must balance and match what happened
import { as, kampalaToday, makeAdmin, makeMemberWithSavings, record, useDatabase } from './support/helpers.js';

describe('reports', () => {
  useDatabase();

  // Two members save and pay the fee; one borrows 100,000 at 10% and repays 55,000 (half of what is owed)
  const fixture = async () => {
    const admin = await makeAdmin();
    const first = await makeMemberWithSavings(admin.actor, 300_000);
    const second = await makeMemberWithSavings(admin.actor, 150_000);
    const loan = (await as(admin.actor).post('/api/loans', {
      accountId: first.account.id, amount: 100_000, interestRate: 10, term: 2, status: 'ACTIVE', startDate: kampalaToday(), endDate: '2099-01-01',
    })).body;
    await record(admin.actor, first.account.id, 'LOAN_PAYMENT', 55_000, { loanId: loan.id });
    await record(admin.actor, second.account.id, 'ACCOUNT_WITHDRAW', 50_000);
    return { admin, first, second, loan };
  };

  const report = (admin: any, type: string, query = '') => as(admin.actor).get(`/api/reports/${type}${query}`);

  it('trial balance: debits equal credits', async () => {
    const { admin } = await fixture();
    const res = await report(admin, 'trial-balance');
    expect(res.status).toBe(200);
    expect(res.body.balanced).toBe(true);
    expect(res.body.totals.debit).toBe(res.body.totals.credit);
    expect(res.body.totals.debit).toBeGreaterThan(0);
  });

  it('balance sheet: assets equal liabilities plus equity, and savings match the account balances', async () => {
    const { admin } = await fixture();
    const res = await report(admin, 'balance-sheet');
    expect(res.body.balanced).toBe(true);
    expect(res.body.totals.assets).toBe(res.body.totals.liabilities + res.body.totals.equity);
    // Members' savings: (320,000 − 20,000) + (170,000 − 20,000 − 50,000) = 400,000
    expect(res.body.savingsCheck).toEqual({ ledger: 400_000, accounts: 400_000, difference: 0 });
    const loans = res.body.assets.find((line: any) => line.code === '1100');
    // 55,000 repaid of 110,000 owed: half is principal (50,000), so 50,000 of the 100,000 is still lent out
    expect(loans.amount).toBe(50_000);
  });

  it('income statement: membership fees and the interest part of repayments', async () => {
    const { admin } = await fixture();
    const res = await report(admin, 'income-statement', `?from=2020-01-01&to=${kampalaToday()}`);
    const amount = (code: string) => res.body.income.find((line: any) => line.code === code).amount;
    expect(amount('4000')).toBe(40_000);
    expect(amount('4100')).toBe(5_000);
    expect(res.body.totals).toEqual({ income: 45_000, expenses: 0, surplus: 45_000 });
  });

  it('cash book: the closing balance follows the money in and out', async () => {
    const { admin } = await fixture();
    const res = await report(admin, 'cash-book', `?from=2020-01-01&to=${kampalaToday()}`);
    expect(res.body.closing).toBe(res.body.opening + res.body.totalIn - res.body.totalOut);
    // Deposits 320,000 + 170,000 + repayment 55,000 in; loan 100,000 + withdrawal 50,000 out (fees move no cash)
    expect(res.body.totalIn).toBe(545_000);
    expect(res.body.totalOut).toBe(150_000);
  });

  it('loan portfolio: what was lent, repaid and is still owed', async () => {
    const { admin } = await fixture();
    const res = await report(admin, 'loan-portfolio');
    expect(res.body.summary).toMatchObject({ loans: 1, openLoans: 1, disbursed: 100_000, repaid: 55_000, outstanding: 55_000 });
  });

  it('rejects bad dates and unknown reports, and prints a PDF', async () => {
    const { admin } = await fixture();
    expect((await report(admin, 'cash-book', '?from=yesterday')).status).toBe(400);
    expect((await report(admin, 'cash-book', '?from=2026-05-01&to=2026-04-01')).status).toBe(400);
    expect((await report(admin, 'profit-forecast')).status).toBe(404);
    const pdf = await report(admin, 'trial-balance.pdf');
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(/trial-balance_\d{4}-\d{2}-\d{2}\.pdf/);
  });
});
