// Mock models (must be at the very top for jest.mock hoisting)
const mockModels = {
  Loan: {
    findAll: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation((data) => Promise.resolve({ id: 1, ...data })),
    findByPk: jest.fn().mockImplementation((id) => {
      if (id === 1) {
        return Promise.resolve({ 
          id: 1, 
          accountId: 1,
          update: jest.fn().mockResolvedValue(true),
          destroy: jest.fn().mockResolvedValue(true)
        });
      }
      return Promise.resolve(null);
    }),
    update: jest.fn().mockResolvedValue(true),
  },
  Account: {
    findByPk: jest.fn().mockResolvedValue({ 
      id: 1, 
      accountNumber: 'TEST123456',
      update: jest.fn().mockResolvedValue(true)
    }),
    update: jest.fn().mockResolvedValue(true),
  },
  LoanSummary: {
    create: jest.fn().mockResolvedValue({ 
      id: 1, 
      loanId: 1,
      monthlyPayment: 500,
      totalInterest: 1000,
      remainingBalance: 5000
    }),
    findOne: jest.fn().mockResolvedValue({ 
      id: 1, 
      loanId: 1,
      update: jest.fn().mockResolvedValue(true)
    }),
    destroy: jest.fn().mockResolvedValue(true),
  },
  User: {
    findOne: jest.fn().mockResolvedValue({ 
      id: 1, 
      first_name: 'Test',
      last_name: 'User'
    }),
  },
};

// Mock the models import so all code under test uses the mock
jest.mock('../models', () => ({
  models: mockModels
}));

import request from 'supertest';
import express from 'express';
import loanRouter from '../routes/v1/loan.routes.js';
import { LoanStatus } from '../models/loan.js';

// Mock utility functions
jest.mock('../lib/utils', () => ({
  calculateMonthlyPayment: jest.fn(() => 500),
  calculateTotalInterest: jest.fn(() => 1000),
  calculateRemainingBalance: jest.fn(() => 5000),
}));

const app = express();
app.use(express.json());
app.use('/api/loans', loanRouter);

describe('Loan Routes', () => {
  let authToken: string;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    authToken = 'mocked.jwt.token';
  });

  describe('GET /api/loans', () => {
    it('should get all loans', async () => {
      const mockLoans = [
        {
          id: 1,
          amount: 5000,
          interestRate: 10,
          term: 12,
          status: LoanStatus.ACTIVE,
          account: {
            id: 1,
            accountNumber: 'TEST123456',
            owner: {
              first_name: 'Test',
              last_name: 'User'
            }
          },
          summary: {
            monthlyPayment: 500,
            totalInterest: 1000,
            remainingBalance: 5000
          }
        }
      ];
      mockModels.Loan.findAll.mockResolvedValueOnce(mockLoans);

      const response = await request(app)
        .get('/api/loans')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockLoans);
      expect(mockModels.Loan.findAll).toHaveBeenCalled();
    });
  });

  describe('POST /api/loans', () => {
    it('should create a new loan', async () => {
      const loanData = {
        accountId: 1,
        amount: 5000,
        interestRate: 10,
        term: 12,
        status: LoanStatus.ACTIVE,
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      };

      const mockCreatedLoan = {
        id: 1,
        ...loanData,
        account: {
          id: 1,
          accountNumber: 'TEST123456',
          owner: {
            first_name: 'Test',
            last_name: 'User'
          }
        },
        summary: {
          monthlyPayment: 500,
          totalInterest: 1000,
          remainingBalance: 5000
        }
      };

      mockModels.Loan.create.mockResolvedValueOnce({ id: 1, ...loanData });
      mockModels.Loan.findByPk.mockResolvedValueOnce(mockCreatedLoan);

      const response = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${authToken}`)
        .send(loanData);

      expect(response.status).toBe(201);
      expect(response.body).toEqual(mockCreatedLoan);
      expect(mockModels.Loan.create).toHaveBeenCalledWith(loanData);
      expect(mockModels.Account.update).toHaveBeenCalledWith(
        { hasLoan: true },
        { where: { id: 1 } }
      );
      expect(mockModels.LoanSummary.create).toHaveBeenCalled();
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          accountId: 1,
          amount: 5000
          // Missing other required fields
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 404 for non-existent account', async () => {
      mockModels.Account.findByPk.mockResolvedValueOnce(null);

      const response = await request(app)
        .post('/api/loans')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          accountId: 999,
          amount: 5000,
          interestRate: 10,
          term: 12,
          status: LoanStatus.ACTIVE,
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
        });

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('PATCH /api/loans/:id', () => {
    it('should update a loan', async () => {
      const updateData = {
        amount: 6000,
        interestRate: 12,
        term: 24,
        status: LoanStatus.ACTIVE
      };

      const mockUpdatedLoan = {
        id: 1,
        ...updateData,
        account: {
          id: 1,
          accountNumber: 'TEST123456',
          owner: {
            first_name: 'Test',
            last_name: 'User'
          }
        },
        summary: {
          monthlyPayment: 600,
          totalInterest: 1200,
          remainingBalance: 6000
        }
      };

      mockModels.Loan.findByPk.mockResolvedValueOnce({
        id: 1,
        accountId: 1,
        update: jest.fn().mockResolvedValue(true)
      });
      mockModels.Loan.findByPk.mockResolvedValueOnce(mockUpdatedLoan);

      const response = await request(app)
        .patch('/api/loans/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockUpdatedLoan);
    });

    it('should update account hasLoan when loan is paid', async () => {
      const updateData = {
        status: LoanStatus.PAID
      };

      mockModels.Loan.findByPk.mockResolvedValueOnce({
        id: 1,
        accountId: 1,
        update: jest.fn().mockResolvedValue(true)
      });

      const response = await request(app)
        .patch('/api/loans/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(mockModels.Account.update).toHaveBeenCalledWith(
        { hasLoan: false },
        { where: { id: 1 } }
      );
    });

    it('should return 404 for non-existent loan', async () => {
      mockModels.Loan.findByPk.mockResolvedValueOnce(null);

      const response = await request(app)
        .patch('/api/loans/999')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: 6000
        });

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/loans/:id', () => {
    it('should delete a loan', async () => {
      mockModels.Loan.findByPk.mockResolvedValueOnce({
        id: 1,
        accountId: 1,
        destroy: jest.fn().mockResolvedValue(true)
      });

      const response = await request(app)
        .delete('/api/loans/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
      expect(mockModels.Account.update).toHaveBeenCalledWith(
        { hasLoan: false },
        { where: { id: 1 } }
      );
      expect(mockModels.LoanSummary.destroy).toHaveBeenCalled();
    });

    it('should return 404 for non-existent loan', async () => {
      mockModels.Loan.findByPk.mockResolvedValueOnce(null);

      const response = await request(app)
        .delete('/api/loans/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 404 for missing loan ID', async () => {
      const response = await request(app)
        .delete('/api/loans/')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({});
    });
  });
}); 