import bcrypt from 'bcryptjs';
import type { Request } from 'express';
import sequelize from '../lib/sequelize.js';
import { models } from '../models/index.js';
import { PasswordResetStatus } from '../models/passwordResetRequest.js';
import { NotificationCategory, NotificationTarget } from '../models/notification.js';
import { clearStaffNotifications, notifyStaff, notifyUser } from '../lib/notifications.js';
import { sendPasswordResetEmail } from '../lib/mailer.js';
import { recordAudit } from '../lib/audit.js';
import { findUserByEmail, validateNewPassword } from './users.js';
import { isActiveUser, revokeDevices } from './sessions.js';
import { ServiceError } from './errors.js';

// How long a temporary password from staff can be used to sign in
export const TEMP_PASSWORD_HOURS = 24;
// Repeat presses of "Send" within this window refresh the pending request instead of notifying staff again
const RENOTIFY_AFTER_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Records the request and tells ADMIN and MANAGER users. Unknown, inactive or malformed emails are only
// audited, and the caller answers the same way in every case.
export async function requestPasswordReset(req: Request, rawEmail: unknown) {
  const email = String(rawEmail ?? '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new ServiceError(400, 'Enter a valid email address');

  const user = await findUserByEmail(email);
  const actor = { id: user?.id ?? null, email, role: user?.role ?? null };
  if (!isActiveUser(user)) {
    await recordAudit(req, { action: 'PASSWORD_RESET_REQUESTED', entityType: 'USER', entityId: actor.id, summary: 'Reset requested for an unknown or inactive email (ignored)', actor });
    return null;
  }

  const now = new Date();
  const result = await sequelize.transaction(async transaction => {
    const pending = await models.PasswordResetRequest.findOne({
      where: { userId: user.id, status: PasswordResetStatus.PENDING },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (pending) {
      const recent = now.getTime() - new Date(pending.lastRequestedAt).getTime() < RENOTIFY_AFTER_MS;
      if (recent && pending.requestCount >= MAX_REQUESTS_PER_WINDOW) return { request: pending, throttled: true };
      await pending.update({
        requestCount: recent ? pending.requestCount + 1 : 1,
        lastRequestedAt: now,
        source: req.client?.source ?? pending.source,
        ip: req.client?.ip ?? pending.ip,
      }, { transaction });
      // A reminder for staff once an hour has passed without anyone handling it
      if (!recent) await notifyStaffOfRequest(pending.id, user, true, transaction);
      return { request: pending, throttled: false };
    }

    const request = await models.PasswordResetRequest.create({
      userId: user.id,
      email: user.email,
      status: PasswordResetStatus.PENDING,
      source: req.client?.source ?? null,
      ip: req.client?.ip ?? null,
      lastRequestedAt: now,
    }, { transaction });
    await notifyStaffOfRequest(request.id, user, false, transaction);
    return { request, throttled: false };
  });

  if (!result.throttled) {
    await recordAudit(req, {
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'PASSWORD_RESET',
      entityId: result.request.id,
      summary: `Password reset requested from the ${req.client?.source === 'MOBILE' ? 'phone app' : 'web app'}`,
      actor,
    });
  }
  return result.request;
}

const notifyStaffOfRequest = (requestId: string, user: InstanceType<typeof models.User>, reminder: boolean, transaction: any) =>
  notifyStaff({
    title: reminder ? 'Password reset still waiting' : 'Password reset request',
    body: `${user.getFullName()} (${user.email}) asked for a new password.`,
    targetType: NotificationTarget.PASSWORD_RESET,
    targetId: requestId,
  }, transaction);

type ResetRecord = InstanceType<typeof models.PasswordResetRequest>;

// The requests with the member and the staff member who handled each one
async function describeRequests(requests: ResetRecord[]) {
  const ids = [...new Set(requests.flatMap(request => [request.userId, request.handledById].filter(Boolean) as string[]))];
  const users = ids.length ? await models.User.findAll({ where: { id: ids } }) : [];
  const byId = new Map(users.map(user => [user.id, user]));
  return requests.map(request => {
    const member = byId.get(request.userId);
    const handler = request.handledById ? byId.get(request.handledById) : null;
    return {
      id: request.id,
      email: request.email,
      status: request.status,
      source: request.source,
      requestCount: request.requestCount,
      lastRequestedAt: request.lastRequestedAt,
      createdAt: request.createdAt,
      handledAt: request.handledAt,
      note: request.note,
      user: member ? {
        id: member.id,
        fullName: member.getFullName(),
        email: member.email,
        role: member.role,
        status: member.status,
        avatar: member.avatar ?? null,
        twoFactorEnabled: Boolean(member.twoFactorEnabled),
        lastLogin: member.lastLogin ?? null,
      } : null,
      handledBy: handler ? { id: handler.id, fullName: handler.getFullName() } : null,
    };
  });
}

export async function listPasswordResets(status?: string) {
  const where = status && (Object.values(PasswordResetStatus) as string[]).includes(status) ? { status } : {};
  const requests = await models.PasswordResetRequest.findAll({ where, order: [['lastRequestedAt', 'DESC']], limit: 200 });
  return describeRequests(requests);
}

export async function getPasswordReset(id: string) {
  const request = await models.PasswordResetRequest.findByPk(id);
  if (!request) throw new ServiceError(404, 'Password reset request not found');
  return (await describeRequests([request]))[0];
}

// Staff set a temporary password: the member must replace it after signing in (2-step verification, if on,
// still applies), fingerprint enrollments stop working, and the password is emailed to the member
export async function completePasswordReset(req: Request, id: string, password: unknown) {
  validateNewPassword(password, 'The temporary password');
  const handledById = req.actor?.id ?? null;
  const expiresAt = new Date(Date.now() + TEMP_PASSWORD_HOURS * 60 * 60 * 1000);

  const { request, user } = await sequelize.transaction(async transaction => {
    const request = await models.PasswordResetRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!request) throw new ServiceError(404, 'Password reset request not found');
    if (request.status !== PasswordResetStatus.PENDING) throw new ServiceError(409, `This request was already ${request.status.toLowerCase()}`);
    const user = await models.User.findByPk(request.userId, { transaction });
    if (!isActiveUser(user)) throw new ServiceError(409, 'This member is no longer active');
    if (handledById && handledById === user.id) throw new ServiceError(403, 'You cannot reset your own password here');

    await user.update({
      password: await bcrypt.hash(password, 10),
      mustChangePassword: true,
      tempPasswordExpiresAt: expiresAt,
    }, { transaction });
    await revokeDevices(user.id, transaction);
    await request.update({ status: PasswordResetStatus.COMPLETED, handledById, handledAt: new Date() }, { transaction });
    await clearStaffNotifications(NotificationTarget.PASSWORD_RESET, request.id, transaction);
    await notifyUser(user.id, NotificationCategory.UPDATE, {
      title: 'Password reset',
      body: 'The SACCO office set a temporary password and emailed it to you. Choose a new password after signing in.',
      targetType: NotificationTarget.SECURITY,
    }, transaction);
    return { request, user };
  });

  let emailSent = true;
  try {
    await sendPasswordResetEmail({ email: user.email, name: user.getFullName(), password, expiresAt });
  } catch (error) {
    emailSent = false;
    console.error('Error sending password reset email:', error);
  }
  return { request: await getPasswordReset(request.id), emailSent, expiresAt };
}

export async function dismissPasswordReset(req: Request, id: string, note?: unknown) {
  return sequelize.transaction(async transaction => {
    const request = await models.PasswordResetRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!request) throw new ServiceError(404, 'Password reset request not found');
    if (request.status !== PasswordResetStatus.PENDING) throw new ServiceError(409, `This request was already ${request.status.toLowerCase()}`);
    await request.update({
      status: PasswordResetStatus.DISMISSED,
      handledById: req.actor?.id ?? null,
      handledAt: new Date(),
      note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null,
    }, { transaction });
    await clearStaffNotifications(NotificationTarget.PASSWORD_RESET, request.id, transaction);
    return request;
  }).then(request => getPasswordReset(request.id));
}
