import { Router, Request, Response } from 'express';
import { models } from '../../models/index.js';
import { calculateRemainingBalance } from '../../lib/utils.js';
import { LoanStatus } from '../../models/loan.js';

const router = Router();

// Get all transactions
router.get('/', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const transactions = await models.Transaction.findAll({
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
      ],
    });
    return res.status(200).json(transactions);
  } catch (error) {
    console.error('Get transaction error:', error);
    if (error instanceof Error && error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create transaction
router.post('/', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const { accountId, type, amount, status, loanId } = req.body;
    
    // Validate input
    if (!accountId || !type || !amount || !status) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if LoanID is attached with type Loan_Payment
    if (type === 'LOAN_PAYMENT' && !loanId) {
      return res.status(400).json({ error: 'Loan ID is required for Loan_Payment type' });
    }

    // Check if account exists
    const account = await models.Account.findByPk(accountId);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Create new transaction
    const newTransaction = await models.Transaction.create({
      accountId,
      accountName: account.accountNumber,
      type,
      amount,
      status,
      loanId
    });

    // Update the loan summary for loan payments
    if (type === 'LOAN_PAYMENT' && loanId) {
      const loanSummary = await models.LoanSummary.findOne({
        where: {loanId:loanId}});
      if (!loanSummary) {
        return res.status(404).json({ error: 'Loan summary not found' });
      }
      
      // Update remaining balance
      const newRemainingBalance = calculateRemainingBalance(loanSummary.remainingBalance, amount);
      
      // Update loan summary
      await loanSummary.update({
        remainingBalance: newRemainingBalance,
      });

      // If remaining balance is 0, update loan status to PAID
      if (newRemainingBalance <= 0) {
        const loan = await models.Loan.findByPk(loanId);
        if (loan) {
          await loan.update({ status: LoanStatus.PAID });
          await models.Account.update(
            { hasLoan: false },
            { where: { id: loan.accountId as string } }
          );
        }
      }
    } else if (
               type === 'ACCOUNT_WITHDRAW' || 
               type === 'CLOSURE_WITHDRAW') {
      await account.update({
        balance: Number(account.balance) - Number(amount),
      });
    } else if (type === 'SAVINGS_DEPOSIT') {
      await account.update({
        balance: Number(account.balance) + Number(amount),
      });
    } else if (type === 'MEMBERSHIP_FEE' ){
      await account.update({
        balance: Number(account.balance) - Number(amount),
        paidMembership: true,
      });

    }

    // Return created transaction
    res.status(201).json(newTransaction);
  } catch (error) {
    console.error('Create transaction error:', error);
    if (error instanceof Error) {
      if (error.name === 'SequelizeValidationError') {
        const validationError = error as any;
        return res.status(400).json({ error: 'Validation error', details: validationError.errors });
      }
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Transaction already exists' });
      }
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update transaction
router.patch('/:id', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const { id } = req.params;
    const { accountId, type, amount, status, loanId } = req.body;

    // Find transaction by ID
    const transaction = await models.Transaction.findByPk(id);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // If this is a loan payment, update the loan summary
    if (type === 'LOAN_PAYMENT' && loanId) {
      const loanSummary = await models.LoanSummary.findByPk(loanId);
      if (!loanSummary) {
        return res.status(404).json({ error: 'Loan summary not found' });
      }

      // Calculate the difference in amount
      const amountDifference = amount - transaction.amount;
      
      // Update remaining balance
      const newRemainingBalance = calculateRemainingBalance(loanSummary.remainingBalance, amountDifference);
      
      // Update loan summary
      await loanSummary.update({
        remainingBalance: newRemainingBalance,
      });

      // If remaining balance is 0, update loan status to PAID
      if (newRemainingBalance <= 0) {
        const loan = await models.Loan.findByPk(loanId);
        if (loan) {
          await loan.update({ status: LoanStatus.PAID });
          await models.Account.update(
            { hasLoan: false },
            { where: { id: loan.accountId as string } }
          );
        }
      }
    }

    // Update transaction
    await transaction.update({
      accountId,
      type,
      amount,
      status,
      loanId
    });

    // Return updated transaction
    const updatedTransaction = await models.Transaction.findByPk(id, {
      include: [
        {
          model: models.Account,
          as: 'account',
          attributes: ['id', 'accountNumber'],
        },
      ],
    });
    res.status(200).json(updatedTransaction);
  } catch (error) {
    console.error('Update transaction error:', error);
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

// Delete transaction
router.delete('/:id', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const { id } = req.params;
    
    // Validate input
    if (!id) {
      return res.status(400).json({ error: 'Transaction ID is required' });
    }

    // Find transaction by ID
    const transaction = await models.Transaction.findByPk(id);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Delete transaction
    await transaction.destroy();
    res.status(200).json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Delete transaction error:', error);
    if (error instanceof Error && error.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(400).json({ error: 'Cannot delete transaction with existing dependencies' });
    }
    if (error instanceof Error && error.name === 'SequelizeDatabaseError') {
      return res.status(400).json({ error: 'Database error' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 