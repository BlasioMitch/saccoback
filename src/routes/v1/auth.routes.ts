import { Router } from 'express';
import bcrypt from 'bcryptjs';
import sequelize from '../../lib/sequelize.js';
import { models } from '../../models/index.js';
import { findUserByEmail } from '../../services/users.js';
import {
  enrollDevice, findTrustedDevice, isActiveUser, otpCode, readChallenge, revokeDevices, signChallenge, startSession, activeDevices,
} from '../../services/sessions.js';
import { requestPasswordReset } from '../../services/passwordResets.js';
import { addPasskey, listPasskeys, loginOptions, registrationOptions, removePasskey, verifyLogin } from '../../services/passkeys.js';
import { recordAudit } from '../../lib/audit.js';
import { describeError } from '../../services/errors.js';

const router = Router();

const INVALID_CREDENTIALS = 'Invalid email or password';

// Sign-in, step 1: email and password. With 2-step verification on, the answer is a short-lived challenge
// (not a session); the session only comes from /2fa/verify with the code.
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await findUserByEmail(String(email));
    const failed = (reason: string) => recordAudit(req, {
      action: 'LOGIN_FAILED',
      entityType: 'USER',
      entityId: user?.id ?? null,
      summary: reason,
      actor: { id: user?.id ?? null, email: String(email).trim().toLowerCase(), role: user?.role ?? null },
      statusCode: 401,
    });

    if (!isActiveUser(user) || !(await bcrypt.compare(String(password), user.password))) {
      await failed(user && !isActiveUser(user) ? 'Account is inactive or deleted' : 'Wrong email or password');
      return res.status(401).json({ error: INVALID_CREDENTIALS });
    }

    if (user.mustChangePassword && user.tempPasswordExpiresAt && user.tempPasswordExpiresAt.getTime() < Date.now()) {
      await failed('Temporary password expired');
      return res.status(401).json({
        error: 'Your temporary password has expired. Use "Forgot password?" to request a new one.',
        code: 'TEMP_PASSWORD_EXPIRED',
      });
    }

    const actor = { id: user.id, email: user.email, role: user.role };
    if (user.twoFactorEnabled) {
      await recordAudit(req, { action: 'LOGIN_CODE_REQUESTED', entityType: 'USER', entityId: user.id, summary: 'Password accepted; waiting for the 2-step code', actor });
      return res.json({ twoFactorRequired: true, challengeToken: signChallenge(user), user: { first_name: user.first_name } });
    }

    const session = await startSession(user);
    await recordAudit(req, { action: 'LOGIN_SUCCESS', entityType: 'USER', entityId: user.id, summary: 'Signed in', actor });
    res.json(session);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sign-in, step 2 for members with 2-step verification
