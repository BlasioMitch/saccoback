import { Model, DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
import Account from './account.js';
import Loan from './loan.js'

export enum TransactionType {
  LOAN_PAYMENT = 'LOAN_PAYMENT',
  MEMBERSHIP_FEE = 'MEMBERSHIP_FEE',
  SAVINGS_DEPOSIT = 'SAVINGS_DEPOSIT',
  ACCOUNT_WITHDRAW = 'ACCOUNT_WITHDRAW',
  CLOSURE_WITHDRAW = 'CLOSURE_WITHDRAW',
}

export enum TransactionStatus {
  COMPLETED = 'COMPLETED',
  PENDING = 'PENDING',
  FAILED = 'FAILED',
}

interface TransactionAttributes {
  accountId: string;
  accountName: string;
  type: TransactionType;
  amount: number;
  status: TransactionStatus;
  loanId?:string
  // reference?: string;
}

class Transaction extends BaseModel<TransactionAttributes> implements TransactionAttributes {
  public accountId!: string;
  public accountName!: string;
  public type!: TransactionType;
  public amount!: number;
  public status!: TransactionStatus;
  public loanId!: string
  // public reference?: string;
}

Transaction.init(
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
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM(...Object.values(TransactionStatus)),
      allowNull: false,
      defaultValue: TransactionStatus.PENDING,
    },
  },
  {
    sequelize,
    modelName: 'Transaction',
    tableName: 'transactions',
  }
);

export default Transaction; 