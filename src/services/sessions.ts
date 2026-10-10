import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Op, type Transaction as DbTransaction } from 'sequelize';
import { models } from '../models/index.js';
import { toUserResponse } from './users.js';
import { ServiceError } from './errors.js';

type UserRecord = InstanceType<typeof models.User>;

// Read when used, so the value from .env is in place whatever the import order
const jwtSecret = () => process.env.JWT_SECRET || 'my-secret-key';
const SESSION_TTL = '1d';
const CHALLENGE_TTL = '5m';

// The dummy sign-in code until codes are sent by SMS or email
export const otpCode = () => process.env.OTP_CODE || '123456';

// A session for the gateway (cookie on web, Bearer on the phone). A member holding a temporary password
// gets a session the gateway only accepts for choosing a new password.
export function signSession(user: UserRecord) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role, ...(user.mustChangePassword && { mustChangePassword: true }) },
    jwtSecret(),
    { expiresIn: SESSION_TTL },
  );
}

export async function startSession(user: UserRecord) {
  await user.update({ lastLogin: new Date() });
  return { user: toUserResponse(user), token: signSession(user), mustChangePassword: Boolean(user.mustChangePassword) };
}

// Proves the password was right, for the next 5 minutes, without being a session
export const signChallenge = (user: UserRecord) =>
  jwt.sign({ userId: user.id, purpose: '2fa' }, jwtSecret(), { expiresIn: CHALLENGE_TTL });

export function readChallenge(challengeToken: unknown): string {
  try {
    const payload = jwt.verify(String(challengeToken || ''), jwtSecret()) as { userId?: string; purpose?: string };
    if (payload.purpose === '2fa' && payload.userId) return payload.userId;
  } catch {
    // expired or tampered: same answer as a missing one
  }
  throw new ServiceError(401, 'Your sign-in has expired. Sign in again.');
}

export const isActiveUser = (user: UserRecord | null): user is UserRecord =>
  Boolean(user && !user.is_deleted && user.status === 'ACTIVE');

// Fingerprint sign-in: the phone keeps a random secret behind its biometric prompt; the server keeps a hash
const hashSecret = (secret: string) => crypto.createHash('sha256').update(secret).digest('hex');

export async function enrollDevice(userId: string, deviceName?: string | null) {
  const secret = crypto.randomBytes(32).toString('base64url');
  const device = await models.TrustedDevice.create({
    userId,
    deviceName: deviceName ? String(deviceName).slice(0, 100) : null,
    secretHash: hashSecret(secret),
  });
  return { deviceId: device.id, secret };
}

export async function findTrustedDevice(deviceId: unknown, secret: unknown) {
  if (typeof deviceId !== 'string' || typeof secret !== 'string') return null;
  const device = await models.TrustedDevice.findOne({ where: { id: deviceId, revokedAt: null } }).catch(() => null);
  if (!device) return null;
  const expected = Buffer.from(device.secretHash, 'hex');
  const actual = Buffer.from(hashSecret(secret), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual) ? device : null;
}

// Fingerprint enrollments (phones) and passkeys (web) stop working when the password changes or is reset,
// and when 2-step is turned on. With a deviceId, only that phone is revoked.
export async function revokeDevices(userId: string, transaction?: DbTransaction, deviceId?: string) {
  const [count] = await models.TrustedDevice.update(
    { revokedAt: new Date() },
    { where: { userId, revokedAt: null, ...(deviceId && { id: deviceId }) }, transaction },
  );
  if (!deviceId) {
    await models.PasskeyCredential.update({ revokedAt: new Date() }, { where: { userId, revokedAt: null }, transaction });
  }
  return count;
}

export const activeDevices = (userId: string) =>
  models.TrustedDevice.findAll({
    where: { userId, revokedAt: { [Op.is]: null } },
    attributes: ['id', 'deviceName', 'createdAt', 'lastUsedAt'],
    order: [['createdAt', 'DESC']],
  });
