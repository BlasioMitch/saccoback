// Sign-in steps: password, 2-step code, temporary passwords, fingerprint (trusted phone), with their audit rows
import jwt from 'jsonwebtoken';
import { as, makeUser, models, PASSWORD, useDatabase, waitForAudit } from './support/helpers.js';

describe('sign-in', () => {
  useDatabase();

  it('signs in with the right password and records it', async () => {
    const { user } = await makeUser();
    const res = await as().post('/api/auth/login', { email: user.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ id: user.id, email: user.email });
    expect(res.body.user.password).toBeUndefined();
    expect(jwt.decode(res.body.token)).toMatchObject({ userId: user.id, role: 'USER' });
    const row = await waitForAudit('LOGIN_SUCCESS', { actorEmail: user.email });
    expect(row.subjectId).toBe(user.id);
  });

  it('refuses a wrong password and records the attempt', async () => {
    const { user } = await makeUser();
    const res = await as().post('/api/auth/login', { email: user.email, password: 'wrong-password1' });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    const row = await waitForAudit('LOGIN_FAILED', { actorEmail: user.email });
    expect(row.summary).toBe('Wrong email or password');
    expect(row.statusCode).toBe(401);
  });

  it('refuses an inactive member', async () => {
    const { user } = await makeUser({ status: 'INACTIVE' });
    const res = await as().post('/api/auth/login', { email: user.email, password: PASSWORD });
    expect(res.status).toBe(401);
    expect((await waitForAudit('LOGIN_FAILED', { actorEmail: user.email })).summary).toBe('Account is inactive or deleted');
  });

  it('records an unknown email without revealing it', async () => {
    const res = await as().post('/api/auth/login', { email: 'nobody@test.sacco', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
    await waitForAudit('LOGIN_FAILED', { actorEmail: 'nobody@test.sacco' });
  });

  describe('2-step verification', () => {
    it('answers the password with a short challenge, not a session', async () => {
      const { user } = await makeUser({ twoFactorEnabled: true });
      const res = await as().post('/api/auth/login', { email: user.email, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ twoFactorRequired: true, challengeToken: expect.any(String) });
      expect(res.body.token).toBeUndefined();
      // The challenge proves the password only; it carries no role, so the gateway never treats it as a session
      expect(jwt.decode(res.body.challengeToken)).toMatchObject({ userId: user.id, purpose: '2fa' });
      expect((jwt.decode(res.body.challengeToken) as any).role).toBeUndefined();
      await waitForAudit('LOGIN_CODE_REQUESTED', { actorEmail: user.email });
    });

    it('needs the right code to finish', async () => {
      const { user } = await makeUser({ twoFactorEnabled: true });
      const { challengeToken } = (await as().post('/api/auth/login', { email: user.email, password: PASSWORD })).body;

      const wrong = await as().post('/api/auth/2fa/verify', { challengeToken, code: '000000' });
      expect(wrong.status).toBe(400);
      await waitForAudit('TWO_FACTOR_FAILED', { actorEmail: user.email });

      const right = await as().post('/api/auth/2fa/verify', { challengeToken, code: '123456' });
      expect(right.status).toBe(200);
      expect(right.body.token).toEqual(expect.any(String));
    });

    it('refuses a session token or garbage in place of the challenge', async () => {
      const { user } = await makeUser();
      const session = (await as().post('/api/auth/login', { email: user.email, password: PASSWORD })).body.token;
      expect((await as().post('/api/auth/2fa/verify', { challengeToken: session, code: '123456' })).status).toBe(401);
      expect((await as().post('/api/auth/2fa/verify', { challengeToken: 'nonsense', code: '123456' })).status).toBe(401);
    });
  });

  describe('temporary passwords', () => {
    it('gives a session that is marked for choosing a new password', async () => {
      const { user } = await makeUser({ mustChangePassword: true, tempPasswordExpiresAt: new Date(Date.now() + 60 * 60 * 1000) });
      const res = await as().post('/api/auth/login', { email: user.email, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.mustChangePassword).toBe(true);
      expect(jwt.decode(res.body.token)).toMatchObject({ mustChangePassword: true });
    });

    it('refuses an expired temporary password', async () => {
      const { user } = await makeUser({ mustChangePassword: true, tempPasswordExpiresAt: new Date(Date.now() - 60 * 1000) });
      const res = await as().post('/api/auth/login', { email: user.email, password: PASSWORD });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TEMP_PASSWORD_EXPIRED');
    });

    it('replacing it gives a normal session and clears the mark', async () => {
      const { user, actor } = await makeUser({ mustChangePassword: true, tempPasswordExpiresAt: new Date(Date.now() + 60 * 60 * 1000) });
      const same = await as(actor).post(`/api/users/${user.id}/password/initial`, { newPassword: PASSWORD });
      expect(same.status).toBe(400);
      const res = await as(actor).post(`/api/users/${user.id}/password/initial`, { newPassword: 'brandNew2026' });
      expect(res.status).toBe(200);
      expect(res.body.mustChangePassword).toBe(false);
      expect((jwt.decode(res.body.token) as any).mustChangePassword).toBeUndefined();
      await user.reload();
      expect(user.mustChangePassword).toBe(false);
      expect((await as().post('/api/auth/login', { email: user.email, password: 'brandNew2026' })).status).toBe(200);
    });
  });

  describe('fingerprint sign-in (trusted phone)', () => {
    const enroll = async () => {
      const member = await makeUser();
      const res = await as(member.actor, { client: 'mobile' }).post('/api/auth/biometric/enroll', { userId: member.user.id, deviceName: 'Test phone' });
      expect(res.status).toBe(201);
      return { ...member, device: res.body as { deviceId: string; secret: string } };
    };

    it('signs in with the enrolled secret, counting as both factors', async () => {
      const { user, device } = await enroll();
      await user.update({ twoFactorEnabled: true });
      const res = await as({ id: '', email: '', role: '' }, { client: 'mobile' }).post('/api/auth/biometric/login', device);
      expect(res.status).toBe(200);
      expect(res.body.token).toEqual(expect.any(String));
      const row = await waitForAudit('BIOMETRIC_LOGIN', { subjectId: user.id });
      expect(row.source).toBe('MOBILE');
    });

    it('refuses a wrong secret', async () => {
      const { device } = await enroll();
      const res = await as().post('/api/auth/biometric/login', { deviceId: device.deviceId, secret: 'not-the-secret' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('DEVICE_REVOKED');
    });

    it('stops working once turned off', async () => {
      const { user, actor, device } = await enroll();
      const revoke = await as(actor).post('/api/auth/biometric/revoke', { userId: user.id, deviceId: device.deviceId });
      expect(revoke.body.revoked).toBe(1);
      await waitForAudit('BIOMETRIC_REVOKED', { subjectId: user.id });
      expect((await as().post('/api/auth/biometric/login', device)).status).toBe(401);
    });

    it('is revoked by a password change and by turning 2-step on', async () => {
      const first = await enroll();
      const change = await as(first.actor).post(`/api/users/${first.user.id}/password`, { currentPassword: PASSWORD, newPassword: 'changed2026x' });
      expect(change.status).toBe(200);
      expect((await as().post('/api/auth/biometric/login', first.device)).status).toBe(401);

      const second = await enroll();
      await as(second.actor).patch(`/api/users/${second.user.id}`, { twoFactorEnabled: true });
      expect((await as().post('/api/auth/biometric/login', second.device)).status).toBe(401);
      expect(await models.TrustedDevice.count({ where: { userId: second.user.id, revokedAt: null } })).toBe(0);
    });
  });
});
