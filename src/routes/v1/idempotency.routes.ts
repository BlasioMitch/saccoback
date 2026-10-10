import { Router } from 'express';
import { Op } from 'sequelize';
import { models } from '../../models/index.js';
import { decideClaim, isValidKey, KEEP_FOR_DAYS } from '../../lib/idempotency.js';
import { describeError } from '../../services/errors.js';

// Used by the gateway only: claim a key before running an offline change, then store its answer
const router = Router();

router.post('/claim', async (req, res) => {
  try {
    const { key, operation } = req.body ?? {};
    if (!isValidKey(key)) return res.status(400).json({ error: 'Invalid idempotency key' });
    const userId = req.actor?.id ?? null;
    const existing = await models.IdempotencyKey.findByPk(key);
    const decision = decideClaim(existing, userId);
    if (decision.result === 'forbidden') return res.status(403).json({ error: 'This key belongs to another user' });
    if (decision.result === 'done') return res.json({ status: 'done', response: existing!.response });
    if (decision.result === 'in_progress') return res.json({ status: 'in_progress' });
    if (existing) {
      // A stale attempt that never finished: take it over
      existing.changed('updatedAt', true);
      await existing.update({ status: 'IN_PROGRESS', operation: operation ?? existing.operation });
    } else {
      try {
        await models.IdempotencyKey.create({ key, userId, operation: operation ? String(operation).slice(0, 100) : null, status: 'IN_PROGRESS' });
      } catch {
        // Another copy claimed it a moment ago
        return res.json({ status: 'in_progress' });
      }
    }
    res.json({ status: 'new' });
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

router.post('/complete', async (req, res) => {
  try {
    const { key, response } = req.body ?? {};
    if (!isValidKey(key)) return res.status(400).json({ error: 'Invalid idempotency key' });
    await models.IdempotencyKey.update({ status: 'DONE', response: response ?? null }, { where: { key } });
    res.json({ success: true });
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

// The change failed (e.g. not enough balance): forget the key so a corrected retry can run
router.post('/release', async (req, res) => {
  try {
    const { key } = req.body ?? {};
    if (!isValidKey(key)) return res.status(400).json({ error: 'Invalid idempotency key' });
    await models.IdempotencyKey.destroy({ where: { key, status: 'IN_PROGRESS' } });
    res.json({ success: true });
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

export const pruneIdempotencyKeys = () =>
  models.IdempotencyKey.destroy({ where: { createdAt: { [Op.lt]: new Date(Date.now() - KEEP_FOR_DAYS * 24 * 60 * 60 * 1000) } } })
    .catch(error => console.error('Pruning idempotency keys failed:', error));

export default router;
