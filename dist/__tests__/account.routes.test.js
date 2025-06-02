import request from 'supertest';
import express from 'express';
import accountRouter from '../routes/v1/account.routes';
import { models } from '../models';
// Mock the models
jest.mock('../models', () => ({
    models: {
        Account: {
            findAll: jest.fn(),
            findByPk: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            destroy: jest.fn(),
            findOne: jest.fn(),
        },
        User: {
            findByPk: jest.fn(),
            update: jest.fn(),
        },
        Transaction: {
            create: jest.fn(),
        },
    },
}));
describe('Account Routes', () => {
    let app;
    const mockUser = {
        id: 1,
        first_name: 'John',
        last_name: 'Doe',
        other_name: 'Smith',
        hasAccount: false,
    };
    // Helper to return a mock account instance with methods
    function getMockAccountInstance(overrides = {}) {
        return {
            ...mockAccount,
            ...overrides,
            update: jest.fn().mockResolvedValue({ ...mockAccount, ...overrides }),
            destroy: jest.fn().mockResolvedValue(1),
        };
    }
    const mockAccount = {
        id: 1,
        userId: 1,
        accountNumber: '1234567890',
        balance: 1000,
        status: 'ACTIVE',
        paidMembership: false,
        owner: mockUser,
    };
    const newAccount = {
        userId: 1,
        balance: 1000,
        status: 'ACTIVE',
        paidMembership: false,
    };
    const updates = {
        balance: 2000,
        status: 'INACTIVE',
        paidMembership: true,
    };
    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use('/api/accounts', accountRouter);
        // Reset all mocks
        jest.clearAllMocks();
        // Setup default mock implementations
        models.User.findByPk.mockResolvedValue(mockUser);
        models.Account.findByPk.mockImplementation((id) => {
            if (id === 1 || id === '1')
                return Promise.resolve(getMockAccountInstance());
            return Promise.resolve(null);
        });
        models.Account.findAll.mockResolvedValue([mockAccount]);
        models.Account.create.mockImplementation((data) => Promise.resolve(getMockAccountInstance(data)));
        models.Account.update.mockResolvedValue([1]);
        models.Account.destroy.mockResolvedValue(1);
        models.User.update.mockResolvedValue([1]);
        models.Transaction.create.mockResolvedValue({});
        models.Account.findOne = jest.fn().mockResolvedValue(null); // for generateUniqueAccountNumber
    });
    describe('GET /api/accounts', () => {
        it('should return all accounts', async () => {
            const res = await request(app).get('/api/accounts');
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0]).toMatchObject({
                id: 1,
                accountNumber: '1234567890',
                balance: 1000,
                status: 'ACTIVE',
            });
        });
    });
    describe('POST /api/accounts', () => {
        it('should create a new account', async () => {
            const res = await request(app).post('/api/accounts').send(newAccount);
            expect(res.status).toBe(201);
            expect(res.body).toMatchObject({
                userId: 1,
                accountNumber: '1234567890',
                balance: 1000,
                status: 'ACTIVE',
            });
        });
        it('should return 400 if required fields are missing', async () => {
            const res = await request(app).post('/api/accounts').send({});
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('All fields are required');
        });
        it('should return 404 if user not found', async () => {
            models.User.findByPk.mockResolvedValueOnce(null);
            const res = await request(app).post('/api/accounts').send(newAccount);
            expect(res.status).toBe(404);
            expect(res.body.error).toBe('User not found');
        });
        it('should return 409 if user already has an account', async () => {
            models.User.findByPk.mockResolvedValueOnce({ ...mockUser, hasAccount: true });
            const res = await request(app).post('/api/accounts').send(newAccount);
            expect(res.status).toBe(409);
            expect(res.body.error).toBe('User already has an account');
        });
    });
    describe('PATCH /api/accounts/:id', () => {
        it('should update account', async () => {
            const updatedAccount = { ...mockAccount, ...updates };
            models.Account.findByPk
                .mockResolvedValueOnce(getMockAccountInstance()) // first call: before update
                .mockResolvedValueOnce(updatedAccount); // second call: after update
            const res = await request(app).patch('/api/accounts/1').send(updates);
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject(updates);
        });
        it('should return 404 if account not found', async () => {
            models.Account.findByPk.mockResolvedValueOnce(null);
            const res = await request(app).patch('/api/accounts/999').send(updates);
            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Account not found');
        });
        it('should handle validation errors', async () => {
            const validationError = new Error('Validation error');
            validationError.name = 'SequelizeValidationError';
            models.Account.findByPk.mockRejectedValueOnce(validationError);
            const res = await request(app).patch('/api/accounts/1').send(updates);
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Validation error');
        });
    });
    describe('DELETE /api/accounts/:id', () => {
        it('should delete account', async () => {
            const res = await request(app).delete('/api/accounts/1');
            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Account deleted successfully');
        });
        it('should return 404 if account not found', async () => {
            models.Account.findByPk.mockResolvedValueOnce(null);
            const res = await request(app).delete('/api/accounts/999');
            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Account not found');
        });
        it('should handle foreign key constraint errors', async () => {
            const constraintError = new Error('Foreign key constraint error');
            constraintError.name = 'SequelizeForeignKeyConstraintError';
            models.Account.findByPk.mockRejectedValueOnce(constraintError);
            const res = await request(app).delete('/api/accounts/1');
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Cannot delete account with existing dependencies');
        });
    });
});
