// Members and staff: creating, editing, deleting, own password and email, notifications, CSV import
import { as, makeAdmin, makeUser, models, PASSWORD, record, makeAccount, useDatabase, waitForAudit } from './support/helpers.js';

const newMember = (overrides: Record<string, unknown> = {}) => ({
  first_name: 'Grace', last_name: 'Namatovu', email: `grace.${Date.now()}@test.sacco`, password: 'grace2026',
  role: 'USER', status: 'ACTIVE', contact: '0772123456', dob: '1992-05-01', gender: 'FEMALE', ...overrides,
});

describe('users', () => {
  useDatabase();

  it('creates a member, never returning the password hash, and audits it by name', async () => {
    const admin = await makeAdmin();
    const res = await as(admin.actor).post('/api/users', newMember());
    expect(res.status).toBe(201);
    expect(res.body.password).toBeUndefined();
    expect(res.body).toMatchObject({ first_name: 'Grace', role: 'USER' });
    const row = await waitForAudit('USER_CREATE');
    expect(row.actorEmail).toBe(admin.user.email);
    expect(row.summary).toContain('Grace Namatovu');
    expect(JSON.stringify(row.changes)).not.toContain('grace2026');
  });

  it('requires every field and a unique email (any letter case)', async () => {
    const admin = await makeAdmin();
    expect((await as(admin.actor).post('/api/users', newMember({ contact: '' }))).status).toBe(400);
    const first = newMember();
    expect((await as(admin.actor).post('/api/users', first)).status).toBe(201);
    expect((await as(admin.actor).post('/api/users', { ...first, email: first.email.toUpperCase() })).status).toBe(409);
  });

  it('only accepts true/false for the security and notification switches', async () => {
    const { user, actor } = await makeUser();
    expect((await as(actor).patch(`/api/users/${user.id}`, { notifyTransactions: 'no' })).status).toBe(400);
    const ok = await as(actor).patch(`/api/users/${user.id}`, { notifyTransactions: false, first_name: 'Renamed' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ notifyTransactions: false, first_name: 'Renamed' });
  });

  it('never lets an edit change the password', async () => {
    const { user, actor } = await makeUser();
    await as(actor).patch(`/api/users/${user.id}`, { password: 'hijacked123' });
    expect((await as().post('/api/auth/login', { email: user.email, password: PASSWORD })).status).toBe(200);
  });

  it('soft-deletes a member and closes their account', async () => {
    const admin = await makeAdmin();
    const { user } = await makeUser();
    const account = await makeAccount(admin.actor, user.id);
    expect((await as(admin.actor).delete(`/api/users/${user.id}`)).status).toBe(200);
    expect((await as(admin.actor).get(`/api/users/${user.id}`)).status).toBe(404);
    expect(await models.Account.findByPk(account.id)).toMatchObject({ is_deleted: true, status: 'CLOSED' });
    expect(await models.User.findByPk(user.id)).not.toBeNull();
  });

  describe('own password and email', () => {
    it('checks the current password and the password rules', async () => {
      const { user, actor } = await makeUser();
      const change = (body: object) => as(actor).post(`/api/users/${user.id}/password`, body);
      expect((await change({ currentPassword: 'wrong-one1', newPassword: 'newPass2026' })).body.error).toMatch(/current password/);
      expect((await change({ currentPassword: PASSWORD, newPassword: 'short1' })).body.error).toMatch(/at least 8/);
      expect((await change({ currentPassword: PASSWORD, newPassword: 'lettersonly' })).body.error).toMatch(/letters and numbers/);
      expect((await change({ currentPassword: PASSWORD, newPassword: PASSWORD })).status).toBe(400);
      expect((await change({ currentPassword: PASSWORD, newPassword: 'newPass2026' })).status).toBe(200);
      expect((await as().post('/api/auth/login', { email: user.email, password: 'newPass2026' })).status).toBe(200);
      expect(await models.Notification.count({ where: { userId: user.id, category: 'UPDATE' } })).toBe(1);
    });

    it('changes the email only with the password, to a free address', async () => {
      const { user, actor } = await makeUser();
      const other = await makeUser();
      const change = (body: object) => as(actor).post(`/api/users/${user.id}/email`, body);
      expect((await change({ email: 'new@test.sacco', password: 'wrong-one1' })).status).toBe(400);
      expect((await change({ email: 'not-an-email', password: PASSWORD })).status).toBe(400);
      expect((await change({ email: other.user.email, password: PASSWORD })).status).toBe(409);
      const ok = await change({ email: 'new@test.sacco', password: PASSWORD });
      expect(ok.status).toBe(200);
      expect(ok.body.email).toBe('new@test.sacco');
    });
  });

  describe('notifications', () => {
    it('tells a member about a transaction unless they turned that off, and marks them read', async () => {
      const admin = await makeAdmin();
      const { user, actor } = await makeUser();
      const account = await makeAccount(admin.actor, user.id);
      await record(admin.actor, account.id, 'SAVINGS_DEPOSIT', 10_000);

      const list = await as(actor).get(`/api/users/${user.id}/notifications?unread=true`);
      expect(list.body.unreadCount).toBe(1);
      expect(list.body.items[0]).toMatchObject({ category: 'TRANSACTION', targetType: 'TRANSACTION' });

      expect((await as(actor).post(`/api/users/${user.id}/notifications/read`, {})).body.updated).toBe(1);
      expect((await as(actor).get(`/api/users/${user.id}/notifications?unread=true`)).body.unreadCount).toBe(0);

      await as(actor).patch(`/api/users/${user.id}`, { notifyTransactions: false });
      await record(admin.actor, account.id, 'SAVINGS_DEPOSIT', 10_000);
      expect((await as(actor).get(`/api/users/${user.id}/notifications?unread=true`)).body.unreadCount).toBe(0);
    });
  });

  it('imports members from CSV rows, reporting each bad row without losing the good ones', async () => {
    const admin = await makeAdmin();
    const good = newMember({ email: 'csv.one@test.sacco' });
    const res = await as(admin.actor).post('/api/users/bulk', {
      rows: [good, newMember({ email: 'csv.two@test.sacco', gender: '' }), { ...good }],
    });
    expect(res.status).toBe(200);
    expect(res.body.results.map((result: any) => result.ok)).toEqual([true, false, false]);
    expect(res.body.results[2].error).toMatch(/already exists/);
    expect(await models.User.count({ where: { email: 'csv.one@test.sacco' } })).toBe(1);
    expect((await as(admin.actor).post('/api/users/bulk', { rows: [] })).status).toBe(400);
  });
});
