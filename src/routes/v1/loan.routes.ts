import { Router, Request, Response } from 'express';
import { models } from '../../models/index.js';
import { calculateMonthlyPayment, calculateTotalInterest, calculateRemainingBalance } from '../../lib/utils.js';
import { LoanStatus } from '../../models/loan.js';

const router = Router();

// Get all loans
router.get('/', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const loans = await models.Loan.findAll({
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
          required: false,
          attributes: ['monthlyPayment', 'totalInterest', 'remainingBalance'],
        },
      ],
    });
    return res.status(200).json(loans);
  } catch (error) {
    console.error('Get loan error:', error);
    if (error instanceof Error && error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create loan
router.post('/', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const { accountId, amount, interestRate, term, status, startDate, endDate } = req.body;
    
    // Validate input
    if (!accountId || !amount || !interestRate || !term || !status || !startDate || !endDate) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if account exists
    const account = await models.Account.findByPk(accountId);
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

    // Calculate Loan Summary
    const monthlyPayment = calculateMonthlyPayment(amount, interestRate, term);
    const totalInterest = calculateTotalInterest(amount, interestRate, term);
    const remainingBalance = calculateRemainingBalance(amount, 0);

    await models.LoanSummary.create({
      loanId: newLoan.id,
      monthlyPayment,
      totalInterest,
      remainingBalance,
    });

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

// Update loan
router.patch('/:id', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const { id } = req.params;
    const { accountId, amount, interestRate, term, status, startDate, endDate } = req.body;

    // Find loan by ID
    const loan = await models.Loan.findByPk(id);
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    // If status is completed, update the account to false for hasLoan
    if (status === LoanStatus.PAID) {
      await models.Account.update(
        { hasLoan: false },
        { where: { id: loan.accountId } }
      );
    }

    // Update loan
    await loan.update({
      accountId,
      amount,
      interestRate,
      term,
      status,
      startDate,
      endDate,
    });

    // Update Loan Summary
    const loanSummary = await models.LoanSummary.findOne({
      where: { loanId: id },
    });
    if (loanSummary) {
      const monthlyPayment = calculateMonthlyPayment(amount, interestRate, term);
      const totalInterest = calculateTotalInterest(amount, interestRate, term);
      const remainingBalance = calculateRemainingBalance(amount, 0);
      await loanSummary.update({
        monthlyPayment,
        totalInterest,
        remainingBalance,
      });
    } else {
      const monthlyPayment = calculateMonthlyPayment(amount, interestRate, term);
      const totalInterest = calculateTotalInterest(amount, interestRate, term);
      const remainingBalance = calculateRemainingBalance(amount, 0);
      await models.LoanSummary.create({
        loanId: id,
        monthlyPayment,
        totalInterest,
        remainingBalance,
      });
    }

    // Return updated loan
    const updatedLoan = await models.Loan.findByPk(id, {
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
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
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