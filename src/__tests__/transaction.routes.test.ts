// Mock the models at the very top
jest.mock('../models', () => ({
  models: {
    Transaction: {
      findAll: jest.fn(),
      create: jest.fn(),
      findByPk: jest.fn(),
      update: jest.fn(),
    },
    Account: {
      create: jest.fn(),
      findByPk: jest.fn(),
      update: jest.fn(),
    },
    Loan: {
      create: jest.fn(),
      findByPk: jest.fn(),
      update: jest.fn(),
    },
    LoanSummary: {
      create: jest.fn(),
      findByPk: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    },
    User: {
      create: jest.fn(),
      findByPk: jest.fn(),
    },
  },
}));

import request from 'supertest';
import express from 'express';
import transactionRouter from '../routes/v1/transaction.routes';
import { models } from '../models';
import { TransactionType, TransactionStatus } from '../models/transaction.js';
import { LoanStatus } from '../models/loan.js';

// Mock calculateRemainingBalance utility
jest.mock('../lib/utils', () => ({
  calculateRemainingBalance: jest.fn((current, payment) => current - payment),
}));

describe('Transaction Routes', () => {
  let app: express.Application;
  let authToken: string;

  const mockAccount = {
    id: 1,
    accountNumber: 'TEST123456',
    balance: 1000,
    update: jest.fn().mockResolvedValue(true),
  };
  const mockLoan = {
    id: 1,
    status: LoanStatus.ACTIVE,
    update: jest.fn().mockResolvedValue(true),
    accountId: 1,
  };
  const mockLoanSummary = {
    id: 1,
    loanId: 1,
    remainingBalance: 5000,
    update: jest.fn().mockResolvedValue(true),
  };
  const mockTransaction = {
    id: 1,
    type: TransactionType.SAVINGS_DEPOSIT,
    amount: 100,
    update: jest.fn().mockResolvedValue(true),
    destroy: jest.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/transactions', transactionRouter);
    jest.clearAllMocks();
    authToken = 'mocked.jwt.token';

    // Default mock implementations
    (models.Transaction.findAll as jest.Mock).mockResolvedValue([mockTransaction]);
    (models.Transaction.create as jest.Mock).mockImplementation((data) => Promise.resolve({ id: 1, ...data }));
    (models.Transaction.findByPk as jest.Mock).mockImplementation((id) => {
      if (id === 1 || id === '1') return Promise.resolve({ ...mockTransaction });
      return Promise.resolve(null);
    });
    (models.Account.findByPk as jest.Mock).mockResolvedValue(mockAccount);
    (models.Account.update as jest.Mock).mockResolvedValue([1]);
    (models.Loan.findByPk as jest.Mock).mockResolvedValue(mockLoan);
    (models.LoanSummary.findByPk as jest.Mock).mockResolvedValue(mockLoanSummary);
    (models.LoanSummary.findOne as jest.Mock).mockResolvedValue(mockLoanSummary);
  });

  describe('GET /api/v1/transactions', () => {
    it('should get all transactions', async () => {
      const mockTransactions = [
        { id: 1, type: TransactionType.SAVINGS_DEPOSIT, amount: 100 },
        { id: 2, type: TransactionType.LOAN_PAYMENT, amount: 200 },
      ];
      (models.Transaction.findAll as jest.Mock).mockResolvedValueOnce(mockTransactions);

      const response = await request(app)
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockTransactions);
      expect(models.Transaction.findAll).toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/transactions', () => {
    it('should create a savings deposit transaction', async () => {
      const transactionData = {
        accountId: 1,
        type: TransactionType.SAVINGS_DEPOSIT,
        amount: 500,
        status: TransactionStatus.COMPLETED,
        accountName: 'TEST123456',
      };
      (models.Transaction.create as jest.Mock).mockResolvedValueOnce({ id: 1, ...transactionData });
      (models.Account.findByPk as jest.Mock).mockResolvedValueOnce({ ...mockAccount });

      const response = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send(transactionData);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.type).toBe(TransactionType.SAVINGS_DEPOSIT);
      expect(response.body.amount).toBe(500);
      expect(models.Transaction.create).toHaveBeenCalledWith(transactionData);
    });

    it('should create a loan payment transaction', async () => {
      const transactionData = {
        accountId: 1,
        type: TransactionType.LOAN_PAYMENT,
        amount: 1000,
        status: TransactionStatus.COMPLETED,
        loanId: 1,
        accountName: 'TEST123456',
      };
      (models.Transaction.create as jest.Mock).mockResolvedValueOnce({ id: 1, ...transactionData });
      (models.LoanSummary.findOne as jest.Mock).mockResolvedValueOnce({ ...mockLoanSummary });

      const response = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send(transactionData);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.type).toBe(TransactionType.LOAN_PAYMENT);
      expect(response.body.amount).toBe(1000);
      expect(models.Transaction.create).toHaveBeenCalledWith(transactionData);
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          accountId: 1,
          type: TransactionType.SAVINGS_DEPOSIT,
          // Missing amount, status, and accountName
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('PATCH /api/v1/transactions/:id', () => {
    it('should update a transaction', async () => {
      const updateData = {
        amount: 300,
        status: TransactionStatus.COMPLETED,
      };
      (models.Transaction.findByPk as jest.Mock).mockResolvedValueOnce({
        ...mockTransaction,
        update: jest.fn().mockResolvedValue(true),
      });

      const response = await request(app)
        .patch('/api/v1/transactions/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(models.Transaction.findByPk).toHaveBeenCalledWith('1');
    });

    it('should return 404 for non-existent transaction', async () => {
      (models.Transaction.findByPk as jest.Mock).mockResolvedValueOnce(null);

      const response = await request(app)
        .patch('/api/v1/transactions/999999')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: 300,
          status: TransactionStatus.COMPLETED,
        });

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('DELETE /api/v1/transactions/:id', () => {
    it('should delete a transaction', async () => {
      (models.Transaction.findByPk as jest.Mock).mockResolvedValueOnce({
        ...mockTransaction,
        destroy: jest.fn().mockResolvedValue(true),
      });

      const response = await request(app)
        .delete('/api/v1/transactions/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
    });

    it('should return 404 for non-existent transaction', async () => {
      (models.Transaction.findByPk as jest.Mock).mockResolvedValueOnce(null);

      const response = await request(app)
        .delete('/api/v1/transactions/999999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });
  });
});