import type { Request, Response, NextFunction } from 'express';
import { models } from '../models/index.js';
import { AuditSource } from '../models/auditLog.js';
import type { Actor } from './authenticateToken.js';
import { personLabel, renderSummary, Subject, transactionLabel } from './auditSubjects.js';

export interface AuditEvent {
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  summary?: string | null;
  changes?: Record<string, unknown> | null;
  statusCode?: number | null;
  // Defaults to the gateway-forwarded actor; sign-in events name the member themselves
  actor?: Partial<Actor> | null;
  // Who the action was about; looked up from the entity when not given (null: nobody)
  subject?: Subject | null;
  // When it really happened, for events the phone reports later (defaults to the x-queued-at header)
  clientCreatedAt?: Date | null;
}

// Values that must never be stored in the trail
const SECRET_KEYS = /pass(word)?|secret|token|code|otp/i;
const IMAGE_KEYS = /avatar|image|photo/i;
const MAX_STRING = 300;
const MAX_KEYS = 40;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? '' : 's'}]`;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== 'object') return value;
  if (depth > 2) return '[object]';
  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS);
  return Object.fromEntries(entries.map(([key, item]) => {
    if (SECRET_KEYS.test(key)) return [key, '[redacted]'];
    if (IMAGE_KEYS.test(key)) return [key, item ? '[image]' : item];
    return [key, redact(item, depth + 1)];
  }));
}

const fullName = (user: any) => (user ? [user.first_name, user.other_name, user.last_name].filter(Boolean).join(' ') : null);
const ownerOf = (user: any): Subject => ({ userId: user?.id ?? null, name: fullName(user), email: user?.email ?? null });

// Looks up who an entity belongs to. Never throws: an unknown or deleted record simply has no subject.
export async function describeSubject(entityType?: string | null, entityId?: string | null): Promise<Subject | null> {
  if (!entityType || !entityId || !/^[0-9a-f-]{36}$/i.test(entityId)) return null;
  try {
    const accountOwner = async (accountId: string | null | undefined) => {
      const account = accountId ? await models.Account.findByPk(accountId, { attributes: ['id', 'userId', 'accountNumber'] }) : null;
      const user = account?.userId ? await models.User.findByPk(account.userId, { attributes: ['id', 'first_name', 'other_name', 'last_name', 'email'] }) : null;
      return { account, user };
    };
    switch (entityType) {
      case 'USER': {
        const user = await models.User.findByPk(entityId, { attributes: ['id', 'first_name', 'other_name', 'last_name', 'email'] });
        return user ? ownerOf(user) : null;
      }
      case 'ACCOUNT': {
        const { account, user } = await accountOwner(entityId);
        return account ? { ...ownerOf(user), accountNumber: account.accountNumber } : null;
      }
      case 'LOAN': {
        const loan = await models.Loan.findByPk(entityId, { attributes: ['id', 'accountId', 'amount'] });
        if (!loan) return null;
        const { account, user } = await accountOwner(loan.accountId);
        return { ...ownerOf(user), accountNumber: account?.accountNumber ?? null, amount: Number(loan.amount) };
      }
      case 'TRANSACTION': {
        const transaction = await models.Transaction.findByPk(entityId, { attributes: ['id', 'accountId', 'amount', 'type'] });
        if (!transaction) return null;
        const { account, user } = await accountOwner(transaction.accountId);
        return { ...ownerOf(user), accountNumber: account?.accountNumber ?? null, amount: Number(transaction.amount), typeLabel: transactionLabel(transaction.type) };
      }
      case 'PASSWORD_RESET': {
        const request = await models.PasswordResetRequest.findByPk(entityId, { attributes: ['id', 'userId', 'email'] });
        if (!request) return null;
        const user = await models.User.findByPk(request.userId, { attributes: ['id', 'first_name', 'other_name', 'last_name', 'email'] });
        return user ? ownerOf(user) : { userId: request.userId, email: request.email };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// Writes one audit row. Never throws: a failed audit insert must not fail the member's request.
export async function recordAudit(req: Request | null, event: AuditEvent) {
  try {
    const actor = { ...(req?.actor ?? {}), ...(event.actor ?? {}) };
    const client = req?.client;
    const subject = event.subject !== undefined ? event.subject : await describeSubject(event.entityType, event.entityId);
    await models.AuditLog.create({
      actorId: actor.id ?? null,
      actorEmail: actor.email ?? null,
      actorRole: actor.role ?? null,
      source: (client?.source as AuditSource) ?? AuditSource.SYSTEM,
      action: event.action,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      method: req?.method ?? null,
      path: req ? stripQuery(req.originalUrl).slice(0, 255) : null,
      statusCode: event.statusCode ?? null,
      ip: client?.ip ?? null,
      userAgent: client?.userAgent ?? null,
      summary: event.summary ? event.summary.slice(0, 500) : null,
      changes: event.changes ? (redact(event.changes) as Record<string, unknown>) : null,
      subjectId: subject?.userId ?? null,
      // '' = nobody to name (null is kept for rows written before subjects were recorded)
      subjectName: personLabel(subject)?.slice(0, 255) ?? '',
      clientCreatedAt: event.clientCreatedAt ?? client?.queuedAt ?? null,
    });
    if (req?.res) req.res.locals.audited = true;
  } catch (error) {
    console.error('Audit log write failed:', error);
  }
}

const stripQuery = (url: string) => url.split('?')[0];

interface RouteAction {
  action: string;
  entityType: string;
  // Plain wording, used when the record cannot be described
  summary: string;
  // With the affected member or record, e.g. "Approved a loan of {amount} for {person}" (see auditSubjects.ts)
  template?: string;
}

// Every changing REST route and what the trail calls it. Routes not listed (and the auth routes, which
// record their own events) are not logged by the middleware.
const ROUTE_ACTIONS: Array<[string, RouteAction | null]> = [
  ['POST /users/bulk', { action: 'USER_BULK_IMPORT', entityType: 'USER', summary: 'Imported members from CSV' }],
  ['POST /users/:id/password/initial', { action: 'PASSWORD_CHANGED', entityType: 'USER', summary: 'Replaced a temporary password' }],
  ['POST /users/:id/password', { action: 'PASSWORD_CHANGED', entityType: 'USER', summary: 'Changed own password' }],
  ['POST /users/:id/email', { action: 'EMAIL_CHANGED', entityType: 'USER', summary: 'Changed sign-in email', template: 'Changed sign-in email to {person}' }],
  ['POST /users/:id/notifications/read', null],
  ['POST /users', { action: 'USER_CREATE', entityType: 'USER', summary: 'Created a member', template: 'Created member {person}' }],
  ['PATCH /users/:id', { action: 'USER_UPDATE', entityType: 'USER', summary: 'Updated a member', template: 'Updated member {person}' }],
  ['DELETE /users/:id', { action: 'USER_DELETE', entityType: 'USER', summary: 'Deleted a member', template: 'Deleted member {person}' }],
  ['POST /accounts', { action: 'ACCOUNT_CREATE', entityType: 'ACCOUNT', summary: 'Opened an account', template: 'Opened account {account} for {person}' }],
  ['PATCH /accounts/:id', { action: 'ACCOUNT_UPDATE', entityType: 'ACCOUNT', summary: 'Updated an account', template: 'Updated account {account} of {person}' }],
  ['DELETE /accounts/:id', { action: 'ACCOUNT_DELETE', entityType: 'ACCOUNT', summary: 'Deleted an account', template: 'Deleted account {account} of {person}' }],
  ['POST /transactions/bulk', { action: 'TRANSACTION_BULK_IMPORT', entityType: 'TRANSACTION', summary: 'Imported transactions from CSV' }],
  ['POST /transactions', { action: 'TRANSACTION_CREATE', entityType: 'TRANSACTION', summary: 'Recorded a transaction', template: 'Recorded {type} of {amount} for {person}' }],
  ['PATCH /transactions/:id', { action: 'TRANSACTION_UPDATE', entityType: 'TRANSACTION', summary: 'Updated a transaction', template: 'Updated {type} of {amount} for {person}' }],
  ['DELETE /transactions/:id', { action: 'TRANSACTION_DELETE', entityType: 'TRANSACTION', summary: 'Deleted a transaction', template: 'Deleted {type} of {amount} for {person}' }],
  ['POST /loans/bulk', { action: 'LOAN_BULK_IMPORT', entityType: 'LOAN', summary: 'Imported loans from CSV' }],
  ['POST /loans/applications', { action: 'LOAN_APPLY', entityType: 'LOAN', summary: 'Applied for a loan', template: 'Applied for a loan of {amount}' }],
  ['POST /loans/:id/pay-from-savings', { action: 'LOAN_PAY_FROM_SAVINGS', entityType: 'LOAN', summary: 'Paid a loan from savings', template: 'Paid towards the loan of {amount} from the savings of {person}' }],
  ['POST /loans/:id/approve', { action: 'LOAN_APPROVE', entityType: 'LOAN', summary: 'Approved a loan application', template: 'Approved a loan of {amount} for {person}' }],
  ['POST /loans/:id/reject', { action: 'LOAN_REJECT', entityType: 'LOAN', summary: 'Declined a loan application', template: 'Declined the loan application of {amount} from {person}' }],
  ['POST /loans', { action: 'LOAN_CREATE', entityType: 'LOAN', summary: 'Created a loan', template: 'Created a loan of {amount} for {person}' }],
  ['PATCH /loans/:id', { action: 'LOAN_UPDATE', entityType: 'LOAN', summary: 'Updated a loan', template: 'Updated the loan of {amount} for {person}' }],
  ['DELETE /loans/:id', { action: 'LOAN_DELETE', entityType: 'LOAN', summary: 'Deleted a loan', template: 'Deleted the loan of {amount} for {person}' }],
  ['POST /password-resets/:id/complete', {
    action: 'PASSWORD_RESET_ISSUED', entityType: 'PASSWORD_RESET',
    summary: 'Approved a password reset (temporary password issued)',
    template: 'Approved the password reset for {person}: temporary password issued',
  }],
  ['POST /password-resets/:id/dismiss', { action: 'PASSWORD_RESET_DISMISSED', entityType: 'PASSWORD_RESET', summary: 'Dismissed a password reset request', template: 'Dismissed the password reset request from {person}' }],
];

const COMPILED_ACTIONS = ROUTE_ACTIONS.map(([route, action]) => {
  const [method, pattern] = route.split(' ');
  const regex = new RegExp(`^/api${pattern.replace(/:id/g, '([^/]+)')}/?$`);
  return { method, regex, action };
});

export function matchRoute(method: string, path: string): { action: RouteAction; entityId: string | null } | null {
  for (const entry of COMPILED_ACTIONS) {
    if (entry.method !== method) continue;
    const match = entry.regex.exec(path);
    if (!match) continue;
    return entry.action ? { action: entry.action, entityId: match[1] ?? null } : null;
  }
  return null;
}

// "Updated member Jane Smith (jane@x) (role, status)" – the subject wording, plus the fields an edit changed
export function summarize(action: RouteAction, subject: Subject | null, fields: string[] = []) {
  const base = (action.template && renderSummary(action.template, subject)) || action.summary;
  return fields.length ? `${base} (${fields.join(', ')})` : base;
}

const CHANGING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

// The id a create route answered with: { id } or { transaction: { id } } / { loan: { id } }
const createdId = (body: any): string | null => {
  if (!body || typeof body !== 'object') return null;
  return body.id ?? body.transaction?.id ?? body.loan?.id ?? body.payment?.id ?? body.account?.id ?? body.request?.id ?? null;
};

const describeChanges = (req: Request): Record<string, unknown> | null => {
  const body = req.body;
  if (!body || typeof body !== 'object' || !Object.keys(body).length) return null;
  if (Array.isArray(body.rows)) return { rows: body.rows.length };
  return body;
};

// Logs every successful change made through the REST API once the response is sent
export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!CHANGING_METHODS.has(req.method)) return next();
  const matched = matchRoute(req.method, stripQuery(req.originalUrl));

  // A deleted record can't be looked up afterwards: describe it before the route runs
  const before = matched && req.method === 'DELETE'
    ? describeSubject(matched.action.entityType, matched.entityId)
    : null;

  const originalJson = res.json.bind(res);
  res.json = (body?: any) => {
    res.locals.responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    if (res.locals.audited || res.statusCode >= 300 || !matched) return;
    const { action } = matched;
    const entityId = matched.entityId ?? createdId(res.locals.responseBody);
    const changes = describeChanges(req);
    const fields = req.method === 'PATCH' && changes ? Object.keys(changes) : [];
    void (async () => {
      const subject = before ? await before : await describeSubject(action.entityType, entityId);
      await recordAudit(req, {
        action: action.action,
        entityType: action.entityType,
        entityId,
        summary: summarize(action, subject, fields),
        changes,
        statusCode: res.statusCode,
        subject,
      });
    })();
  });

  next();
}

// Rows written before the trail named who was affected: fill in the member and the fuller wording once.
// Records deleted since then simply keep their plain summary.
export async function backfillAuditSubjects(limit = 2000) {
  try {
    const rows = await models.AuditLog.findAll({
      where: { subjectId: null, subjectName: null },
      order: [['createdAt', 'DESC']],
      limit,
    });
    let updated = 0;
    for (const row of rows) {
      const subject = await describeSubject(row.entityType, row.entityId);
      // Nothing to name: mark it so the row is not looked at again
      if (!subject) {
        await row.update({ subjectName: '' });
        continue;
      }
      // The route the row was recorded for (several routes share an action name, e.g. PASSWORD_CHANGED)
      const route = row.method && row.path ? matchRoute(row.method, row.path)?.action : null;
      const fields = row.method === 'PATCH' && row.changes ? Object.keys(row.changes) : [];
      await row.update({
        subjectId: subject.userId ?? null,
        subjectName: personLabel(subject) ?? '',
        ...(route?.template && route.action === row.action && { summary: summarize(route, subject, fields) }),
      });
      updated += 1;
    }
    if (updated) console.log(`Audit trail: named the member affected on ${updated} earlier entries`);
  } catch (error) {
    console.error('Audit subject backfill failed:', error);
  }
}
