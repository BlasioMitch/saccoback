import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../../app.js';
import { models, sequelize } from '../../../models/index.js';
import { testOutbox } from '../../../lib/mailer.js';
import { Gender, UserRole, UserStatus } from '../../../models/user.js';

// The REST API is only ever called by the gateway: every request carries the internal key, plus who is
// acting (x-actor-*) and from which app (x-client), exactly as graphsacco sends them.
export const app = createApp();
export const API_KEY = process.env.INTERNAL_API_KEY as string;

export interface Actor {
  id: string;
  email: string;
  role: string;
}

type Client = 'web' | 'mobile';

export function as(actor?: Actor | null, { client = 'web' as Client, headers = {} as Record<string, string> } = {}) {
  const base: Record<string, string> = { 'graph-api-key': API_KEY, 'x-client': client, ...headers };
  if (actor) {
    base['x-actor-id'] = actor.id;
    base['x-actor-email'] = actor.email;
    base['x-actor-role'] = actor.role;
  }
  return {
    get: (url: string) => request(app).get(url).set(base),
    post: (url: string, body: object = {}) => request(app).post(url).set(base).send(body),
    patch: (url: string, body: object = {}) => request(app).patch(url).set(base).send(body),
    delete: (url: string) => request(app).delete(url).set(base),
  };
}

// Tables are created once per test file and emptied before each test
export async function createTables() {
  await sequelize.sync({ force: true });
}

export async function clearTables() {
  const tables = Object.values(models).map(model => `"${model.tableName}"`).join(", ");
  await sequelize.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  testOutbox.length = 0;
}

export async function closeDatabase() {
  await sequelize.close();
}

// Lets a describe block use the database: tables made once, emptied before each test, closed at the end
export function useDatabase() {
  beforeAll(createTables);
  beforeEach(clearTables);
  afterAll(closeDatabase);
}

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter += 1)}`;

export const PASSWORD = 'member123';

export async function makeUser(overrides: Record<string, unknown> = {}) {
  const tag = unique();
  const { password = PASSWORD, ...fields } = overrides;
  const user = await models.User.create({
    first_name: 'Test',
    last_name: `Member${tag}`,
    email: `member.${tag}@test.sacco`,
    password: await bcrypt.hash(String(password), 4),
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    contact: '0772000000',
    dob: new Date('1990-01-01'),
    gender: Gender.FEMALE,
    joinDate: new Date(),
    ...fields,
  } as any);
  const actor: Actor = { id: user.id, email: user.email, role: user.role };
  return { user, actor };
}

export const makeAdmin = (overrides: Record<string, unknown> = {}) => makeUser({ role: UserRole.ADMIN, first_name: 'Admin', ...overrides });
export const makeManager = (overrides: Record<string, unknown> = {}) => makeUser({ role: UserRole.MANAGER, first_name: 'Manager', ...overrides });

// Opens an account through the API (the way staff do), so its side effects (transactions) happen too
export async function makeAccount(staff: Actor, userId: string, body: Record<string, unknown> = {}) {
  const res = await as(staff).post('/api/accounts', { userId, status: 'ACTIVE', balance: 0, paidMembership: false, ...body });
  if (res.status !== 201) throw new Error(`Could not open the account: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; accountNumber: string; balance: number };
}

export async function record(staff: Actor, accountId: string, type: string, amount: number, extra: Record<string, unknown> = {}) {
  return as(staff).post('/api/transactions', { accountId, type, amount, status: 'COMPLETED', ...extra });
}

export const balanceOf = async (accountId: string) => Number((await models.Account.findByPk(accountId))!.balance);

// A member with an active account that has paid the membership fee and holds some savings
export async function makeMemberWithSavings(staff: Actor, savings = 500_000) {
  const member = await makeUser();
  const account = await makeAccount(staff, member.user.id);
  await record(staff, account.id, 'SAVINGS_DEPOSIT', savings + 20_000);
  await record(staff, account.id, 'MEMBERSHIP_FEE', 20_000);
  return { ...member, account };
}

// Audit rows are written when the response finishes, so wait for them a moment
export async function waitFor<T>(find: () => Promise<T | null | undefined>, timeoutMs = 3000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const found = await find();
    if (found) return found;
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

export const waitForAudit = (action: string, where: Record<string, unknown> = {}) =>
  waitFor(() => models.AuditLog.findOne({ where: { action, ...where }, order: [['createdAt', 'DESC']] }));

export { testOutbox, models, sequelize };

// Today in Kampala (UTC+3) as YYYY-MM-DD, like the server's report and loan dates
export const kampalaToday = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
