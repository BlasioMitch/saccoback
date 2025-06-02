// Tests for authentication routes
import request from 'supertest';
import express from 'express';
import authRouter from '../routes/v1/auth.routes.js';
import cookieParser from 'cookie-parser';
// Mock dependencies
const mockUser = {
    id: 1,
    first_name: 'John',
    last_name: 'Doe',
    other_name: 'M',
    email: 'john@example.com',
    role: 'user',
    gender: 'male',
    password: 'hashed',
    update: jest.fn().mockResolvedValue(true),
};
// Mock the models import in the route with inline definition
jest.mock('../models/index.js', () => ({
    models: {
        User: {
            findOne: jest.fn().mockImplementation((query) => {
                if (query.where.email === 'john@example.com') {
                    return Promise.resolve({
                        ...mockUser,
                        update: jest.fn().mockResolvedValue(true),
                    });
                }
                return Promise.resolve(null);
            }),
        },
    }
}));
// Mock bcrypt and jwt
jest.mock('bcryptjs', () => ({
    compare: jest.fn().mockResolvedValue(true),
}));
jest.mock('jsonwebtoken', () => ({
    sign: jest.fn(() => 'mocked.jwt.token'),
}));
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRouter);
describe('Auth Routes', () => {
    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();
    });
    describe('POST /api/auth/login', () => {
        it('should return 400 if email or password is missing', async () => {
            const res = await request(app).post('/api/auth/login').send({});
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Email and password are required');
        });
        it('should return 401 if user not found', async () => {
            const res = await request(app).post('/api/auth/login').send({ email: 'nonexistent@example.com', password: 'pass' });
            expect(res.status).toBe(401);
            expect(res.body.error).toBe('Invalid email or password');
        });
        it('should return 401 if password is invalid', async () => {
            require('bcryptjs').compare.mockResolvedValueOnce(false);
            const res = await request(app).post('/api/auth/login').send({ email: 'john@example.com', password: 'wrong' });
            expect(res.status).toBe(401);
            expect(res.body.error).toBe('Invalid email or password');
        });
        it('should return user and token on success', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ email: 'john@example.com', password: 'pass' });
            expect(res.status).toBe(200);
            expect(res.body.user).toMatchObject({
                id: 1,
                firstName: 'John',
                lastName: 'Doe',
                otherName: 'M',
                email: 'john@example.com',
                role: 'user',
                gender: 'male',
            });
            expect(res.body.token).toBe('mocked.jwt.token');
            // Check cookie settings
            const cookie = res.headers['set-cookie'][0];
            expect(cookie).toContain('token=mocked.jwt.token');
            expect(cookie).toContain('HttpOnly');
            expect(cookie).toContain('SameSite=None');
            expect(cookie).toContain('Max-Age=86400'); // 24 hours in seconds
        });
    });
    describe('POST /api/auth/logout', () => {
        it('should return logout message', async () => {
            const res = await request(app).post('/api/auth/logout');
            expect(res.status).toBe(200);
            expect(res.body.message).toMatch(/Logged out successfully/);
        });
    });
});
