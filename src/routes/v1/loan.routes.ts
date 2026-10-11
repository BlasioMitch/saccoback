import { Router, Request, Response } from 'express';
import { models } from '../../models/index.js';
import { recalculateLoanSummary } from '../../lib/loans.js';
import sequelize from '../../lib/sequelize.js';
import { emailLoanApproved, emailLoanCleared, emailReceipt } from '../../lib/memberEmails.js';
import { moneyFieldError } from '../../lib/money.js';
import { bulkHandler } from '../../lib/bulk.js';
import { applyForLoan, approveLoan, createLoan, rejectLoan } from '../../services/loans.js';
import { APPLICATION_STATUSES, LoanStatus } from '../../models/loan.js';
import { Op } from 'sequelize';
import { describeError } from '../../services/errors.js';
import { payLoanFromSavings } from '../../services/transactions.js';

const router = Router();

// Get all loans
// Get all loans /loans?accountId=1
router.get('/', async (req, res) => {
  const { accountId, status } = req.query;
  try {
  // Summary included so reports (e.g. loan payments) need no per-loan request
  const include = [{ model: models.LoanSummary, as: 'summary' }];
  // ?status=PENDING or ?status=PENDING,REJECTED selects by status (e.g. the applications page)
  if (status) {
      const statuses = String(status).split(',').map(value => value.trim().toUpperCase());
      const loans = await models.Loan.findAll({
        where: { status: statuses, ...(accountId && { accountId: accountId as string }) },
        include,
        order: [['createdAt', 'DESC']],
      });
      return res.status(200).json(loans);
  }
  // One account's history includes its applications (member app)
  if (accountId) {
      const loans = await models.Loan.findAll({
        where: { accountId: accountId as string },
        include,
      });
      return res.status(200).json(loans);
  }
    // The loan book and reports: applications never became loans
    const loans = await models.Loan.findAll({
      where: { status: { [Op.notIn]: [...APPLICATION_STATUSES] } },
      include,
    });
    
    return res.status(200).json(loans);
  } catch (error) {
    console.error('Get loan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a lona summary
// Member applications by outcome. An approved application keeps its decidedAt, which is how it is told
// apart from loans staff create directly in the loan book.
// ?view=PENDING | APPROVED | REJECTED | ALL (default PENDING)
const APPLICATION_VIEWS: Record<string, any> = {
  PENDING: { status: LoanStatus.PENDING },
  REJECTED: { status: LoanStatus.REJECTED },
  APPROVED: { status: { [Op.notIn]: [...APPLICATION_STATUSES] }, decidedAt: { [Op.ne]: null } },
  ALL: { [Op.or]: [{ status: LoanStatus.PENDING }, { decidedAt: { [Op.ne]: null } }] },
};

router.get('/applications', async (req, res) => {
  const view = String(req.query.view || 'PENDING').toUpperCase();
  if (!APPLICATION_VIEWS[view]) {
    return res.status(400).json({ error: `view must be one of ${Object.keys(APPLICATION_VIEWS).join(', ')}` });
  }
  try {
    const loans = await models.Loan.findAll({
      where: APPLICATION_VIEWS[view],
      include: [{ model: models.LoanSummary, as: 'summary' }],
      order: [['createdAt', 'DESC']],
    });
    res.status(200).json(loans);
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

router.get('/:id/summary', async (req, res) => {
  const { id } = req.params;
  try {
    if (!id) {
      return res.status(400).json({ error: 'Loan ID is required' });
    }
    const loanSummary = await models.LoanSummary.findOne({
      where: { loanId: id as string },
    });
    if (!loanSummary) {
      return res.status(404).json({ error: 'Loan summary not found' });
    }
    res.status(200).json(loanSummary);
  } catch (error) {
    console.error('Get loan summary error:', error);
    if (error instanceof Error && error.name === 'SequelizeDatabaseError') {
      return res.status(400).json({ error: 'Database error' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Create loan
router.post('/', async (req, res) => {
  try {
    const { loan: newLoan } = await sequelize.transaction(
      (transaction) => createLoan(req.body, { transaction })
    );
    // The statement (terms and repayment plan) goes to the member
    emailLoanApproved(newLoan.id);

    // Return created loan with account details and loan summary
    const loan = await models.Loan.findByPk(newLoan.id, {
      include: [
        {
          model: models.Account,
          as: 'account',
          attributes: ['id', 'accountNumber'],
          include: [
            {
              model: models.User,
              as: 'owner',
              attributes: ['first_name', 'last_name', 'other_name'],
            },
          ],
        },
        {
          model: models.LoanSummary,
          as: 'summary',
          attributes: ['monthlyPayment', 'totalInterest', 'remainingBalance'],
        },
      ],
    });

    res.status(201).json(loan);
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

// Member loan application (userId comes from the gateway session, never from the app)
router.post('/applications', async (req, res) => {
  try {
    const loan = await sequelize.transaction((transaction) => applyForLoan(req.body.userId, req.body, { transaction }));
    const created = await models.Loan.findByPk(loan.id, { include: [{ model: models.LoanSummary, as: 'summary' }] });
    res.status(201).json(created);
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

// Repay from savings: withdraws from the account and records the loan payment in one DB transaction
router.post('/:id/pay-from-savings', async (req, res) => {
  try {
    const { withdrawal, payment, loanCleared, loanRemaining } = await sequelize.transaction((transaction) => payLoanFromSavings(req.params.id, req.body, { transaction }));
    emailReceipt(payment, { loanRemaining, description: 'Paid from savings' });
    if (loanCleared) emailLoanCleared(req.params.id);
    const loan = await models.Loan.findByPk(req.params.id, { include: [{ model: models.LoanSummary, as: 'summary' }] });
    res.status(201).json({ withdrawal, payment, loan });
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

// Manager decisions on applications
router.post('/:id/approve', async (req, res) => {
  try {
    const loan = await sequelize.transaction((transaction) => approveLoan(req.params.id, req.body, { transaction }));
    emailLoanApproved(loan.id);
    const updated = await models.Loan.findByPk(loan.id, { include: [{ model: models.LoanSummary, as: 'summary' }] });
    res.status(200).json(updated);
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    const loan = await sequelize.transaction((transaction) => rejectLoan(req.params.id, req.body, { transaction }));
    res.status(200).json(loan);
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

// Bulk import (CSV): one loan per row, no emails
router.post('/bulk', bulkHandler(async (row, transaction) => {
  const { loan } = await createLoan(row, { transaction });
  return loan.id;
}));

// Update loan: merge with stored values, then recalculate interest and balance against completed payments
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const moneyError = moneyFieldError(req.body, ['amount']);
    if (moneyError) {
      return res.status(400).json({ error: moneyError });
    }

    const loan = await models.Loan.findByPk(id, {
      include: [
        {
          model: models.Account,
          as: 'account',
          attributes: ['id', 'accountNumber'],
          include: [
            {
              model: models.User,
              as: 'owner',
              attributes: ['id', 'first_name', 'last_name', 'other_name', 'email'],
            },
          ],
        },
      ],
    });
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    // Partial updates: fields not sent keep their stored values
    const editable = ['accountId', 'amount', 'interestRate', 'term', 'status', 'startDate', 'endDate'] as const;
    const changes: Record<string, unknown> = {};
    for (const field of editable) {
      if (req.body[field] !== undefined && req.body[field] !== null) changes[field] = req.body[field];
    }
    const merged = {
      amount: Number(changes.amount ?? loan.amount),
      interestRate: Number(changes.interestRate ?? loan.interestRate),
      term: Number(changes.term ?? loan.term),
      startDate: new Date((changes.startDate ?? loan.startDate) as string | Date),
      endDate: new Date((changes.endDate ?? loan.endDate) as string | Date),
    };
    if (!(merged.amount > 0)) {
      return res.status(400).json({ error: 'amount must be greater than 0' });
    }
    if (!(merged.interestRate >= 0)) {
      return res.status(400).json({ error: 'interestRate must be 0 or more' });
    }
    if (!Number.isInteger(merged.term) || merged.term < 1) {
      return res.status(400).json({ error: 'term must be a whole number of months, at least 1' });
    }
    if (!(merged.endDate > merged.startDate)) {
      return res.status(400).json({ error: 'endDate must be after startDate' });
    }

    // Loan terms and the summary change together or not at all
    const result = await sequelize.transaction(async (transaction) => {
      await loan.update(changes, { transaction });
      return recalculateLoanSummary(id, transaction);
    });

    // The certificate only on the transition to PAID, not on every save of a paid loan
    if (result?.statusChangedToPaid) emailLoanCleared(id);

    const updatedLoan = await models.Loan.findByPk(id);
    res.status(200).json(updatedLoan);
  } catch (error) {
    console.error('Update loan error:', error);
    if (error instanceof Error && error.name === 'SequelizeValidationError') {
      const validationError = error as any;
      return res.status(400).json({ error: 'Validation error', details: validationError.errors });
    }
    if (error instanceof Error && error.name === 'SequelizeDatabaseError') {
      return res.status(400).json({ error: 'Database error' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete loan
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate input
    if (!id) {
      return res.status(400).json({ error: 'Loan ID is required' });
    }

    // Find loan by ID
    const loan = await models.Loan.findByPk(id);
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    // Update the account to false for hasLoan
    await models.Account.update(
      { hasLoan: false },
      { where: { id: loan.accountId } }
    );
    // Delete loan summary
    await models.LoanSummary.destroy({
      where: { loanId: id },
    });

    // Delete loan
    await loan.destroy();
    res.status(200).json({ message: 'Loan deleted successfully' });
  } catch (error) {
    console.error('Delete loan error:', error);
    if (error instanceof Error && error.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(400).json({ error: 'Cannot delete loan with existing dependencies' });
    }
    if (error instanceof Error && error.name === 'SequelizeDatabaseError') {
      return res.status(400).json({ error: 'Database error' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/summary/', async (req, res) => {
  const summary = await models.LoanSummary.findAll( {
    include: [
      {
        model: models.Loan,
        as: 'loan',
      },
    ],
  });
  res.status(200).json(summary);
});
export default router;
