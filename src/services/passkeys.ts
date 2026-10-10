import jwt from 'jsonwebtoken';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { models } from '../models/index.js';
import { ServiceError } from './errors.js';
import { findUserByEmail } from './users.js';
import { isActiveUser } from './sessions.js';

// Passkey (WebAuthn) sign-in for the web app. The browser and its authenticator (fingerprint reader,
// Windows Hello, a phone) prove the user is present; the server keeps only public keys.
// Challenges are stateless: signed into a short-lived token the browser sends back.

const jwtSecret = () => process.env.JWT_SECRET || 'my-secret-key';
const CHALLENGE_TTL = '5m';

const rpId = () => process.env.WEBAUTHN_RP_ID || 'localhost';
const rpName = () => process.env.WEBAUTHN_RP_NAME || 'Green Sprout SACCO';
const allowedOrigins = () => (process.env.WEBAUTHN_ORIGINS || 'http://localhost:5173,http://localhost:8080')
  .split(',').map(origin => origin.trim()).filter(Boolean);

// The page asking must be one of ours; passkeys are bound to the site that created them
export function expectedOrigin(origin: string | null | undefined) {
  const origins = allowedOrigins();
  if (origin && origins.includes(origin)) return origin;
  throw new ServiceError(400, 'Passkeys are not available from this address');
}

type Purpose = 'passkey-reg' | 'passkey-auth';

export const signPasskeyChallenge = (challenge: string, purpose: Purpose, userId?: string) =>
  jwt.sign({ challenge, purpose, ...(userId && { userId }) }, jwtSecret(), { expiresIn: CHALLENGE_TTL });

export function readPasskeyChallenge(token: unknown, purpose: Purpose) {
  try {
    const payload = jwt.verify(String(token || ''), jwtSecret()) as { challenge?: string; purpose?: string; userId?: string };
    if (payload.purpose === purpose && payload.challenge) return { challenge: payload.challenge, userId: payload.userId };
  } catch {
    // expired or tampered: same answer as a missing one
  }
  throw new ServiceError(401, 'This passkey request has expired. Try again.');
}

const activePasskeys = (userId: string) => models.PasskeyCredential.findAll({ where: { userId, revokedAt: null } });

const transportsOf = (passkey: InstanceType<typeof models.PasskeyCredential>) =>
  (passkey.transports ?? undefined) as AuthenticatorTransportFuture[] | undefined;

// Adding a passkey: the signed-in user (gateway-checked) asks for options, the browser creates the key
export async function registrationOptions(userId: string) {
  const user = await models.User.findByPk(userId);
  if (!isActiveUser(user)) throw new ServiceError(404, 'User not found');
  const existing = await activePasskeys(user.id);
  const options = await generateRegistrationOptions({
    rpName: rpName(),
    rpID: rpId(),
    userName: user.email,
    userDisplayName: user.getFullName(),
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    // Don't register the same authenticator twice
    excludeCredentials: existing.map(passkey => ({ id: passkey.credentialId, transports: transportsOf(passkey) })),
    // A discoverable key lets the member sign in without typing their email first
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  return { options, challengeToken: signPasskeyChallenge(options.challenge, 'passkey-reg', user.id) };
}

export async function addPasskey(userId: string, input: { challengeToken?: unknown; response?: any; deviceName?: unknown }, origin: string | null) {
  const { challenge, userId: challengedUser } = readPasskeyChallenge(input.challengeToken, 'passkey-reg');
  if (challengedUser !== userId) throw new ServiceError(403, 'This passkey request belongs to another user');
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigin(origin),
      expectedRPID: rpId(),
      requireUserVerification: true,
    });
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(400, `The passkey could not be verified: ${(error as Error).message}`);
  }
  if (!verification.verified || !verification.registrationInfo) throw new ServiceError(400, 'The passkey could not be verified');
  const { credential } = verification.registrationInfo;
  const passkey = await models.PasskeyCredential.create({
    userId,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports ?? null,
    deviceName: typeof input.deviceName === 'string' && input.deviceName.trim() ? input.deviceName.trim().slice(0, 120) : null,
  });
  return { id: passkey.id, deviceName: passkey.deviceName, createdAt: passkey.createdAt, lastUsedAt: null };
}

// Signing in: options for one member (email typed) or for any passkey on this computer (discoverable)
export async function loginOptions(email?: unknown) {
  const user = typeof email === 'string' && email.trim() ? await findUserByEmail(email) : null;
  const passkeys = isActiveUser(user) ? await activePasskeys(user.id) : [];
  const options = await generateAuthenticationOptions({
    rpID: rpId(),
    userVerification: 'required',
    allowCredentials: passkeys.map(passkey => ({ id: passkey.credentialId, transports: transportsOf(passkey) })),
  });
  return { options, challengeToken: signPasskeyChallenge(options.challenge, 'passkey-auth') };
}

// Returns the member once their passkey checks out (a passkey counts as both factors, like a trusted phone)
export async function verifyLogin(input: { challengeToken?: unknown; response?: any }, origin: string | null) {
  const { challenge } = readPasskeyChallenge(input.challengeToken, 'passkey-auth');
  const credentialId = typeof input.response?.id === 'string' ? input.response.id : '';
  const passkey = credentialId ? await models.PasskeyCredential.findOne({ where: { credentialId, revokedAt: null } }) : null;
  const user = passkey ? await models.User.findByPk(passkey.userId) : null;
  if (!passkey || !isActiveUser(user) || user.mustChangePassword) {
    throw new ServiceError(401, 'This passkey is not set up for Green Sprout any more. Sign in with your password.');
  }
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigin(origin),
      expectedRPID: rpId(),
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')),
        counter: Number(passkey.counter),
        transports: transportsOf(passkey),
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(401, 'The passkey could not be verified');
  }
  if (!verification.verified) throw new ServiceError(401, 'The passkey could not be verified');
  await passkey.update({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() });
  return { user, passkey };
}

export const listPasskeys = async (userId: string) =>
  (await activePasskeys(userId)).map(passkey => ({
    id: passkey.id, deviceName: passkey.deviceName, createdAt: passkey.createdAt, lastUsedAt: passkey.lastUsedAt,
  }));

export async function removePasskey(userId: string, id: string) {
  const [count] = await models.PasskeyCredential.update({ revokedAt: new Date() }, { where: { id, userId, revokedAt: null } });
  return count;
}