router.post('/2fa/verify', async (req, res) => {
  try {
    const userId = readChallenge(req.body?.challengeToken);
    const user = await models.User.findByPk(userId);
    if (!isActiveUser(user)) return res.status(401).json({ error: 'Your sign-in has expired. Sign in again.' });

    const actor = { id: user.id, email: user.email, role: user.role };
    if (String(req.body?.code ?? '').trim() !== otpCode()) {
      await recordAudit(req, { action: 'TWO_FACTOR_FAILED', entityType: 'USER', entityId: user.id, summary: 'Wrong 2-step code', actor, statusCode: 400 });
      return res.status(400).json({ error: 'That code is not correct' });
    }

    const session = await startSession(user);
    await recordAudit(req, { action: 'LOGIN_SUCCESS', entityType: 'USER', entityId: user.id, summary: 'Signed in with 2-step verification', actor });
    res.json(session);
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

// "Forgot password?": always the same answer, so it never reveals which emails belong to members
router.post('/forgot-password', async (req, res) => {
  try {
    await requestPasswordReset(req, req.body?.email);
    res.json({
      success: true,
      message: 'If that email belongs to a member, the SACCO office will reset the password and email you a temporary one.',
    });
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

// Fingerprint sign-in (phone app). Enrolling needs a full session (the gateway sends the member's id);
// signing in with an enrolled phone counts as both factors.
router.post('/biometric/enroll', async (req, res) => {
  try {
    const user = await models.User.findByPk(String(req.body?.userId || ''));
    if (!isActiveUser(user)) return res.status(404).json({ error: 'User not found' });
    const result = await enrollDevice(user.id, req.body?.deviceName);
    await recordAudit(req, { action: 'BIOMETRIC_ENROLLED', entityType: 'USER', entityId: user.id, summary: `Fingerprint sign-in turned on${req.body?.deviceName ? ` (${String(req.body.deviceName).slice(0, 100)})` : ''}` });
    res.status(201).json(result);
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

router.post('/biometric/login', async (req, res) => {
  try {
    const device = await findTrustedDevice(req.body?.deviceId, req.body?.secret);
    const user = device ? await models.User.findByPk(device.userId) : null;
    if (!device || !isActiveUser(user) || user.mustChangePassword) {
      await recordAudit(req, { action: 'LOGIN_FAILED', entityType: 'USER', entityId: user?.id ?? null, summary: 'Fingerprint sign-in refused (device not enrolled or revoked)', actor: user ? { id: user.id, email: user.email, role: user.role } : null, statusCode: 401 });
      return res.status(401).json({ error: 'Fingerprint sign-in is no longer set up on this phone. Sign in with your password.', code: 'DEVICE_REVOKED' });
    }
    await device.update({ lastUsedAt: new Date() });
    const session = await startSession(user);
    await recordAudit(req, { action: 'BIOMETRIC_LOGIN', entityType: 'USER', entityId: user.id, summary: 'Signed in with fingerprint', actor: { id: user.id, email: user.email, role: user.role } });
    res.json(session);
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

router.post('/biometric/revoke', async (req, res) => {
  try {
    const userId = String(req.body?.userId || '');
    const deviceId = req.body?.deviceId ? String(req.body.deviceId) : undefined;
    const revoked = await sequelize.transaction(transaction => revokeDevices(userId, transaction, deviceId));
    if (revoked) await recordAudit(req, { action: 'BIOMETRIC_REVOKED', entityType: 'USER', entityId: userId, summary: 'Fingerprint sign-in turned off' });
    res.json({ revoked });
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

router.get('/biometric/devices', async (req, res) => {
  try {
    res.json(await activeDevices(String(req.query.userId || '')));
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

// Passkeys (web): fingerprint reader, Windows Hello or a phone. Registering needs a full session (the gateway
// sends the member's id); signing in with one counts as both factors.
const passkeyRoute = (handler: (req: any) => Promise<unknown>, status = 200) => async (req: any, res: any) => {
  try {
    res.status(status).json(await handler(req));
  } catch (error) {
    const { status: code, message } = describeError(error);
    res.status(code).json({ error: message });
  }
};

router.post('/passkey/register/options', passkeyRoute(req => registrationOptions(String(req.body?.userId || ''))));

router.post('/passkey/register/verify', passkeyRoute(async req => {
  const passkey = await addPasskey(String(req.body?.userId || ''), req.body ?? {}, req.client?.origin ?? null);
  await recordAudit(req, { action: 'PASSKEY_ADDED', entityType: 'USER', entityId: req.body?.userId ?? null, summary: `Added a passkey${passkey.deviceName ? ` (${passkey.deviceName})` : ''}` });
  return passkey;
}, 201));

router.post('/passkey/login/options', passkeyRoute(req => loginOptions(req.body?.email)));

router.post('/passkey/login/verify', async (req, res) => {
  try {
    const { user, passkey } = await verifyLogin(req.body ?? {}, req.client?.origin ?? null);
    const session = await startSession(user);
    await recordAudit(req, {
      action: 'PASSKEY_LOGIN', entityType: 'USER', entityId: user.id,
      summary: `Signed in with a passkey${passkey.deviceName ? ` (${passkey.deviceName})` : ''}`,
      actor: { id: user.id, email: user.email, role: user.role },
    });
    res.json(session);
  } catch (error) {
    const { status, message } = describeError(error);
    await recordAudit(req, { action: 'LOGIN_FAILED', entityType: 'USER', summary: `Passkey sign-in refused: ${message}`, statusCode: status, subject: null });
    res.status(status).json({ error: message, code: status === 401 ? 'PASSKEY_REJECTED' : undefined });
  }
});

router.get('/passkey/list', passkeyRoute(req => listPasskeys(String(req.query.userId || ''))));

router.post('/passkey/remove', passkeyRoute(async req => {
  const removed = await removePasskey(String(req.body?.userId || ''), String(req.body?.id || ''));
  if (removed) await recordAudit(req, { action: 'PASSKEY_REMOVED', entityType: 'USER', entityId: req.body?.userId ?? null, summary: 'Removed a passkey' });
  return { removed };
}));

// Sessions are JWTs held by the client; the gateway clears the cookie and records the sign-out
router.post('/logout', (_req, res) => {
  res.json({ message: 'Logged out successfully (client should remove JWT)' });
});

export default router;
