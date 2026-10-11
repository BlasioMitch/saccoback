import { Router, Request, Response } from 'express';
import { models } from '../../models/index.js';
import { generateUniqueAccountNumber } from '../../lib/utils.js';
import { TransactionStatus, TransactionType } from '../../models/transaction.js';
import { sendAccountCreationEmail, sendInBackground } from '../../lib/mailer.js';
import { moneyFieldError } from '../../lib/money.js';

const router = Router();

// Get all accounts
router.get('/', async (req, res) => {
  const {userId, accountId } = req.query
  try {
  if (userId){
      const account = await models.Account.findOne({
        where: { userId: String(userId), is_deleted: false },
      })
      return res.status(200).json(account);
  }else if (accountId) {
    const account = await models.Account.findByPk(accountId as string)
      return res.status(200).json(account);
  }
    const accounts = await models.Account.findAll({
      where: { is_deleted: false },
    });
    return res.status(200).json(accounts);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create account
router.post('/', async (req, res) => {
  try {
    const { userId, balance, status, paidMembership } = req.body;

    const moneyError = moneyFieldError(req.body, ['balance']);
    if (moneyError) {
      return res.status(400).json({ error: moneyError });
    }
    
    // Validate input
    if (!userId ) {
      return res.status(400).json({ error: 'UserId field is required' });
    }

    // Check if user exists
    const user = await models.User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user already has an account
    if (user.hasAccount) {
      return res.status(409).json({ error: 'User already has an account' });
    }

    const accountNumber = await generateUniqueAccountNumber(user.first_name, user.last_name);

    // Create new account
    const newAccount = await models.Account.create({
      userId,
      accountNumber,
      balance,
      status,
      paidMembership
    });

    // Update user hasAccount status
    await models.User.update(
      { hasAccount: true },
      { where: { id: userId } }
    );
    // create transaction if paidMemebership is true
    if (paidMembership) {
      await models.Transaction.create({
        accountId: newAccount.id,
        accountName: newAccount.accountNumber,
        type: TransactionType.MEMBERSHIP_FEE ,
        amount: 20000,
        status: TransactionStatus.COMPLETED
      });
    }

    // create transaction if balance > 0
    if (balance > 0) {
      await models.Transaction.create({
        accountId: newAccount.id,
        accountName: newAccount.accountNumber,
        type: TransactionType.SAVINGS_DEPOSIT,
        amount: balance,
        status: TransactionStatus.COMPLETED
      });
    }

    sendInBackground('account opened', sendAccountCreationEmail({
      email: user.email,
      memberName: user.getFullName(),
      contact: user.contact,
      accountNumber,
      openedAt: newAccount.createdAt,
      openingDeposit: Number(balance) || 0,
      membershipFeePaid: Boolean(paidMembership),
    }));

    // Return created account with user details
    const fullAccount = await models.Account.findByPk(newAccount.id, {
      include: [
        {
          model: models.User,
          as: 'owner',
          attributes: ['id', 'first_name', 'last_name', 'other_name'],
        },
      ],
    });
    res.status(201).json(fullAccount);
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'SequelizeValidationError') {
        const validationError = error as any;
        return res.status(400).json({ error: 'Validation error', details: validationError.errors });
      }
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Account number already exists' });
      }
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update account
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { balance, status, paidMembership } = req.body;

    const moneyError = moneyFieldError(req.body, ['balance']);
    if (moneyError) {
      return res.status(400).json({ error: moneyError });
    }

    // Find account by ID
    const account = await models.Account.findByPk(id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Update account
    await account.update({
      balance,
      status,
      paidMembership
    });

    // Return updated account
    const updatedAccount = await models.Account.findByPk(id);
    
    res.status(200).json(updatedAccount);
  } catch (error) {
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

// Delete account
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate input
    if (!id) {
      return res.status(400).json({ error: 'Account ID is required' });
    }

    // Find account by ID
    const account = await models.Account.findByPk(id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Hard Delete account
    // await account.destroy();
    // Soft delete account
    await account.update({
      is_deleted: true,
      deleted_at: new Date(),
    });
    // Update user hasAccount status
    await models.User.update(
      { hasAccount: false },
      { where: { id: account.userId } }
    );

    res.status(200).json({ message: 'Account deleted successfully' });
  } catch (error) {
    if (error instanceof Error && error.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(400).json({ error: 'Cannot delete account with existing dependencies' });
    }
    if (error instanceof Error && error.name === 'SequelizeDatabaseError') {
      return res.status(400).json({ error: 'Database error' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;