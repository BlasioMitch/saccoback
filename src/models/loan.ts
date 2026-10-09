import { Model, DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
import Account from './account.js';
import LoanSummary from './loanSummary.js';

export enum LoanStatus {
  ACTIVE = 'ACTIVE',
  PAID = 'PAID',
  DEFAULTED = 'DEFAULTED',
}

interface LoanAttributes {
  accountId: string;
  amount: number;
  interestRate: number;
  term: number;
  status: LoanStatus;
  startDate: Date;
  endDate: Date;
  summary?: LoanSummary;
}

class Loan extends BaseModel<LoanAttributes> implements LoanAttributes {
  public accountId!: string;
  public amount!: number;
  public interestRate!: number;
  public term!: number;
  public status!: LoanStatus;
  public startDate!: Date;
  public endDate!: Date;
  public summary?: LoanSummary;
}

Loan.init(
  {
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
      type: DataTypes.BIGINT,
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
  },
  {
    sequelize,
    modelName: 'Loan',
    tableName: 'loans',
  }
);

export default Loan;