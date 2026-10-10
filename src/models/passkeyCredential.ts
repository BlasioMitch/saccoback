import { DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
import User from './user.js';

// A passkey (WebAuthn) for signing in to the web app with the computer's fingerprint reader, Windows Hello or a phone.
// Only the public key is stored. Revoked with trusted phones: password change/reset and turning 2-step on.
interface PasskeyCredentialAttributes {
  id?: string;
  userId: string;
  credentialId: string;     // base64url, as the browser reports it
  publicKey: string;        // base64url COSE public key
  counter: number;
  transports?: string[] | null;
  deviceName?: string | null;
  lastUsedAt?: Date | null;
  revokedAt?: Date | null;
}

class PasskeyCredential extends BaseModel<PasskeyCredentialAttributes> implements PasskeyCredentialAttributes {
  public userId!: string;
  public credentialId!: string;
  public publicKey!: string;
  public counter!: number;
  public transports!: string[] | null;
  public deviceName!: string | null;
  public lastUsedAt!: Date | null;
  public revokedAt!: Date | null;
}

PasskeyCredential.init(
  {
    ...baseAttributes,
    userId: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' } },
    credentialId: { type: DataTypes.STRING(512), allowNull: false, unique: true },
    publicKey: { type: DataTypes.TEXT, allowNull: false },
    counter: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    transports: { type: DataTypes.JSONB, allowNull: true },
    deviceName: { type: DataTypes.STRING(120), allowNull: true },
    lastUsedAt: { type: DataTypes.DATE, allowNull: true },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    modelName: 'PasskeyCredential',
    tableName: 'passkey_credentials',
    indexes: [{ fields: ['userId'] }],
  }
);

export default PasskeyCredential;
