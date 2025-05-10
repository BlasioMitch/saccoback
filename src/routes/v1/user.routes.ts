import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { models } from '../../models/index.js';


const router = Router();

// Get all users
router.get('/', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided'});
    }
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
    if (error instanceof Error && error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get one user profile
router.get('/:id', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const user = await models.User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    console.log('User found')
    
    // Fetch account details
    const account = await models.Account.findOne({
      where: { userId: id },
    });
    if (!account) {
      return res.status(200).json({
        user: user,
        account:null,
        loans:[],
        transactions:[],
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
    // If no loans return save empty list
    if (!loans) {
      loans = [];
    }
    const transactions = await models.Transaction.findAll({
      // where: { accountId: account?.id },
      where: {
        accountId: account?.id,
      },
      // attributes: ['type', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      order: ['type'],
      // raw: true, // To get plain JavaScript objects instead of Sequelize model instances
    });

    const groupedTransactions = transactions.reduce<Record<string, any[]>>((acc, transaction) => {
      const type = transaction.type as string;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(transaction.get({ plain: true })); // Use .get({ plain: true }) for cleaner objects
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
    if (error instanceof Error && error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create user
router.post('/', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const { first_name, last_name, other_name, email, password, role, status, contact, dob, gender } = req.body;
    
    // Validate input
    if (!first_name || !last_name || !email || !role || !status || !contact || !dob || !gender) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if user already exists
    const existingUser = await models.User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = password 
      ? await bcrypt.hash(password, 10)
      : await bcrypt.hash('password123', 10);

    // Create new user
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

    // Return created user
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
    if (error instanceof Error) {
      if (error.name === 'SequelizeValidationError') {
        const validationError = error as any;
        return res.status(400).json({ error: 'Validation error', details: validationError.errors });
      }
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Email already exists' });
      }
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user
router.patch('/:id', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const { id } = req.params;
    
    // Validate input
    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Find user by ID
    const user = await models.User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update user
    await user.update({
      ...req.body,
    });

    // Return updated user data
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
    if (error instanceof Error && error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user
router.delete('/:id', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const { id } = req.params;
    
    // Validate input
    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Find user by ID
    const user = await models.User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete user
    await user.destroy();
    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    if (error instanceof Error && error.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(400).json({ error: 'Cannot delete user with existing dependencies' });
    }
    if (error instanceof Error && error.name === 'SequelizeDatabaseError') {
      return res.status(400).json({ error: 'Database error' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 