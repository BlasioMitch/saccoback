// Runs before each API test file is loaded, so every module reads these values when it is imported
import { testDatabaseUrl } from './testDatabase.mjs';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.INTERNAL_API_KEY = 'test-internal-key';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.OTP_CODE = '123456';
process.env.EMAIL_PASSWORD = 'disabled-in-test';
process.env.DEFAULT_LOAN_RATE = '10';
process.env.WEBAUTHN_RP_ID = 'localhost';
process.env.WEBAUTHN_ORIGINS = 'http://localhost:5173';
