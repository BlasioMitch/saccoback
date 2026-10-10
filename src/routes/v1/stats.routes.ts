import { Router } from 'express';
import { dashboardStats } from '../../services/stats.js';
import { describeError } from '../../services/errors.js';

// Staff dashboard figures (role enforced by the gateway). GET /stats/dashboard?range=3M|6M|1Y|ALL
const router = Router();

router.get('/dashboard', async (req, res) => {
  try {
    res.json(await dashboardStats(req.query.range));
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

export default router;
