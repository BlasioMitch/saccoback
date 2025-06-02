import { Router } from 'express';
import { models } from '../../models/index.js';
import { generateUniqueAccountNumber } from '../../lib/utils.js';
import { TransactionStatus, TransactionType } from '../../models/transaction.js';
import { sendAccountCreationEmail } from '../../lib/mailer.js';
const router = Router();
// Get all accounts
router.get('/', async (req, res) => {
    try {
        const accounts = await models.Account.findAll({
            where: { is_deleted: false },
            include: [
                {
                    model: models.User,
                    as: 'owner',
                    attributes: ['id', 'first_name', 'last_name', 'other_name'],
                },
            ],
        });
        return res.status(200).json(accounts);
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Create account
router.post('/', async (req, res) => {
    try {
        const { userId, balance, status, paidMembership } = req.body;
        // Validate input
        if (!userId || !balance || !status) {
            return res.status(400).json({ error: 'All fields are required' });
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
        await models.User.update({ hasAccount: true }, { where: { id: userId } });
        // create transaction if paidMemebership is true
        if (paidMembership) {
            await models.Transaction.create({
                accountId: newAccount.id,
                accountName: newAccount.accountNumber,
                type: TransactionType.MEMBERSHIP_FEE,
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
        // Send account creation email
        try {
            await sendAccountCreationEmail({
                // email: user.email,
                email: 'blaminsi@gmail.com',
                name: user.getFullName(),
                accountId: accountNumber
            });
        }
        catch (emailError) {
            console.error('Error sending account creation email:', emailError);
            // Don't fail the request if email fails
        }
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
    }
    catch (error) {
        if (error instanceof Error) {
            if (error.name === 'SequelizeValidationError') {
                const validationError = error;
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
        const updatedAccount = await models.Account.findByPk(id, {
            include: [
                {
                    model: models.User,
                    as: 'owner',
                    attributes: ['id', 'first_name', 'last_name', 'other_name'],
                },
            ],
        });
        res.status(200).json(updatedAccount);
    }
    catch (error) {
        if (error instanceof Error && error.name === 'SequelizeValidationError') {
            const validationError = error;
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
        await models.User.update({ hasAccount: false }, { where: { id: account.userId } });
        res.status(200).json({ message: 'Account deleted successfully' });
    }
    catch (error) {
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
