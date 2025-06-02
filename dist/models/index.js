import sequelize from '../lib/sequelize.js';
import User from './user.js';
import Account from './account.js';
import Transaction from './transaction.js';
import Loan from './loan.js';
import LoanSummary from './loanSummary.js';
import { defineAssociations } from './associations.js';
// Initialize models
const models = {
    User,
    Account,
    Transaction,
    Loan,
    LoanSummary,
};
// Define associations
defineAssociations();
export { models, sequelize };
export const syncDatabase = async () => {
    try {
        // Alter: true will modify existing tables without dropping them
        await sequelize.sync({ alter: true });
        console.log('Database synchronized successfully');
    }
    catch (error) {
        console.error('Error synchronizing database:', error);
        throw error;
    }
};
