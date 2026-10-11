// Money in and out of savings: balances, the overdraft rule, membership fee, edits and imports
import { as, balanceOf, makeAccount, makeAdmin, makeUser, models, record, useDatabase, waitForAudit } from './support/helpers.js';

describe('transactions', () => {
  useDatabase();

  const setup = async () => {
    const admin = await makeAdmin();
    const member = await makeUser();
    const account = await makeAccount(admin.actor, member.user.id);
    return { admin, member, account };
  };

  it('adds deposits and takes withdrawals from the balance', async () => {
    const { admin, account } = await setup();
    expect((await record(admin.actor, account.id, 'SAVINGS_DEPOSIT', 100_000)).status).toBe(201);
    expect((await record(admin.actor, account.id, 'ACCOUNT_WITHDRAW', 30_000)).status).toBe(201);
    expect(await balanceOf(account.id)).toBe(70_000);
  });

  it('refuses a withdrawal larger than the balance', async () => {
    const { admin, account } = await setup();
    await record(admin.actor, account.id, 'SAVINGS_DEPOSIT', 10_000);
    const res = await record(admin.actor, account.id, 'ACCOUNT_WITHDRAW', 10_001);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Insufficient balance/);
    expect(await balanceOf(account.id)).toBe(10_000);
  });

  it('takes the membership fee from savings once', async () => {
    const { admin, account } = await setup();
    await record(admin.actor, account.id, 'SAVINGS_DEPOSIT', 50_000);
    expect((await record(admin.actor, account.id, 'MEMBERSHIP_FEE', 20_000)).status).toBe(201);
    expect(await balanceOf(account.id)).toBe(30_000);
    expect((await models.Account.findByPk(account.id))!.paidMembership).toBe(true);
    expect((await record(admin.actor, account.id, 'MEMBERSHIP_FEE', 20_000)).status).toBe(409);
  });

  it('only accepts whole shillings and known accounts', async () => {
    const { admin, account } = await setup();
    expect((await record(admin.actor, account.id, 'SAVINGS_DEPOSIT', 99.5)).status).toBe(400);
    expect((await record(admin.actor, account.id, 'SAVINGS_DEPOSIT', -5)).status).toBe(400);
    expect((await record(admin.actor, '00000000-0000-4000-8000-000000000000', 'SAVINGS_DEPOSIT', 5)).status).toBe(404);
    expect((await record(admin.actor, account.id, 'LOAN_PAYMENT', 5)).body.error).toMatch(/Loan ID is required/);
  });

  it('only lets a CSV import backdate a transaction', async () => {
    const { admin, account } = await setup();
    const backdated = await record(admin.actor, account.id, 'SAVINGS_DEPOSIT', 5_000, { createdAt: '2025-01-15T10:00:00Z' });
    expect(backdated.status).toBe(400);
    const res = await as(admin.actor).post('/api/transactions/bulk', {
      rows: [
        { accountId: account.id, type: 'SAVINGS_DEPOSIT', amount: 5_000, status: 'COMPLETED', createdAt: '2025-01-15T10:00:00Z' },
        { accountId: account.id, type: 'SAVINGS_DEPOSIT', amount: 5_000, status: 'COMPLETED', createdAt: '2999-01-01T00:00:00Z' },
      ],
    });
    expect(res.body.results.map((result: any) => result.ok)).toEqual([true, false]);
    const imported = await models.Transaction.findByPk(res.body.results[0].id);
    expect(imported!.createdAt.toISOString()).toBe('2025-01-15T10:00:00.000Z');
  });

  it('audits a deposit with the member and amount, and the app it came from', async () => {
    const { admin, member, account } = await setup();
    await as(admin.actor, { client: 'mobile' }).post('/api/transactions', { accountId: account.id, type: 'SAVINGS_DEPOSIT', amount: 12_345, status: 'COMPLETED' });
    const row = await waitForAudit('TRANSACTION_CREATE');
    expect(row.source).toBe('MOBILE');
    expect(row.subjectId).toBe(member.user.id);
    expect(row.summary).toContain('12,345');
  });
});
