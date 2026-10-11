// "Forgot password?": the member asks, staff are notified, staff issue a temporary password that is emailed
import { as, makeAdmin, makeManager, makeUser, models, PASSWORD, testOutbox, useDatabase, waitForAudit } from './support/helpers.js';

describe('password resets', () => {
  useDatabase();

  const request = (email: string) => as(null, { client: 'mobile' }).post('/api/auth/forgot-password', { email });

  it('answers the same whether or not the email belongs to a member', async () => {
    const { user } = await makeUser();
    const known = await request(user.email);
    const unknown = await request('nobody@test.sacco');
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(await models.PasswordResetRequest.count()).toBe(1);
  });

  it('notifies every admin and manager once, and a repeat press refreshes the same request', async () => {
    const admin = await makeAdmin();
    const manager = await makeManager();
    const { user } = await makeUser();
    await request(user.email);
    await request(user.email);

    const requests = await models.PasswordResetRequest.findAll();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ userId: user.id, status: 'PENDING', requestCount: 2 });
    for (const staff of [admin, manager]) {
      expect(await models.Notification.count({ where: { userId: staff.user.id, category: 'STAFF_REQUEST' } })).toBe(1);
    }
    expect(await models.Notification.count({ where: { userId: user.id } })).toBe(0);
  });

  it('issuing a temporary password emails it, marks the member, and clears the staff bells', async () => {
    const admin = await makeAdmin();
    const manager = await makeManager();
    const { user } = await makeUser();
    await request(user.email);
    const pending = await models.PasswordResetRequest.findOne();

    const weak = await as(admin.actor).post(`/api/password-resets/${pending!.id}/complete`, { password: 'short' });
    expect(weak.status).toBe(400);

    const res = await as(admin.actor).post(`/api/password-resets/${pending!.id}/complete`, { password: 'TempPass2026' });
    expect(res.status).toBe(200);

    const mail = testOutbox.find(message => message.to === user.email);
    expect(mail).toMatchObject({ template: 'password-reset', context: expect.objectContaining({ password: 'TempPass2026' }) });

    await user.reload();
    expect(user.mustChangePassword).toBe(true);
    expect(user.tempPasswordExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect((await models.PasswordResetRequest.findByPk(pending!.id))!.status).toBe('COMPLETED');
    expect(await models.Notification.count({ where: { userId: manager.user.id, readAt: null, category: 'STAFF_REQUEST' } })).toBe(0);

    const row = await waitForAudit('PASSWORD_RESET_ISSUED');
    expect(row.actorEmail).toBe(admin.user.email);
    expect(row.subjectId).toBe(user.id);
    expect(row.summary).toContain(user.email);
    expect(JSON.stringify(row.changes ?? {})).not.toContain('TempPass2026');

    // The old password no longer works; the temporary one signs in, marked for a new password
    expect((await as().post('/api/auth/login', { email: user.email, password: PASSWORD })).status).toBe(401);
    const login = await as().post('/api/auth/login', { email: user.email, password: 'TempPass2026' });
    expect(login.body.mustChangePassword).toBe(true);

    // A request can only be handled once
    expect((await as(admin.actor).post(`/api/password-resets/${pending!.id}/complete`, { password: 'Another2026' })).status).toBe(409);
  });

  it('can be dismissed with a note', async () => {
    const admin = await makeAdmin();
    const { user } = await makeUser();
    await request(user.email);
    const pending = await models.PasswordResetRequest.findOne();
    const res = await as(admin.actor).post(`/api/password-resets/${pending!.id}/dismiss`, { note: 'Called the member' });
    expect(res.status).toBe(200);
    expect(await pending!.reload()).toMatchObject({ status: 'DISMISSED', note: 'Called the member' });
    expect((await as(admin.actor).get('/api/password-resets?status=PENDING')).body).toHaveLength(0);
  });
});
