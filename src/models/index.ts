import User from './user.js';
import Account from './account.js';
import Transaction from './transaction.js';
import Loan from './loan.js';
import Payment from './payment.js';
import sequelize from '../lib/sequelize.js';

export const models = {
    User,
    Account,
    Transaction,
    Loan,
    Payment
};

// Set up associations
models.User.hasMany(models.Account, { foreignKey: 'userId', as: 'accounts' });
models.Account.belongsTo(models.User, { foreignKey: 'userId', as: 'owner' });

models.Account.hasMany(models.Transaction, { foreignKey: 'accountId', as: 'transactions' });
models.Transaction.belongsTo(models.Account, { foreignKey: 'accountId', as: 'account' });

models.Account.hasMany(models.Loan, { foreignKey: 'accountId', as: 'loans' });
models.Loan.belongsTo(models.Account, { foreignKey: 'accountId', as: 'account' });

models.Account.hasMany(models.Payment, { foreignKey: 'accountId', as: 'payments' });
models.Payment.belongsTo(models.Account, { foreignKey: 'accountId', as: 'account' });

export const syncDatabase = async () => {
    try {
        // Alter: true will modify existing tables without dropping them
        await sequelize.sync({ alter: true });
        console.log('Database synchronized successfully');
    } catch (error) {
        console.error('Error synchronizing database:', error);
        throw error;
    }
};

export default sequelize;