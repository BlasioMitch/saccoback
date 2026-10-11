// Loans: member applications and their eligibility, manager decisions, repayments, paying from savings
import { as, balanceOf, kampalaToday, makeAccount, makeAdmin, makeManager, makeMemberWithSavings, makeUser, models, record, useDatabase, waitForAudit } from './support/helpers.js';

const summaryOf = async (loanId: string) => {
  const summary = await models.LoanSummary.findOne({ where: { loanId } });
  return { monthlyPayment: Number(summary!.monthlyPayment), totalInterest: Number(summary!.totalInterest), remainingBalance: Number(summary!.remainingBalance) };
};

describe('loans', () => {
  useDatabase();

  const apply = (member: { user: { id: string }; actor: any }, body: Record<string, unknown> = {}) =>
    as(member.actor, { client: 'mobile' }).post('/api/loans/applications', { userId: member.user.id, amount: 1_000_000, term: 12, purpose: 'School fees', ...body });

  describe('applications', () => {
    it('needs an account with the membership fee paid', async () => {
      const admin = await makeAdmin();
      const noAccount = await makeUser();
      expect((await apply(noAccount)).status).toBe(404);

      const unpaid = await makeUser();
      await makeAccount(admin.actor, unpaid.user.id, { balance: 100_000 });
      expect((await apply(unpaid)).body.error).toMatch(/membership fee/);
    });

    it('is created PENDING at the SACCO rate, starting today, with an estimate', async () => {
      const admin = await makeAdmin();
      const member = await makeMemberWithSavings(admin.actor);
      const res = await apply(member);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'PENDING', term: 12, purpose: 'School fees' });
      // DECIMAL column: the REST API answers it as a string ("10.00")
      expect(Number(res.body.interestRate)).toBe(10);
      expect(String(res.body.startDate).slice(0, 10)).toBe(kampalaToday());
      // Flat interest on the principal; monthly payments rounded up so 12 of them cover the total
      expect(await summaryOf(res.body.id)).toEqual({ totalInterest: 100_000, monthlyPayment: 91_667, remainingBalance: 1_100_000 });
      // An application is not yet a loan
      expect((await models.Account.findByPk(member.account.id))!.hasLoan).toBe(false);
    });

    it('allows one waiting application and validates the request', async () => {
      const admin = await makeAdmin();
      const member = await makeMemberWithSavings(admin.actor);
      expect((await apply(member, { term: 0 })).status).toBe(400);
      expect((await apply(member, { amount: 0 })).status).toBe(400);
      expect((await apply(member, { startDate: '2020-01-01' })).body.error).toMatch(/past/);
      expect((await apply(member)).status).toBe(201);
      expect((await apply(member)).body.error).toMatch(/waiting for approval/);
    });
  });

  describe('decisions', () => {
    it('approval activates the loan at the chosen rate and tells the member', async () => {
      const admin = await makeAdmin();
      const manager = await makeManager();
      const member = await makeMemberWithSavings(admin.actor);
      const application = (await apply(member)).body;

      const res = await as(manager.actor).post(`/api/loans/${application.id}/approve`, { interestRate: 12, startDate: '2026-01-31', note: 'Good history' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ACTIVE', decisionNote: 'Good history' });
      expect(Number(res.body.interestRate)).toBe(12);
      expect(res.body.decidedAt).toBeTruthy();
      // 31 January + 12 months = 31 January the next year
      expect(String(res.body.endDate).slice(0, 10)).toBe('2027-01-31');
      expect(await summaryOf(application.id)).toEqual({ totalInterest: 120_000, monthlyPayment: 93_334, remainingBalance: 1_120_000 });
      expect((await models.Account.findByPk(member.account.id))!.hasLoan).toBe(true);
      expect(await models.Notification.count({ where: { userId: member.user.id, category: 'LOAN_DECISION' } })).toBe(1);

      const row = await waitForAudit('LOAN_APPROVE');
      expect(row.actorEmail).toBe(manager.user.email);
      expect(row.subjectId).toBe(member.user.id);

      expect((await as(manager.actor).post(`/api/loans/${application.id}/approve`, {})).body.error).toMatch(/already active/);
    });

    it('rejection needs a reason, and frees the member to apply again', async () => {
      const admin = await makeAdmin();
      const member = await makeMemberWithSavings(admin.actor);
      const application = (await apply(member)).body;
      expect((await as(admin.actor).post(`/api/loans/${application.id}/reject`, { reason: '  ' })).status).toBe(400);
      const res = await as(admin.actor).post(`/api/loans/${application.id}/reject`, { reason: 'Income too low' });
      expect(res.body).toMatchObject({ status: 'REJECTED', decisionNote: 'Income too low' });
      expect((await apply(member)).status).toBe(201);
    });

    it('lists applications by view', async () => {
      const admin = await makeAdmin();
      const approved = await makeMemberWithSavings(admin.actor);
      const rejected = await makeMemberWithSavings(admin.actor);
      const waiting = await makeMemberWithSavings(admin.actor);
      const a = (await apply(approved)).body;
      const r = (await apply(rejected)).body;
      const w = (await apply(waiting)).body;
      await as(admin.actor).post(`/api/loans/${a.id}/approve`, {});
      await as(admin.actor).post(`/api/loans/${r.id}/reject`, { reason: 'No' });
      // A loan staff created directly is not an application
      const direct = await makeMemberWithSavings(admin.actor);
      await as(admin.actor).post('/api/loans', { accountId: direct.account.id, amount: 200_000, interestRate: 10, term: 6, status: 'ACTIVE', startDate: '2026-01-01', endDate: '2026-07-01' });

      const ids = async (view: string) => ((await as(admin.actor).get(`/api/loans/applications?view=${view}`)).body as any[]).map(loan => loan.id).sort();
      expect(await ids('PENDING')).toEqual([w.id]);
      expect(await ids('APPROVED')).toEqual([a.id]);
      expect(await ids('REJECTED')).toEqual([r.id]);
      expect(await ids('ALL')).toEqual([a.id, r.id, w.id].sort());
      expect((await as(admin.actor).get('/api/loans/applications?view=NOPE')).status).toBe(400);
    });
  });

  describe('repayments', () => {
    const activeLoan = async () => {
      const admin = await makeAdmin();
      const member = await makeMemberWithSavings(admin.actor, 300_000);
      const res = await as(admin.actor).post('/api/loans', {
        accountId: member.account.id, amount: 100_000, interestRate: 10, term: 2, status: 'ACTIVE', startDate: '2026-01-01', endDate: '2026-03-01',
      });
      expect(res.status).toBe(201);
      return { admin, member, loan: res.body };
    };

    it('one open loan per account', async () => {
      const { admin, member } = await activeLoan();
      const second = await as(admin.actor).post('/api/loans', {
        accountId: member.account.id, amount: 50_000, interestRate: 10, term: 2, status: 'ACTIVE', startDate: '2026-01-01', endDate: '2026-03-01',
      });
      expect(second.status).toBe(409);
    });

    it('payments reduce what is owed, and clearing it marks the loan PAID', async () => {
      const { admin, member, loan } = await activeLoan();
      expect((await summaryOf(loan.id)).remainingBalance).toBe(110_000);
      await record(admin.actor, member.account.id, 'LOAN_PAYMENT', 60_000, { loanId: loan.id });
      expect((await summaryOf(loan.id)).remainingBalance).toBe(50_000);
      // A pending payment doesn't count until it completes
      await record(admin.actor, member.account.id, 'LOAN_PAYMENT', 50_000, { loanId: loan.id, status: 'PENDING' });
      expect((await summaryOf(loan.id)).remainingBalance).toBe(50_000);
      await record(admin.actor, member.account.id, 'LOAN_PAYMENT', 50_000, { loanId: loan.id });
      expect((await summaryOf(loan.id)).remainingBalance).toBe(0);
      expect((await models.Loan.findByPk(loan.id))!.status).toBe('PAID');
      expect((await models.Account.findByPk(member.account.id))!.hasLoan).toBe(false);
    });

    it('paying from savings moves the money in one step, within the savings and the amount owed', async () => {
      const { admin, member, loan } = await activeLoan();
      const pay = (amount: number) => as(admin.actor).post(`/api/loans/${loan.id}/pay-from-savings`, { amount });
      expect((await pay(400_000)).body.error).toMatch(/Insufficient savings/);
      expect((await pay(200_000)).body.error).toMatch(/still owed/);
      const before = await balanceOf(member.account.id);
      const res = await pay(40_000);
      expect(res.status).toBe(201);
      expect(res.body.withdrawal).toMatchObject({ type: 'ACCOUNT_WITHDRAW', amount: 40_000, status: 'COMPLETED' });
      expect(res.body.payment).toMatchObject({ type: 'LOAN_PAYMENT', amount: 40_000, loanId: loan.id });
      expect(await balanceOf(member.account.id)).toBe(before - 40_000);
      expect((await summaryOf(loan.id)).remainingBalance).toBe(70_000);
    });
  });
});
