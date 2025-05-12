import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { models } from '../../models/index.js';

const router = Router();

// Get all users
router.get('/', async (req, res) => {
  try {
    const users = await models.User.findAll();
    return users
      ? res.status(200).json(users.map(user => ({
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          other_name: user.other_name,
          fullName: user.getFullName(),
          email: user.email,
          role: user.role,
          status: user.status,
          contact: user.contact,
          gender: user.gender,
          dob: user.dob,
          joinDate: user.joinDate,
          lastLogin: user.lastLogin,
          hasAccount: user.hasAccount,
        })))
      : res.status(404).json({ error: 'No users found' });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get one user profile
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const user = await models.User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const account = await models.Account.findOne({
      where: { userId: id },
    });
    if (!account) {
      return res.status(200).json({
        user: user,
        account: null,
        loans: [],
        transactions: [],
      });
    }

    let loans = await models.Loan.findAll({
      where: { accountId: account?.id },
      include: [
        {
          model: models.LoanSummary,
          as: 'summary',
          required: false,
          attributes: ['monthlyPayment', 'totalInterest', 'remainingBalance'],
        },
      ],
    });
    if (!loans) {
      loans = [];
    }

    const transactions = await models.Transaction.findAll({
      where: { accountId: account?.id },
      order: ['type'],
    });

    const groupedTransactions = transactions.reduce<Record<string, any[]>>((acc, transaction) => {
      const type = transaction.type as string;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(transaction.get({ plain: true }));
      return acc;
    }, {});

    return res.status(200).json({
      user: user,
      account,
      loans,
      transactions: groupedTransactions,
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create user
router.post('/', async (req, res) => {
  try {
    const { first_name, last_name, other_name, email, password, role, status, contact, dob, gender } = req.body;
    
    if (!first_name || !last_name || !email || !role || !status || !contact || !dob || !gender) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existingUser = await models.User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }

    const hashedPassword = password 
      ? await bcrypt.hash(password, 10)
      : await bcrypt.hash('password123', 10);

    const newUser = await models.User.create({
      first_name,
      last_name,
      other_name,
      email,
      password: hashedPassword,
      role,
      status,
      contact,
      dob,
      gender,
      joinDate: new Date(),
    });

    res.status(201).json({
      id: newUser.id,
      first_name: newUser.first_name,
      last_name: newUser.last_name,
      other_name: newUser.other_name,
      email: newUser.email,
      role: newUser.role,
      status: newUser.status,
      contact: newUser.contact,
      gender: newUser.gender,
      dob: newUser.dob,
      joinDate: newUser.joinDate,
      lastLogin: newUser.lastLogin,
      fullName: newUser.getFullName(),
      hasAccount: newUser.hasAccount,
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const user = await models.User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await user.update({
      ...req.body,
    });

    res.status(200).json({
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      other_name: user.other_name,
      email: user.email,
      role: user.role,
      status: user.status,
      contact: user.contact,
      dob: user.dob,
      gender: user.gender,
      joinDate: user.joinDate,
      lastLogin: user.lastLogin,
      hasAccount: user.hasAccount,
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const user = await models.User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await user.destroy();
    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;