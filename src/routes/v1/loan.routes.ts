import { Router, Request, Response } from 'express';
import { models } from '../../models/index.js';
import { recalculateLoanSummary } from '../../lib/loans.js';
import sequelize from '../../lib/sequelize.js';
import { sendLoanCreationEmail, sendLoanCompletionEmail } from '../../lib/mailer.js';
import { moneyFieldError } from '../../lib/money.js';

const router = Router();

// Get all loans
// Get all loans /loans?accountId=1
router.get('/', async (req, res) => {
  const { accountId } = req.query;
  try {
  // Summary included so reports (e.g. loan payments) need no per-loan request
  const include = [{ model: models.LoanSummary, as: 'summary' }];
  if (accountId) {
      const loans = await models.Loan.findAll({
        where: { accountId: accountId as string },
        include,
      });
      return res.status(200).json(loans);
  }
    const loans = await models.Loan.findAll({ include });
    
    return res.status(200).json(loans);
  } catch (error) {
    console.error('Get loan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a lona summary
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
    const { accountId, amount, interestRate, term, status, startDate, endDate } = req.body;

    const moneyError = moneyFieldError(req.body, ['amount']);
    if (moneyError) {
      return res.status(400).json({ error: moneyError });
    }

    // Validate input
    if (!accountId || !amount || !interestRate || !term || !status || !startDate || !endDate) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if account exists
    const account = await models.Account.findByPk(accountId, {
      include: [
        {
          model: models.User,
          as: 'owner',
          attributes: ['id', 'first_name', 'last_name', 'other_name', 'email'],
        },
      ],
    });
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Create new loan
    const newLoan = await models.Loan.create({
      accountId,
      amount,
      interestRate,
      term,
      status,
      startDate,
      endDate,
    });

    // Update Account hasLoan to true
    await models.Account.update(
      { hasLoan: true },
      { where: { id: accountId } }
    );

    // Calculate Loan Summary (same logic as edits and payments)
    const recalculated = await recalculateLoanSummary(newLoan.id);
    const monthlyPayment = Number(recalculated?.summary.monthlyPayment || 0);
    const totalInterest = Number(recalculated?.summary.totalInterest || 0);

    // Send loan creation email
    try {
      const owner = (account as any).owner;
      if (owner && owner.email) {
        await sendLoanCreationEmail({
          // email: owner.email,
          email: 'blaminsi@gmail.com',
          name: `${owner.first_name} ${owner.last_name}`,
          loanId: newLoan.id,
          accountNumber: account.accountNumber,
          loanAmount: amount,
          interestRate: interestRate,
          term: term,
          monthlyPayment: monthlyPayment,
          totalInterest: totalInterest,
          totalAmount: Number(amount) + Number(totalInterest),
        });
      }
    } catch (emailError) {
      console.error('Error sending loan creation email:', emailError);
      // Don't fail the request if email fails
    }

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
    console.error('Create loan error:', error);
    if (error instanceof Error) {
      if (error.name === 'SequelizeValidationError') {
        const validationError = error as any;
        return res.status(400).json({ error: 'Validation error', details: validationError.errors });
      }
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Loan already exists' });
      }
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

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

    // Email only on the transition to PAID, not on every save of a paid loan
    if (result?.statusChangedToPaid) {
      try {
        const owner = (loan as any).account?.owner;
        if (owner && owner.email) {
          const transactions = await models.Transaction.findAll({
            where: {
              loanId: id,
              type: 'LOAN_PAYMENT',
              status: 'COMPLETED'
            },
            order: [['createdAt', 'ASC']]
          });

          await sendLoanCompletionEmail({
            // email: owner.email,
            email:'blaminsi@gmail.com',
            name: `${owner.first_name} ${owner.last_name}`,
            loanId: loan.id,
            accountNumber: (loan as any).account.accountNumber,
            loanAmount: merged.amount,
            interestRate: merged.interestRate,
            term: merged.term,
            totalInterest: Number(result.summary.totalInterest),
            totalAmount: merged.amount + Number(result.summary.totalInterest),
            completionDate: new Date().toLocaleDateString(),
            transactions: transactions.map(t => ({
              date: new Date(t.createdAt).toLocaleDateString(),
              amount: t.amount,
              type: 'Loan Payment'
            }))
          });
        }
      } catch (emailError) {
        console.error('Error sending loan completion email:', emailError);
        // Don't fail the request if email fails
      }
    }

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
