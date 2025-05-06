import { Model, DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
import Loan from './loan.js';

interface LoanSummaryAttributes {
  loanId: string;
  monthlyPayment: number;
  totalInterest: number;
  remainingBalance: number;
}

class LoanSummary extends BaseModel<LoanSummaryAttributes> implements LoanSummaryAttributes {
  public loanId!: string;
  public monthlyPayment!: number;
  public totalInterest!: number;
  public remainingBalance!: number;
}

LoanSummary.init(
  {
    ...baseAttributes,
    loanId: {
      type: DataTypes.UUID,
      primaryKey: true,
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
  },
  {
    sequelize,
    modelName: 'LoanSummary',
    tableName: 'loan_summaries',
  }
);

// Associations
LoanSummary.belongsTo(Loan, { foreignKey: 'loanId', as: 'loan' });
Loan.hasOne(LoanSummary, { foreignKey: 'loanId', as: 'summary' });

export default LoanSummary; 