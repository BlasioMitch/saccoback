import { DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
import Account from './account.js';
import Loan from './loan.js';
export var TransactionType;
(function (TransactionType) {
    TransactionType["LOAN_PAYMENT"] = "LOAN_PAYMENT";
    TransactionType["MEMBERSHIP_FEE"] = "MEMBERSHIP_FEE";
    TransactionType["SAVINGS_DEPOSIT"] = "SAVINGS_DEPOSIT";
    TransactionType["ACCOUNT_WITHDRAW"] = "ACCOUNT_WITHDRAW";
    TransactionType["CLOSURE_WITHDRAW"] = "CLOSURE_WITHDRAW";
})(TransactionType || (TransactionType = {}));
export var TransactionStatus;
(function (TransactionStatus) {
    TransactionStatus["COMPLETED"] = "COMPLETED";
    TransactionStatus["PENDING"] = "PENDING";
    TransactionStatus["FAILED"] = "FAILED";
})(TransactionStatus || (TransactionStatus = {}));
class Transaction extends BaseModel {
}
Transaction.init({
    ...baseAttributes,
    accountId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: Account,
            key: 'id',
        },
    },
    loanId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: Loan,
            key: 'id',
        },
    },
    accountName: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    type: {
        type: DataTypes.ENUM(...Object.values(TransactionType)),
        allowNull: false,
    },
    amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
    },
    status: {
        type: DataTypes.ENUM(...Object.values(TransactionStatus)),
        allowNull: false,
        defaultValue: TransactionStatus.PENDING,
    },
}, {
    sequelize,
    modelName: 'Transaction',
    tableName: 'transactions',
});
export default Transaction;
