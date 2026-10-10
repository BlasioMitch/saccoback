import { DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
import User from './user.js';

// A phone enrolled for fingerprint sign-in. The phone keeps the secret behind its biometric prompt;
// only a hash is stored here. Revoked on password change/reset and when 2-step verification changes.
interface TrustedDeviceAttributes {
  id?: string;
  userId: string;
  deviceName?: string | null;
  secretHash: string;
  lastUsedAt?: Date | null;
  revokedAt?: Date | null;
}

class TrustedDevice extends BaseModel<TrustedDeviceAttributes> implements TrustedDeviceAttributes {
  public userId!: string;
  public deviceName!: string | null;
  public secretHash!: string;
  public lastUsedAt!: Date | null;
  public revokedAt!: Date | null;
}

TrustedDevice.init(
  {
    ...baseAttributes,
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: User, key: 'id' },
    },
    deviceName: { type: DataTypes.STRING(100), allowNull: true },
    secretHash: { type: DataTypes.STRING, allowNull: false },
    lastUsedAt: { type: DataTypes.DATE, allowNull: true },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    modelName: 'TrustedDevice',
    tableName: 'trusted_devices',
    indexes: [{ fields: ['userId'] }],
  }
);

export default TrustedDevice;
