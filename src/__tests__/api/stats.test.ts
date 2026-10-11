// Dashboard figures: totals now, and money moved in the chosen period
import { as, makeAdmin, makeMemberWithSavings, record, useDatabase } from './support/helpers.js';

describe('dashboard stats', () => {
  useDatabase();

  it('adds up savings, deposits, withdrawals and new members for each range', async () => {
    const admin = await makeAdmin();
    const member = await makeMemberWithSavings(admin.actor, 200_000);
    await record(admin.actor, member.account.id, 'ACCOUNT_WITHDRAW', 30_000);

    for (const range of ['3M', '6M', '1Y', 'ALL']) {
      const res = await as(admin.actor).get(`/api/stats/dashboard?range=${range}`);
      expect(res.status).toBe(200);
      expect(res.body.range).toBe(range);
      expect(res.body.kpis.totalSavings.value).toBe(170_000);
      expect(res.body.kpis.deposits.value).toBe(220_000);
      expect(res.body.kpis.withdrawals.value).toBe(30_000);
      expect(res.body.kpis.income.value).toBe(20_000);
      expect(res.body.kpis.newMembers.value).toBeGreaterThanOrEqual(1);
    }
  });

  it('refuses an unknown range', async () => {
    const admin = await makeAdmin();
    expect((await as(admin.actor).get('/api/stats/dashboard?range=10Y')).status).toBe(400);
  });
});
