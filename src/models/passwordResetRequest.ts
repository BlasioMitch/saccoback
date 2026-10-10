import { DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
import User from './user.js';

export enum PasswordResetStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  DISMISSED = 'DISMISSED',
}

// A member's "Forgot password?" request, handled by an ADMIN or MANAGER who sets a temporary password
interface PasswordResetRequestAttributes {
  id?: string;
  userId: string;
  email: string;
  status: PasswordResetStatus;
  source?: string | null;
  ip?: string | null;
  // Repeat presses refresh the same pending request instead of creating new ones
  requestCount?: number;
  lastRequestedAt?: Date;
  handledById?: string | null;
  handledAt?: Date | null;
  note?: string | null;
}

class PasswordResetRequest extends BaseModel<PasswordResetRequestAttributes> implements PasswordResetRequestAttributes {
  public userId!: string;
  public email!: string;
  public status!: PasswordResetStatus;
  public source!: string | null;
  public ip!: string | null;
  public requestCount!: number;
  public lastRequestedAt!: Date;
  public handledById!: string | null;
  public handledAt!: Date | null;
  public note!: string | null;
}

PasswordResetRequest.init(
  {
    ...baseAttributes,
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: User, key: 'id' },
    },
    email: { type: DataTypes.STRING, allowNull: false },
    status: {
      type: DataTypes.ENUM(...Object.values(PasswordResetStatus)),
      allowNull: false,
      defaultValue: PasswordResetStatus.PENDING,
    },
    source: { type: DataTypes.STRING(10), allowNull: true },
    ip: { type: DataTypes.STRING(64), allowNull: true },
    requestCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    lastRequestedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    handledById: { type: DataTypes.UUID, allowNull: true },
    handledAt: { type: DataTypes.DATE, allowNull: true },
    note: { type: DataTypes.STRING(500), allowNull: true },
  },
  {
    sequelize,
    modelName: 'PasswordResetRequest',
    tableName: 'password_reset_requests',
    indexes: [{ fields: ['status', 'createdAt'] }, { fields: ['userId'] }],
  }
);

export default PasswordResetRequest;
