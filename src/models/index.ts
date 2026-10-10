import sequelize from '../lib/sequelize.js';
import User from './user.js';
import Account from './account.js';
import Transaction from './transaction.js';
import Loan from './loan.js';
import LoanSummary from './loanSummary.js';
import Notification from './notification.js';
import AuditLog from './auditLog.js';
import PasswordResetRequest from './passwordResetRequest.js';
import TrustedDevice from './trustedDevice.js';
import PasskeyCredential from './passkeyCredential.js';
import IdempotencyKey from './idempotencyKey.js';
import { defineAssociations } from './associations.js';

// Initialize models
const models = {
    User,
    Account,
    Transaction,
    Loan,
    LoanSummary,
    Notification,
    AuditLog,
    PasswordResetRequest,
    TrustedDevice,
    PasskeyCredential,
    IdempotencyKey,
};

// Define associations
defineAssociations();

export { models, sequelize };

// sync({ alter: true }) does not reliably add new values to an existing Postgres ENUM type, so they are
// added here first (a no-op on a fresh database, where sync creates the types with every value)
const ENUM_VALUES: Record<string, string[]> = {
    enum_notifications_category: ['STAFF_REQUEST'],
    enum_notifications_targetType: ['PASSWORD_RESET'],
};

const addEnumValues = async () => {
    for (const [type, values] of Object.entries(ENUM_VALUES)) {
        const [rows] = await sequelize.query('SELECT 1 FROM pg_type WHERE typname = :type', { replacements: { type } });
        if (!rows.length) continue;
        for (const value of values) {
            await sequelize.query(`ALTER TYPE "${type}" ADD VALUE IF NOT EXISTS '${value}'`);
        }
    }
};

export const syncDatabase = async () => {
    try {
        await addEnumValues();
        // Alter: true will modify existing tables without dropping them
        await sequelize.sync({ alter: true });
        console.log('Database synchronized successfully');
    } catch (error) {   
        console.error('Error synchronizing database:', error);
        throw error;
    }
};