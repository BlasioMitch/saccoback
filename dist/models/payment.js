import { DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
import Loan from './loan.js';
import User from './user.js';
export var PaymentStatus;
(function (PaymentStatus) {
    PaymentStatus["COMPLETED"] = "COMPLETED";
    PaymentStatus["PENDING"] = "PENDING";
    PaymentStatus["FAILED"] = "FAILED";
})(PaymentStatus || (PaymentStatus = {}));
class Payment extends BaseModel {
}
Payment.init({
    ...baseAttributes,
    loanId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: Loan,
            key: 'id',
        },
    },
    payerId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: User,
            key: 'id',
        },
    },
    amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
    },
    status: {
        type: DataTypes.ENUM(...Object.values(PaymentStatus)),
        allowNull: false,
        defaultValue: PaymentStatus.PENDING,
    },
    date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    },
}, {
    sequelize,
    modelName: 'Payment',
    tableName: 'payments',
});
// Define associations
Payment.belongsTo(Loan, { foreignKey: 'loanId' });
Loan.hasMany(Payment, { foreignKey: 'loanId' });
Payment.belongsTo(User, { foreignKey: 'payerId', as: 'payer' });
User.hasMany(Payment, { foreignKey: 'payerId', as: 'payments' });
export default Payment;
