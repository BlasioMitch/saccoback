import { DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
import Account from './account.js';
export var LoanStatus;
(function (LoanStatus) {
    LoanStatus["ACTIVE"] = "ACTIVE";
    LoanStatus["PAID"] = "PAID";
    LoanStatus["DEFAULTED"] = "DEFAULTED";
})(LoanStatus || (LoanStatus = {}));
class Loan extends BaseModel {
}
Loan.init({
    ...baseAttributes,
    accountId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: Account,
            key: 'id',
        },
    },
    amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
    },
    interestRate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
    },
    term: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    status: {
        type: DataTypes.ENUM(...Object.values(LoanStatus)),
        allowNull: false,
        defaultValue: LoanStatus.ACTIVE,
    },
    startDate: {
        type: DataTypes.DATE,
        allowNull: false,
    },
    endDate: {
        type: DataTypes.DATE,
        allowNull: false,
    },
}, {
    sequelize,
    modelName: 'Loan',
    tableName: 'loans',
});
export default Loan;
