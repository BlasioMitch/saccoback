// The audit trail as staff see it: filters, ordering by when things happened, offline phone events
import { as, makeAdmin, makeMemberWithSavings, makeUser, models, record, useDatabase, waitForAudit } from './support/helpers.js';

describe('audit trail', () => {
  useDatabase();

  it('filters by member affected, action, source and search text', async () => {
    const admin = await makeAdmin();
    const jane = await makeMemberWithSavings(admin.actor, 10_000);
    const john = await makeMemberWithSavings(admin.actor, 10_000);
    await as(admin.actor, { client: 'mobile' }).post('/api/transactions', { accountId: john.account.id, type: 'SAVINGS_DEPOSIT', amount: 777, status: 'COMPLETED' });
    await waitForAudit('TRANSACTION_CREATE', { source: 'MOBILE' });

    const list = async (query: string) => (await as(admin.actor).get(`/api/audit-logs?${query}`)).body;
    const janes = await list(`subjectId=${jane.user.id}`);
    expect(janes.total).toBeGreaterThan(0);
    expect(janes.items.every((row: any) => row.subjectId === jane.user.id)).toBe(true);
    expect((await list('source=MOBILE')).items.map((row: any) => row.action)).toEqual(['TRANSACTION_CREATE']);
    expect((await list('q=777')).total).toBe(1);
    expect((await list('action=ACCOUNT_CREATE')).total).toBe(2);
    const page = await list('limit=2&offset=0');
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThan(2);
  });

  it('never stores secrets or images', async () => {
    const admin = await makeAdmin();
    const { user, actor } = await makeUser();
    await as(actor).patch(`/api/users/${user.id}`, { first_name: 'Renamed', avatar: 'data:image/jpeg;base64,AAAA' });
    const row = await waitForAudit('USER_UPDATE');
    expect(row.changes).toMatchObject({ first_name: 'Renamed', avatar: '[image]' });
    await as(admin.actor).post('/api/users', {
      first_name: 'Pat', last_name: 'Okello', email: 'pat@test.sacco', password: 'secret2026', role: 'USER', status: 'ACTIVE', contact: '0700000000', dob: '1990-01-01', gender: 'MALE',
    });
    expect((await waitForAudit('USER_CREATE')).changes).toMatchObject({ password: '[redacted]' });
  });

  it('records offline phone events once, under the member they were about, at the time they happened', async () => {
    const reporter = await makeUser();
    const other = await makeUser();
    const at = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const events = [
      { id: 'aaaaaaaa-1111-4111-8111-000000000001', action: 'OFFLINE_LOGIN_FAILED', email: other.user.email, method: 'password', reason: 'Wrong password', at, deviceName: 'Phone' },
      { id: 'aaaaaaaa-1111-4111-8111-000000000002', action: 'LOGOUT', userId: reporter.user.id, at, deviceName: 'Phone' },
      { id: 'aaaaaaaa-1111-4111-8111-000000000003', action: 'USER_DELETE', email: other.user.email, at },
    ];
    const send = () => as(reporter.actor, { client: 'mobile' }).post('/api/audit/device-events', { events });
    expect((await send()).body.recorded).toBe(2);
    expect((await send()).body.recorded).toBe(0);

    const failed = await models.AuditLog.findOne({ where: { action: 'OFFLINE_LOGIN_FAILED' } });
    expect(failed).toMatchObject({ actorEmail: other.user.email, subjectId: other.user.id, source: 'MOBILE', statusCode: 401 });
    expect(failed!.clientCreatedAt!.toISOString()).toBe(at);
    expect(failed!.changes).toMatchObject({ reportedBy: reporter.user.email, method: 'password' });
    expect(await models.AuditLog.count({ where: { action: 'USER_DELETE' } })).toBe(0);
  });

  it('lists a change made offline at the time it was made, not when it synced', async () => {
    const admin = await makeAdmin();
    const member = await makeMemberWithSavings(admin.actor, 10_000);
    const madeAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await record(admin.actor, member.account.id, 'SAVINGS_DEPOSIT', 1_000);
    await as(admin.actor, { headers: { 'x-queued-at': madeAt } }).post('/api/transactions', { accountId: member.account.id, type: 'SAVINGS_DEPOSIT', amount: 2_000, status: 'COMPLETED' });
    const offline = await waitForAudit('TRANSACTION_CREATE', { clientCreatedAt: new Date(madeAt) });

    const items = (await as(admin.actor).get('/api/audit-logs?action=TRANSACTION_CREATE&limit=200')).body.items;
    // Synced last, but made an hour ago: it sorts after everything recorded since then
    expect(items[items.length - 1].id).toBe(offline.id);
  });
});
