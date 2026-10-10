import bcrypt from 'bcryptjs';
import type { Transaction as DbTransaction } from 'sequelize';
import sequelize from '../lib/sequelize.js';
import { models } from '../models/index.js';
import { ServiceError } from './errors.js';

type UserRecord = InstanceType<typeof models.User>;

// The one shape every user endpoint returns (never the password hash)
export const toUserResponse = (user: UserRecord) => ({
  id: user.id,
  first_name: user.first_name,
  last_name: user.last_name,
  other_name: user.other_name,
  fullName: user.getFullName(),
  email: user.email,
  role: user.role,
  status: user.status,
  contact: user.contact,
  gender: user.gender,
  dob: user.dob,
  joinDate: user.joinDate,
  lastLogin: user.lastLogin,
  hasAccount: user.hasAccount,
  avatar: user.avatar ?? null,
  twoFactorEnabled: Boolean(user.twoFactorEnabled),
  notifyTransactions: user.notifyTransactions !== false,
  notifyUpdates: user.notifyUpdates !== false,
  notifyLoanDecisions: user.notifyLoanDecisions !== false,
  mustChangePassword: Boolean(user.mustChangePassword),
});

// Fields PATCH /users/:id may change; who may change which ones is enforced by the gateway
export const UPDATABLE_USER_FIELDS = [
  'first_name', 'last_name', 'other_name', 'email', 'contact', 'dob', 'gender', 'avatar', 'role', 'status',
  'twoFactorEnabled', 'notifyTransactions', 'notifyUpdates', 'notifyLoanDecisions',
] as const;

export const MIN_PASSWORD_LENGTH = 8;

// The rules every new password follows (own change, temporary password from staff, replacing it)
export function validateNewPassword(password: unknown, label = 'The new password'): asserts password is string {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new ServiceError(400, `${label} must have at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new ServiceError(400, `${label} must contain letters and numbers`);
  }
}

// Members change their own password: the current one must match
export async function changePassword(id: string, input: Record<string, any>) {
  const { currentPassword, newPassword } = input;
  const user = await models.User.findByPk(id);
  if (!user || user.is_deleted) throw new ServiceError(404, 'User not found');
  if (!currentPassword || !(await bcrypt.compare(String(currentPassword), user.password))) {
    throw new ServiceError(400, 'Your current password is not correct');
  }
  validateNewPassword(newPassword);
  if (await bcrypt.compare(newPassword, user.password)) {
    throw new ServiceError(400, 'Choose a password different from the current one');
  }
  await user.update({ password: await bcrypt.hash(newPassword, 10), mustChangePassword: false, tempPasswordExpiresAt: null });
  return user;
}

// After signing in with a temporary password the member must choose their own (no current password asked:
// the session itself proves they just signed in with it)
export async function replaceTemporaryPassword(id: string, input: Record<string, any>) {
  const { newPassword } = input;
  const user = await models.User.findByPk(id);
  if (!user || user.is_deleted) throw new ServiceError(404, 'User not found');
  if (!user.mustChangePassword) throw new ServiceError(409, 'Your password does not need to be changed');
  validateNewPassword(newPassword);
  if (await bcrypt.compare(newPassword, user.password)) {
    throw new ServiceError(400, 'Choose a password different from the temporary one');
  }
  await user.update({ password: await bcrypt.hash(newPassword, 10), mustChangePassword: false, tempPasswordExpiresAt: null });
  return user;
}

// The sign-in email changes only with the account password
export async function changeEmail(id: string, input: Record<string, any>) {
  const email = String(input.email || '').trim();
  const user = await models.User.findByPk(id);
  if (!user || user.is_deleted) throw new ServiceError(404, 'User not found');
  if (!input.password || !(await bcrypt.compare(String(input.password), user.password))) {
    throw new ServiceError(400, 'Your password is not correct');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ServiceError(400, 'Enter a valid email address');
  const existing = await findUserByEmail(email);
  if (existing && existing.id !== user.id) throw new ServiceError(409, 'Another member already uses that email');
  await user.update({ email });
  return user;
}

export const MAX_AVATAR_LENGTH = 200 * 1024;

export const findUserByEmail = (email: string, transaction?: DbTransaction) =>
  models.User.findOne({
    where: sequelize.where(sequelize.fn('lower', sequelize.col('email')), String(email).trim().toLowerCase()),
    transaction,
  });

export async function createUser(input: Record<string, any>, { transaction }: { transaction?: DbTransaction } = {}) {
  const { first_name, last_name, other_name, email, password, role, status, contact, dob, gender } = input;

  if (!first_name || !last_name || !email || !role || !status || !contact || !dob || !gender) {
    throw new ServiceError(400, 'All fields are required');
  }
  if (await findUserByEmail(email, transaction)) {
    throw new ServiceError(409, `A user with email ${email} already exists`);
  }

  const hashedPassword = await bcrypt.hash(password || 'password123', 10);
  return models.User.create({
    first_name,
    last_name,
    other_name,
    email: String(email).trim(),
    password: hashedPassword,
    role,
    status,
    contact,
    dob,
    gender,
    joinDate: new Date(),
  }, { transaction });
}
