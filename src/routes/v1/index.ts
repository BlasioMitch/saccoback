import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import accountRoutes from './account.routes.js';
import transactionRoutes from './transaction.routes.js';
import loanRoutes from './loan.routes.js';
import auditRoutes from './audit.routes.js';
import passwordResetRoutes from './passwordReset.routes.js';
import reportRoutes from './report.routes.js';
import statsRoutes from './stats.routes.js';
import idempotencyRoutes from './idempotency.routes.js';
import { DEFAULT_LOAN_RATE } from '../../lib/settings.js';

const router = Router();

// Mount routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/accounts', accountRoutes);
router.use('/transactions', transactionRoutes);
router.use('/loans', loanRoutes);
router.use('/password-resets', passwordResetRoutes);
router.use('/reports', reportRoutes);
router.use('/stats', statsRoutes);
router.use('/idempotency', idempotencyRoutes);
router.use('/', auditRoutes);

// SACCO settings the apps need (read-only)
router.get('/settings/loans', (req, res) => {
  res.json({ defaultInterestRate: DEFAULT_LOAN_RATE });
});

export default router; 