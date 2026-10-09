import { Model, DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
import Loan from './loan.js';
import Account from './account.js';
import User from './user.js';

export enum PaymentStatus {
  COMPLETED = 'COMPLETED',
  PENDING = 'PENDING',
  FAILED = 'FAILED',
}

interface PaymentAttributes {
  loanId: string;
  payerId: string;
  amount: number;
  status: PaymentStatus;
  date: Date;
}

class Payment extends BaseModel<PaymentAttributes> implements PaymentAttributes {
  public loanId!: string;
  public payerId!: string;
  public amount!: number;
  public status!: PaymentStatus;
  public date!: Date;
}

Payment.init(
  {
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
      type: DataTypes.BIGINT,
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
  },
  {
    sequelize,
    modelName: 'Payment',
    tableName: 'payments',
  }
);

// Define associations
Payment.belongsTo(Loan, { foreignKey: 'loanId' });
Loan.hasMany(Payment, { foreignKey: 'loanId' });

Payment.belongsTo(User, { foreignKey: 'payerId', as: 'payer' });
User.hasMany(Payment, { foreignKey: 'payerId', as: 'payments' });

export default Payment; 