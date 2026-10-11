import { Router, Request, Response } from 'express';
import { models } from '../../models/index.js';
import { recalculateLoanSummary } from '../../lib/loans.js';
import { emailLoanCleared, emailReceipt } from '../../lib/memberEmails.js';
import { moneyFieldError } from '../../lib/money.js';
import sequelize from '../../lib/sequelize.js';
import { bulkHandler } from '../../lib/bulk.js';
import { createTransaction } from '../../services/transactions.js';
import { describeError } from '../../services/errors.js';
import { notifyTransaction } from '../../lib/notifications.js';

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
    const { transaction: newTransaction, loanCleared, loanRemaining } = await sequelize.transaction(
      (transaction) => createTransaction(req.body, { transaction })
    );

    // A receipt for the member (and the certificate when this repayment cleared their loan)
    emailReceipt(newTransaction, { loanRemaining });
    if (loanCleared && newTransaction.loanId) emailLoanCleared(newTransaction.loanId);

    res.status(201).json(newTransaction);
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

// Bulk import (CSV): rows may carry a historical createdAt; no emails are sent
router.post('/bulk', bulkHandler(async (row, transaction) => {
  const { transaction: created } = await createTransaction(row, { transaction, allowBackdate: true });
  return created.id;
}));

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

    const previous = { type: transaction.type, loanId: transaction.loanId, status: transaction.status };

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
      const recalculated = await recalculateLoanSummary(affectedLoanId);
      if (recalculated?.statusChangedToPaid) emailLoanCleared(affectedLoanId);
    }
    // e.g. a pending deposit confirmed by staff
    if (transaction.status !== previous.status) {
      await notifyTransaction(transaction, undefined, { statusChanged: true });
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