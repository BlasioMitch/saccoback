import User from './user.js';
import Account from './account.js';
import Transaction from './transaction.js';
import Loan from './loan.js';
import LoanSummary from './loanSummary.js';
// Define all model associations
export const defineAssociations = () => {
    // User - Account associations
    User.hasMany(Account, { foreignKey: 'userId', as: 'accounts' });
    Account.belongsTo(User, { foreignKey: 'userId', as: 'owner' });
    // Account - Transaction associations
    Account.hasMany(Transaction, { foreignKey: 'accountId', as: 'transactions' });
    Transaction.belongsTo(Account, { foreignKey: 'accountId', as: 'account' });
    // Account - Loan associations
    Account.hasMany(Loan, { foreignKey: 'accountId', as: 'loans' });
    Loan.belongsTo(Account, { foreignKey: 'accountId', as: 'account' });
    // Loan - LoanSummary associations
    LoanSummary.belongsTo(Loan, { foreignKey: 'loanId', as: 'loan' });
    Loan.hasOne(LoanSummary, { foreignKey: 'loanId', as: 'summary' });
};
