import { Model, DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';

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
        model: 'loans',
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

export default LoanSummary; 