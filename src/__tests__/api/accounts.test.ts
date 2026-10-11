// Savings accounts: one per member, opening deposit and membership fee recorded as transactions
import { as, balanceOf, makeAccount, makeAdmin, makeUser, models, useDatabase } from './support/helpers.js';

describe('accounts', () => {
  useDatabase();

  it('opens an account with a generated number and marks the member', async () => {
    const admin = await makeAdmin();
    const { user } = await makeUser({ first_name: 'Jane', last_name: 'Smith' });
    const account = await makeAccount(admin.actor, user.id);
    expect(account.accountNumber).toMatch(/^JS/);
    expect((await models.User.findByPk(user.id))!.hasAccount).toBe(true);
  });

  it('records an opening balance as a deposit', async () => {
    const admin = await makeAdmin();
    const { user } = await makeUser();
    const account = await makeAccount(admin.actor, user.id, { balance: 50_000 });
    expect(await balanceOf(account.id)).toBe(50_000);
    const transactions = await models.Transaction.findAll({ where: { accountId: account.id } });
    expect(transactions.map(transaction => [transaction.type, Number(transaction.amount)])).toEqual([['SAVINGS_DEPOSIT', 50_000]]);
  });

  it('allows only one account per member', async () => {
    const admin = await makeAdmin();
    const { user } = await makeUser();
    await makeAccount(admin.actor, user.id);
    expect((await as(admin.actor).post('/api/accounts', { userId: user.id, status: 'ACTIVE' })).status).toBe(409);
  });

  it('rejects fractions of a shilling and unknown members', async () => {
    const admin = await makeAdmin();
    const { user } = await makeUser();
    expect((await as(admin.actor).post('/api/accounts', { userId: user.id, status: 'ACTIVE', balance: 10.5 })).status).toBe(400);
    expect((await as(admin.actor).post('/api/accounts', { userId: '00000000-0000-4000-8000-000000000000', status: 'ACTIVE' })).status).toBe(404);
  });

  it('lists accounts by member', async () => {
    const admin = await makeAdmin();
    const { user } = await makeUser();
    const account = await makeAccount(admin.actor, user.id);
    await makeAccount(admin.actor, (await makeUser()).user.id);
    const res = await as(admin.actor).get(`/api/accounts?userId=${user.id}`);
    expect(res.status).toBe(200);
    expect([res.body].flat().map((item: any) => item.id)).toEqual([account.id]);
  });
});
