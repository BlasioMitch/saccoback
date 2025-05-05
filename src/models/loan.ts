import { Model, DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
import Account from './account.js';

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
  monthlyPayment?: number;
  totalInterest?: number;
  remainingBalance?: number;
  startDate: Date;
  endDate: Date;
}

class Loan extends BaseModel<LoanAttributes> implements LoanAttributes {
  public accountId!: string;
  public amount!: number;
  public interestRate!: number;
  public term!: number;
  public status!: LoanStatus;
  public monthlyPayment!: number;
  public totalInterest!: number;
  public remainingBalance!: number;
  public startDate!: Date;
  public endDate!: Date;
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
    monthlyPayment: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    totalInterest: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    remainingBalance: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
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

// Define associations
Loan.belongsTo(Account, { foreignKey: 'accountId', as: 'loanAccount' });
Account.hasMany(Loan, { foreignKey: 'accountId', as: 'accountLoans' });

export default Loan;