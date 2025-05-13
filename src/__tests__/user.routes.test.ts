import request from 'supertest';
import express from 'express';
import bcrypt from 'bcryptjs';

// Mock models before importing the router
jest.mock('../models/index.js', () => ({
  models: {
    User: {
      findAll: jest.fn(),
      findByPk: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
    },
    Account: {
      findOne: jest.fn(),
    },
    Loan: {
      findAll: jest.fn(),
    },
    Transaction: {
      findAll: jest.fn(),
    },
  },
}));

// Import router after mocking
import userRouter from '../routes/v1/user.routes.js';

// Mock data
const mockUser = {
  id: 1,
  first_name: 'John',
  last_name: 'Doe',
  other_name: 'M',
  email: 'john@example.com',
  role: 'user',
  status: 'active',
  contact: '1234567890',
  gender: 'male',
  dob: '1990-01-01',
  joinDate: new Date(),
  lastLogin: null,
  hasAccount: false,
  getFullName: jest.fn().mockReturnValue('John Doe'),
  update: jest.fn().mockImplementation((data) => Promise.resolve({ ...mockUser, ...data })),
  destroy: jest.fn().mockResolvedValue(true),
};

const mockAccount = {
  id: 1,
  userId: 1,
  accountNumber: '1234567890',
  balance: 1000,
  type: 'savings',
  status: 'active',
};

const mockLoan = {
  id: 1,
  accountId: 1,
  amount: 5000,
  term: 12,
  status: 'active',
  summary: {
    monthlyPayment: 450,
    totalInterest: 400,
    remainingBalance: 5000,
  },
};

const mockTransaction = {
  id: 1,
  accountId: 1,
  amount: 100,
  type: 'deposit',
  get: jest.fn().mockReturnValue({ plain: true }),
};

// Import models after mocking
import { models } from '../models/index.js';

// Set up mock implementations with proper types
(models.User.findAll as jest.Mock).mockResolvedValue([mockUser]);
(models.User.findByPk as jest.Mock).mockImplementation((id: string | number) => {
  if (id === '1') return Promise.resolve(mockUser);
  return Promise.resolve(null);
});
(models.User.findOne as jest.Mock).mockImplementation(({ where }: { where: { email: string } }) => {
  if (where.email === 'john@example.com') return Promise.resolve(mockUser);
  return Promise.resolve(null);
});
(models.User.create as jest.Mock).mockImplementation((data: any) => Promise.resolve({ ...mockUser, ...data }));
(models.Account.findOne as jest.Mock).mockResolvedValue(mockAccount);
(models.Loan.findAll as jest.Mock).mockResolvedValue([mockLoan]);
(models.Transaction.findAll as jest.Mock).mockResolvedValue([mockTransaction]);

// Mock bcrypt
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashedPassword'),
}));

const app = express();
app.use(express.json());
app.use('/api/users', userRouter);

describe('User Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/users', () => {
    it('should return all users', async () => {
      const res = await request(app).get('/api/users');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        id: 1,
        first_name: 'John',
        last_name: 'Doe',
        email: 'john@example.com',
      });
    });

    it('should return 404 if no users found', async () => {
      (models.User.findAll as jest.Mock).mockResolvedValueOnce(null);
      const res = await request(app).get('/api/users');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('No users found');
    });
  });

  describe('GET /api/users/:id', () => {
    it('should return user profile with account and transactions', async () => {
      const res = await request(app).get('/api/users/1');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        user: {
          id: 1,
          first_name: 'John',
          last_name: 'Doe',
          email: 'john@example.com',
          role: 'user',
          status: 'active',
          contact: '1234567890',
          gender: 'male',
          dob: '1990-01-01',
          hasAccount: false,
        },
        account: mockAccount,
        loans: [mockLoan],
        transactions: {
          deposit: [{ plain: true }],
        },
      });
    });

    it('should return 404 if user not found', async () => {
      const res = await request(app).get('/api/users/999');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('User not found');
    });

    it('should return all users if id is missing', async () => {
      const res = await request(app).get('/api/users/');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/users', () => {
    const newUser = {
      first_name: 'Jane',
      last_name: 'Smith',
      other_name: 'J',
      email: 'jane@example.com',
      password: 'password123',
      role: 'user',
      status: 'active',
      contact: '0987654321',
      dob: '1992-01-01',
      gender: 'female',
    };

    it('should create a new user', async () => {
      const res = await request(app).post('/api/users').send(newUser);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        first_name: 'Jane',
        last_name: 'Smith',
        email: 'jane@example.com',
      });
      expect(bcrypt.hash).toHaveBeenCalled();
    });

    it('should return 400 if required fields are missing', async () => {
      const res = await request(app).post('/api/users').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('All fields are required');
    });

    it('should return 409 if user already exists', async () => {
      (models.User.findOne as jest.Mock).mockResolvedValueOnce(mockUser);
      const res = await request(app).post('/api/users').send(newUser);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('User already exists');
    });
  });

  describe('PATCH /api/users/:id', () => {
    it('should update user', async () => {
      const updates = {
        first_name: 'Johnny',
        last_name: 'Doe',
      };
      (mockUser.update as jest.Mock).mockImplementationOnce((data) => {
        Object.assign(mockUser, data);
        return Promise.resolve(mockUser);
      });
      const res = await request(app).patch('/api/users/1').send(updates);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        first_name: 'Johnny',
        last_name: 'Doe',
      });
    });

    it('should return 404 if user not found', async () => {
      const res = await request(app).patch('/api/users/999').send({});
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('User not found');
    });

    it('should return 404 if id is missing', async () => {
      const res = await request(app).patch('/api/users/').send({});
      expect(res.status).toBe(404); // Express treats this as a 404
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('should delete user', async () => {
      const res = await request(app).delete('/api/users/1');
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('User deleted successfully');
    });

    it('should return 404 if user not found', async () => {
      const res = await request(app).delete('/api/users/999');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('User not found');
    });

    it('should return 404 if id is missing', async () => {
      const res = await request(app).delete('/api/users/');
      expect(res.status).toBe(404); // Express treats this as a 404
    });
  });
}); 