// Member emails: who gets what, with which document attached (the outbox keeps them instead of sending)
import { as, kampalaToday, makeAccount, makeAdmin, makeMemberWithSavings, makeUser, models, record, testOutbox, useDatabase, waitFor } from './support/helpers.js';

const mailFor = (email: string, template: string) =>
  waitFor(async () => testOutbox.find(mail => mail.to === email && mail.template === template));
const isPdf = (content: Buffer) => content.subarray(0, 5).toString() === '%PDF-';
const settle = () => new Promise(resolve => setTimeout(resolve, 300));

describe('member emails', () => {
  useDatabase();

  it('welcomes a new member at their own address', async () => {
    const admin = await makeAdmin();
    const res = await as(admin.actor).post('/api/users', {
      first_name: 'Grace', last_name: 'Namatovu', email: 'grace@test.sacco', password: 'grace2026', role: 'USER', status: 'ACTIVE', contact: '0772123456', dob: '1992-05-01', gender: 'FEMALE',
    });
    expect(res.status).toBe(201);
    const mail = await mailFor('grace@test.sacco', 'welcome');
    expect(mail.subject).toBe('Welcome to Green Sprout SACCO');
    expect(mail.html).toContain('Grace Namatovu');
    expect(mail.html).toContain('cid:gs-logo');
  });

  it('confirms an opened account with the confirmation PDF', async () => {
    const admin = await makeAdmin();
    const { user } = await makeUser();
    const account = await makeAccount(admin.actor, user.id, { balance: 25_000 });
    const mail = await mailFor(user.email, 'account-creation');
    expect(mail.subject).toContain(account.accountNumber);
    expect(mail.html).toContain('UGX 25,000');
    expect(mail.attachments).toEqual([expect.objectContaining({ filename: `Account-confirmation-${account.accountNumber}.pdf`, contentType: 'application/pdf' })]);
    expect(isPdf(mail.attachments[0].content)).toBe(true);
  });

  it('sends a receipt for each live transaction, with the balance after it', async () => {
    const admin = await makeAdmin();
    const { user } = await makeUser();
    const account = await makeAccount(admin.actor, user.id);
    await record(admin.actor, account.id, 'SAVINGS_DEPOSIT', 150_000);
    const mail = await mailFor(user.email, 'transaction');
    expect(mail.subject).toMatch(/^Savings deposit of UGX 150,000 · receipt TX-[0-9A-F]{8}$/);
    expect(mail.html).toContain('UGX 150,000');
    expect(mail.context.details).toEqual(expect.arrayContaining([{ label: 'Savings balance', value: 'UGX 150,000' }]));
    expect(mail.attachments[0].filename).toMatch(/^Receipt-TX-[0-9A-F]{8}\.pdf$/);
    expect(isPdf(mail.attachments[0].content)).toBe(true);
  });

  it('sends no emails for a CSV import', async () => {
    const admin = await makeAdmin();
    const { user } = await makeUser();
    const account = await makeAccount(admin.actor, user.id);
    await settle();
    const before = testOutbox.length;
    await as(admin.actor).post('/api/transactions/bulk', { rows: [{ accountId: account.id, type: 'SAVINGS_DEPOSIT', amount: 5_000, status: 'COMPLETED', createdAt: '2025-01-15T10:00:00Z' }] });
    await settle();
    expect(testOutbox.length).toBe(before);
  });

  it('sends the loan statement when an application is approved', async () => {
    const admin = await makeAdmin();
    const member = await makeMemberWithSavings(admin.actor);
    const application = (await as(member.actor).post('/api/loans/applications', { userId: member.user.id, amount: 600_000, term: 6, startDate: kampalaToday() })).body;
    await as(admin.actor).post(`/api/loans/${application.id}/approve`, { interestRate: 10, note: 'Welcome aboard' });
    const mail = await mailFor(member.user.email, 'loan-approved');
    expect(mail.subject).toBe('Your loan of UGX 600,000 is approved');
    expect(mail.html).toContain('Welcome aboard');
    expect(mail.context.details).toEqual(expect.arrayContaining([{ label: 'Monthly payment', value: 'UGX 110,000' }, { label: 'Total to repay', value: 'UGX 660,000' }]));
    expect(mail.attachments[0].filename).toMatch(/^Loan-statement-LN-[0-9A-F]{8}\.pdf$/);
    expect(isPdf(mail.attachments[0].content)).toBe(true);
  });

  it('sends the cleared certificate once, when repayments clear the loan', async () => {
    const admin = await makeAdmin();
    const member = await makeMemberWithSavings(admin.actor, 300_000);
    const loan = (await as(admin.actor).post('/api/loans', {
      accountId: member.account.id, amount: 100_000, interestRate: 10, term: 2, status: 'ACTIVE', startDate: '2026-01-01', endDate: '2026-03-01',
    })).body;
    await mailFor(member.user.email, 'loan-approved');
    await record(admin.actor, member.account.id, 'LOAN_PAYMENT', 60_000, { loanId: loan.id });
    await settle();
    expect(testOutbox.filter(mail => mail.template === 'loan-cleared')).toHaveLength(0);

    // The rest from savings: a receipt for the repayment, and the certificate
    await as(admin.actor).post(`/api/loans/${loan.id}/pay-from-savings`, { amount: 50_000 });
    const certificate = await mailFor(member.user.email, 'loan-cleared');
    expect(certificate.html).toContain('UGX 110,000');
    expect(certificate.attachments[0].filename).toMatch(/^Loan-cleared-LN-[0-9A-F]{8}\.pdf$/);
    await settle();
    expect(testOutbox.filter(mail => mail.template === 'loan-cleared')).toHaveLength(1);
    expect(testOutbox.filter(mail => mail.template === 'transaction' && mail.subject.startsWith('Loan repayment'))).toHaveLength(2);
    expect((await models.Loan.findByPk(loan.id))!.status).toBe('PAID');
  });

  it('sends everything to EMAIL_REDIRECT_TO when it is set (development)', async () => {
    process.env.EMAIL_REDIRECT_TO = 'developer@test.sacco';
    try {
      const admin = await makeAdmin();
      const { user } = await makeUser();
      await makeAccount(admin.actor, user.id);
      const mail = await mailFor('developer@test.sacco', 'account-creation');
      expect(mail.html).toContain(user.first_name);
      expect(testOutbox.some(entry => entry.to === user.email)).toBe(false);
    } finally {
      process.env.EMAIL_REDIRECT_TO = '';
    }
  });
});
