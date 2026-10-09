import { Model, DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
import Account from './account.js';
import LoanSummary from './loanSummary.js';

export enum LoanStatus {
  // Member applications awaiting a manager's decision
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  PAID = 'PAID',
  DEFAULTED = 'DEFAULTED',
  REJECTED = 'REJECTED',
}

// Loans the member is currently repaying (applications and closed loans are not "open")
export const OPEN_LOAN_STATUSES: readonly LoanStatus[] = [LoanStatus.ACTIVE, LoanStatus.DEFAULTED];
// Applications never became loans: excluded from the loan book and reports
export const APPLICATION_STATUSES: readonly LoanStatus[] = [LoanStatus.PENDING, LoanStatus.REJECTED];

interface LoanAttributes {
  accountId: string;
  amount: number;
  interestRate: number;
  term: number;
  status: LoanStatus;
  startDate: Date;
  endDate: Date;
  purpose?: string | null;
  decisionNote?: string | null;
  decidedAt?: Date | null;
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
  public purpose?: string | null;
  public decisionNote?: string | null;
  public decidedAt?: Date | null;
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
    // Member's reason when applying from the app
    purpose: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // Manager's note on approval/rejection (the rejection reason is shown to the member)
    decisionNote: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    decidedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'Loan',
    tableName: 'loans',
  }
);

export default Loan;