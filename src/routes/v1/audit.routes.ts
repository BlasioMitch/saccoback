import { Router } from 'express';
import { Op, WhereOptions } from 'sequelize';
import { models } from '../../models/index.js';
import { recordAudit } from '../../lib/audit.js';
import { describeError } from '../../services/errors.js';
import { findUserByEmail } from '../../services/users.js';
import { deviceEventSummary, validateDeviceEvents } from '../../lib/deviceEvents.js';

const router = Router();

// Events only the gateway sees (e.g. a sign-out clears the cookie there)
const GATEWAY_ACTIONS = new Set(['LOGOUT']);

router.post('/audit', async (req, res) => {
  const { action, summary } = req.body ?? {};
  if (!GATEWAY_ACTIONS.has(action)) return res.status(400).json({ error: 'Unknown audit action' });
  await recordAudit(req, { action, summary: typeof summary === 'string' ? summary : null, entityType: 'USER', entityId: req.actor?.id ?? null });
  res.status(201).json({ success: true });
});

// Sign-in events the phone kept while offline (see lib/deviceEvents.ts). Reported by whoever signs in next on
// that phone, so each row names the member it was about and who reported it. Each event is recorded once.
router.post('/audit/device-events', async (req, res) => {
  try {
    const events = validateDeviceEvents(req.body?.events);
    const reporter = req.actor;
    let recorded = 0;
    for (const event of events) {
      const [, created] = await models.IdempotencyKey.findOrCreate({
        where: { key: event.id },
        defaults: { key: event.id, userId: reporter?.id ?? null, operation: `DEVICE_EVENT:${event.action}`, status: 'DONE' },
      });
      if (!created) continue;
      const user = event.userId
        ? await models.User.findByPk(event.userId)
        : event.email ? await findUserByEmail(event.email) : null;
      await recordAudit(req, {
        action: event.action,
        entityType: 'USER',
        entityId: user?.id ?? null,
        summary: deviceEventSummary(event),
        actor: { id: user?.id ?? null, email: user?.email ?? event.email, role: user?.role ?? null },
        subject: user ? undefined : null,
        changes: { reportedBy: reporter?.email ?? null, deviceName: event.deviceName, method: event.method },
        statusCode: event.action === 'OFFLINE_LOGIN_FAILED' ? 401 : null,
        clientCreatedAt: event.at,
      });
      recorded += 1;
    }
    res.status(201).json({ recorded });
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

const toDate = (value: unknown, endOfDay = false) => {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}+03:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// The audit trail, newest first, filtered and paged (ADMIN only; enforced by the gateway)
router.get('/audit-logs', async (req, res) => {
  try {
    const { actorId, subjectId, action, entityType, entityId, source, q } = req.query as Record<string, string | undefined>;
    const from = toDate(req.query.from);
    const to = toDate(req.query.to, true);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const where: WhereOptions = {
      ...(actorId && { actorId }),
      ...(subjectId && { subjectId }),
      ...(action && { action }),
      ...(entityType && { entityType }),
      ...(entityId && { entityId }),
      ...(source && { source }),
      ...((from || to) && { createdAt: { ...(from && { [Op.gte]: from }), ...(to && { [Op.lte]: to }) } }),
      ...(q && {
        [Op.or]: ['summary', 'actorEmail', 'subjectName', 'path', 'entityId', 'ip'].map(field => ({ [field]: { [Op.iLike]: `%${q}%` } })),
      }),
    };

    // In the order things happened: a change made offline sits at the time it was made, not when it synced
    const happenedAt = models.AuditLog.sequelize!.literal('COALESCE("clientCreatedAt", "AuditLog"."createdAt")');
    const { rows, count } = await models.AuditLog.findAndCountAll({ where, order: [[happenedAt, 'DESC'], ['createdAt', 'DESC']], limit, offset });
    res.status(200).json({ items: rows, total: count, limit, offset });
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

// Values for the filter dropdowns
router.get('/audit-logs/facets', async (_req, res) => {
  try {
    const [actions, entityTypes, actors, subjects] = await Promise.all([
      models.AuditLog.aggregate('action', 'DISTINCT', { plain: false }),
      models.AuditLog.aggregate('entityType', 'DISTINCT', { plain: false }),
      models.AuditLog.findAll({
        attributes: ['actorId', 'actorEmail'],
        where: { actorId: { [Op.not]: null } },
        group: ['actorId', 'actorEmail'],
        order: [['actorEmail', 'ASC']],
        raw: true,
      }),
      // Members something happened to (one name per member)
      models.AuditLog.findAll({
        attributes: ['subjectId', [models.AuditLog.sequelize!.fn('MAX', models.AuditLog.sequelize!.col('subjectName')), 'subjectName']],
        where: { subjectId: { [Op.not]: null } },
        group: ['subjectId'],
        order: [[models.AuditLog.sequelize!.literal('"subjectName"'), 'ASC']],
        raw: true,
      }),
    ]);
    const values = (rows: unknown) => (rows as Array<{ DISTINCT: string | null }>).map(row => row.DISTINCT).filter(Boolean).sort();
    res.status(200).json({ actions: values(actions), entityTypes: values(entityTypes), actors, subjects });
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

export default router;
