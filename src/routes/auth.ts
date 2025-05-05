import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { models } from '../models/index.js';
import { generateUniqueAccountNumber } from '../lib/utils.js';
import { where } from 'sequelize';
// import generateUniqueAccountNumber from '../lib/utils.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
interface SessionRequest extends Request {
  session?: {
    destroy: (callback: (err?: any) => void) => void;
  };
}
// Login route
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user by email
    const user = await models.User.findOne({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
    await user.update({ lastLogin: new Date() });

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Return user data and token
    res.json({
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        otherName: user.other_name,
        fullName: user.getFullName(),
        fullNameWithOtherName: user.getFullName(),
        email: user.email,
        role: user.role,
        status: user.status,
        contact: user.contact,
        gender: user.gender,
        dob: user.dob,
        joinDate: user.joinDate,
        lastLogin: user.lastLogin
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Logout
router.post('/logout', (req: SessionRequest, res:Response) => {
  if (!req.session) {
    return res.status(400).json({ error: 'Session not found' });
  }
  req.session.destroy((err: Error | null) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Internal server error, Logout failed' });
    }
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
  });
});

// Get all users
router.get('/users', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('Token received: ', token)
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
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

// Create user
router.post('/users', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('Token received: ', token)
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
        const validationError = error as any; // Type assertion for Sequelize validation error
        return res.status(400).json({ error: 'Validation error', details: validationError.errors });
      }
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Email already exists' });
      }
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});
// patch user
router.patch('/users/:id', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('Token received: ', token)
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
    // update user table
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
// Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('Token received: ', token)
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
//TODO: Update user

// Get all accounts
router.get('/accounts', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('Token received: ', token)
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const accounts = await models.Account.findAll({
      include: [
        {
          model: models.User,
          as: 'owner',
          attributes: ['id', 'first_name', 'last_name', 'other_name' ],
        },
      ],
    });

    return res.status(200).json(accounts)
  } catch (error) {
    console.error('Get account error:', error);
    if (error instanceof Error && error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create account
router.post('/accounts', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('Token received: ', token)
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const { userId, balance, status, paidMembership } = req.body;
    // Validate input
    if (!userId  || !balance || !status ) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    // Check if user exists
    const user = await models.User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    // Check if user already has an account || To remove later
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
    // Make request to return the created account with a few user details
    const fullAccount = await models.Account.findByPk(newAccount.id, {
      include: [
        {
          model: models.User,
          as: 'owner',
          attributes: ['id', 'first_name', 'last_name', 'other_name' ],
        },
      ],
    });
    // Return created account
    res.status(201).json(fullAccount);
  } catch (error) {
    console.error('Create account error:', error);
    if (error instanceof Error) {
      if (error.name === 'SequelizeValidationError') {
        const validationError = error as any; // Type assertion for Sequelize validation error
        return res.status(400).json({ error: 'Validation error', details: validationError.errors });
      }
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Account number already exists' });
      }
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete account
router.delete('/accounts/:id', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('Token received: ', token)
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
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
    // Delete account
    await account.destroy();
    // Update user hasAccount status
    await models.User.update(
      { hasAccount: false },
      { where: { id: account.userId } }
    );
    res.status(200).json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    if (error instanceof Error && error.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(400).json({ error: 'Cannot delete account with existing dependencies' });
    }
    if (error instanceof Error && error.name === 'SequelizeDatabaseError') {
      return res.status(400).json({ error: 'Database error' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/accounts/:id', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('Token received: ', token)
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
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
          attributes: ['id', 'first_name', 'last_name', 'other_name' ],
        },
      ],
    });
    res.status(200).json(updatedAccount);
  } catch (error) {
    console.error('Update account error:', error);
    if (error instanceof Error && error.name === 'SequelizeValidationError') {
      const validationError = error as any; // Type assertion for Sequelize validation error
      return res.status(400).json({ error: 'Validation error', details: validationError.errors });
    }
    if (error instanceof Error && error.name === 'SequelizeDatabaseError') {
      return res.status(400).json({ error: 'Database error' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GEt Transactions
router.get('/transactions', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('Token received: ', token)
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
router.post('/transactions', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('Token received: ', token)
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const { accountId, type, amount, status, loanId } = req.body;
    // Validate input
    if (!accountId || !type || !amount || !status) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if LoanID is attached with type Loan_Payment
    if (type === 'Loan_Payment' && !loanId) {
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
    // Return created transaction
    res.status(201).json(newTransaction);
  } catch (error) {
    console.error('Create transaction error:', error);
    if (error instanceof Error) {
      if (error.name === 'SequelizeValidationError') {
        const validationError = error as any; // Type assertion for Sequelize validation error
        return res.status(400).json({ error: 'ValidatIon error', details: validationError.errors });
      }
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Transaction already exists' });
      }
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Delete transaction
router.delete('/transactions/:id', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('Token received: ', token)
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
// Update transaction
router.patch('/transactions/:id', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('Token received: ', token)
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const { id } = req.params;
    const { accountId, type, amount, status } = req.body;
    // Find transaction by ID
    const transaction = await models.Transaction.findByPk(id);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    // Update transaction
    await transaction.update({
      accountId,
      type,
      amount,
      status,
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
      const validationError = error as any; // Type assertion for Sequelize validation error
      return res.status(400).json({ error: 'Validation error', details: validationError.errors });
    }
    if (error instanceof Error && error.name === 'SequelizeDatabaseError') {
      return res.status(400).json({ error: 'Database error' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/loans', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('Token received: ', token)
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const loans = await models.Loan.findAll({
      include: [
        {
          model: models.Account,
          as: 'account', // Updated alias to match the association
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
router.post('/loans', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('Token received: ', token)
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
    //  Update Account hasLoan to true
    await models.Account.update(
      { hasLoan: true },
      { where: { id: accountId as string } }
    );
    // Return created loan
    const loan = await models.Loan.findByPk(
      newLoan.id,
      {
      include: [
        {
          model: models.Account,
          as: 'account', // Updated alias to match the association
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

    res.status(201).json(loan);
  } catch (error) {
    console.error('Create loan error:', error);
    if (error instanceof Error) {
      if (error.name === 'SequelizeValidationError') {
        const validationError = error as any; // Type assertion for Sequelize validation error
        return res.status(400).json({ error: 'Validation error', details: validationError.errors });
      }
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Loan already exists' });
      }
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete loan
router.delete('/loans/:id', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('Token received: ', token)
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
      { where: { id: loan.accountId as string } }
    );
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
// Update loan
router.patch('/loans/:id', async (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('Token received: ', token)
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const { id } = req.params;
    const { accountId, amount, interestRate, term, status, monthlyPayment, totalInterest, remainingBalance, startDate, endDate } = req.body;
    // Find loan by ID
    const loan = await models.Loan.findByPk(id);
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    // if status is completed, update the account to false for hasLoan
    if (status === 'PAID') {
      await models.Account.update(
        { hasLoan: false },
        { where: { id: loan.accountId as string } }
      );
    }


    // Update loan
    await loan.update({
      accountId,
      amount,
      interestRate,
      term,
      status,
      monthlyPayment,
      totalInterest,
      remainingBalance,
      startDate,
      endDate,
    });
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
      ],
    });
    res.status(200).json(updatedLoan);
  } catch (error) {
    console.error('Update loan error:', error);
    if (error instanceof Error && error.name === 'SequelizeValidationError') {
      const validationError = error as any; // Type assertion for Sequelize validation error
      return res.status(400).json({ error: 'Validation error', details: validationError.errors });
    }
    if (error instanceof Error && error.name === 'SequelizeDatabaseError') {
      return res.status(400).json({ error: 'Database error' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// To return all data about a single user
router.get('/profile/:userId', async (req, res) => {
  // check for authentication
  const token = req.headers['authorization']?.split(' ')[1];
  console.log('Token received: ', token)
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  // Check if userID is provided
  const { userId } = req.params
  if(!userId){
    return res.status(400).json({error:'A userID is required'})
  }
  // fetch biodata about the user
  const user = await models.User.findByPk(userId, {attributes: { exclude: ['password'] }})
  
  // Check if user exists
  if (!user){
    return res.status(404).json({error:'User does not exist'})
  }
  
  // if user has no account return the user only otherwise return full profile
  if (!user.hasAccount) {
    return res.status(200).json({user})
  }

  // Return Account associated to the name if hasAccount is true
  const account = user.hasAccount
    ? await models.Account.findOne({ where: { userId: user.id } })
    : undefined;

    
  // Return Loans associated witth account
  const loans = await models.Loan.findAll({
    where: { accountId: account?.id},
  });
  
  // Return Transactions associated with the account
  const allTransactions = await models.Transaction.findAll({
    where: { accountId: account?.id },
  });

  // Group them by type
  const transactions = allTransactions.reduce((acc: any, transaction: any) => {
    const type = transaction.type;
    if (!acc[type]) {
      acc[type] = [];
    }
    acc[type].push(transaction);
    return acc;
  }, {});
  
  
  //  profile object def
  let profile: { 
    user: typeof user; 
    account: typeof account; 
    loans?: typeof loans; 
    transactions?:typeof transactions } = {
        user,
        account,
        loans,
        transactions
  };
  

  // the REturn response
  res.status(200).json(profile)
})


export default router;