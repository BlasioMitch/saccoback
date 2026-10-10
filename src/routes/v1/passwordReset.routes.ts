import { Router } from 'express';
import { completePasswordReset, dismissPasswordReset, getPasswordReset, listPasswordResets } from '../../services/passwordResets.js';
import { describeError } from '../../services/errors.js';

// Password reset requests, handled by ADMIN and MANAGER users (role enforced by the gateway)
const router = Router();

router.get('/', async (req, res) => {
  try {
    res.json(await listPasswordResets(req.query.status ? String(req.query.status) : undefined));
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    res.json(await getPasswordReset(req.params.id));
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

router.post('/:id/complete', async (req, res) => {
  try {
    res.json(await completePasswordReset(req, req.params.id, req.body?.password));
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

router.post('/:id/dismiss', async (req, res) => {
  try {
    res.json(await dismissPasswordReset(req, req.params.id, req.body?.note));
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

export default router;
