import { Model, DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
import User from './user.js';


export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  CLOSED = 'CLOSED',
}

interface AccountAttributes {
  id?: string;  // Added id field
  userId: string;
  accountNumber: string;
  balance: number;
  status: AccountStatus;
  paidMembership: boolean;
  hasLoan?: boolean
  is_deleted?: boolean;
  deleted_at?: Date;
}

class Account extends BaseModel<AccountAttributes> implements AccountAttributes {
  public userId!: string;
  public accountNumber!: string;
  public balance!: number;
  public status!: AccountStatus;
  public paidMembership!: boolean;
  public hasLoan!: boolean;
  public is_deleted?: boolean;
  public deleted_at?: Date | undefined;
}

Account.init(
  {
    ...baseAttributes,
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: User,
        key: 'id',
      },
    },
    accountNumber: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    balance: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.ENUM(...Object.values(AccountStatus)),
      allowNull: false,
      defaultValue: AccountStatus.ACTIVE,
    },
    paidMembership: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    hasLoan: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    is_deleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    sequelize,
    modelName: 'Account',
    tableName: 'accounts',
  }
);

export default Account;