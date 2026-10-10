import { DataTypes, Model } from 'sequelize';
import sequelize from '../lib/sequelize.js';
import type { KeyStatus } from '../lib/idempotency.js';

// One row per offline change the gateway has run (see lib/idempotency.ts); kept for a week
interface IdempotencyKeyAttributes {
  key: string;
  userId?: string | null;
  operation?: string | null;
  status: KeyStatus;
  response?: Record<string, unknown> | null;
  createdAt?: Date;
  updatedAt?: Date;
}

class IdempotencyKey extends Model<IdempotencyKeyAttributes> implements IdempotencyKeyAttributes {
  public key!: string;
  public userId!: string | null;
  public operation!: string | null;
  public status!: KeyStatus;
  public response!: Record<string, unknown> | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

IdempotencyKey.init(
  {
    key: { type: DataTypes.STRING(64), primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: true },
    operation: { type: DataTypes.STRING(100), allowNull: true },
    status: { type: DataTypes.ENUM('IN_PROGRESS', 'DONE'), allowNull: false, defaultValue: 'IN_PROGRESS' },
    response: { type: DataTypes.JSONB, allowNull: true },
  },
  {
    sequelize,
    modelName: 'IdempotencyKey',
    tableName: 'idempotency_keys',
    indexes: [{ fields: ['createdAt'] }],
  }
);

export default IdempotencyKey;
