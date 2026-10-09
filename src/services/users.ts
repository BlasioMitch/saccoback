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
});

// Fields PATCH /users/:id may change; who may change which ones is enforced by the gateway
export const UPDATABLE_USER_FIELDS = [
  'first_name', 'last_name', 'other_name', 'email', 'contact', 'dob', 'gender', 'avatar', 'role', 'status',
] as const;

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
