import { DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
import Loan from './loan.js';
class LoanSummary extends BaseModel {
}
LoanSummary.init({
    ...baseAttributes,
    loanId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: Loan,
            key: 'id',
        },
    },
    monthlyPayment: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
    },
    totalInterest: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
    },
    remainingBalance: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
    },
}, {
    sequelize,
    modelName: 'LoanSummary',
    tableName: 'loan_summaries',
});
export default LoanSummary;
