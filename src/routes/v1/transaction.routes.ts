import { Router, Request, Response } from 'express';
import { models } from '../../models/index.js';
import { recalculateLoanSummary } from '../../lib/loans.js';
import { sendTransactionEmail } from '../../lib/mailer.js';
import { moneyFieldError } from '../../lib/money.js';

const router = Router();

// Get all transactions
router.get('/', async (req, res) => {
  const { accountId } = req.query;
  try {
  if (accountId) {
    const transactions = await models.Transaction.findAll({
      where: { accountId: accountId as string },
    });
    return res.status(200).json(transactions);
  }
    const transactions = await models.Transaction.findAll();

    return res.status(200).json(transactions);
  } catch (error) {
    console.error('Get transaction error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create transaction
router.post('/', async (req, res) => {
  try {
    const { accountId, type, amount, status, loanId } = req.body;

    const moneyError = moneyFieldError(req.body, ['amount']);
    if (moneyError) {
      return res.status(400).json({ error: moneyError });
    }

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

    if (type === 'LOAN_PAYMENT' && !(await models.Loan.findByPk(loanId))) {
      return res.status(404).json({ error: 'Loan not found' });
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
      // Balance = total owed - COMPLETED payments; also flips the loan to PAID when cleared
      await recalculateLoanSummary(loanId);
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

    // Send transaction email notification
    try {
      const owner = (account as any).owner;
      if (owner && owner.email) {
        await sendTransactionEmail({
          // email: owner.email,
          email: 'blaminsi@gmail.com',
          name: `${owner.first_name} ${owner.last_name}`,
          transactionId: newTransaction.id,
          accountNumber: account.accountNumber,
          type: newTransaction.type,
          amount: newTransaction.amount,
          status: newTransaction.status,
          date: new Date().toLocaleString(),
        });
      }
    } catch (emailError) {
      console.error('Error sending transaction email:', emailError);
      // Don't fail the request if email fails
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
    const { id } = req.params;
    const { accountId, type, amount, status, loanId } = req.body;

    const moneyError = moneyFieldError(req.body, ['amount']);
    if (moneyError) {
      return res.status(400).json({ error: moneyError });
    }

    // Find transaction by ID
    const transaction = await models.Transaction.findByPk(id);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const previous = { type: transaction.type, loanId: transaction.loanId };

    // Only fields that were sent; undefined would otherwise overwrite stored values
    const changes = Object.fromEntries(
      Object.entries({ accountId, type, amount, status, loanId }).filter(([, value]) => value !== undefined)
    );
    await transaction.update(changes);

    // Amount, status or loan of a payment may have changed: recalculate every loan it touched
    const affectedLoans = new Set<string>();
    if (previous.type === 'LOAN_PAYMENT' && previous.loanId) affectedLoans.add(previous.loanId);
    if (transaction.type === 'LOAN_PAYMENT' && transaction.loanId) affectedLoans.add(transaction.loanId);
    for (const affectedLoanId of affectedLoans) {
      await recalculateLoanSummary(affectedLoanId);
    }

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

    const { type, loanId } = transaction;

    // Delete transaction
    await transaction.destroy();

    // A removed payment no longer counts toward the loan
    if (type === 'LOAN_PAYMENT' && loanId) {
      await recalculateLoanSummary(loanId);
    }
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