import { DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';

export enum AuditSource {
  WEB = 'WEB',
  MOBILE = 'MOBILE',
  SYSTEM = 'SYSTEM',
}

// One row per change or sign-in event, from the web app, the phone app or the system itself.
// Rows are only ever inserted; the actor fields are copied so the trail survives user deletes.
interface AuditLogAttributes {
  id?: string;
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  source: AuditSource;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  summary?: string | null;
  changes?: Record<string, unknown> | null;
  // The member the action was about (e.g. whose password reset was approved), for "everything that happened to X"
  subjectId?: string | null;
  subjectName?: string | null;
  // When a change queued offline was really made (it is recorded when it syncs)
  clientCreatedAt?: Date | null;
}

class AuditLog extends BaseModel<AuditLogAttributes> implements AuditLogAttributes {
  public actorId!: string | null;
  public actorEmail!: string | null;
  public actorRole!: string | null;
  public source!: AuditSource;
  public action!: string;
  public entityType!: string | null;
  public entityId!: string | null;
  public method!: string | null;
  public path!: string | null;
  public statusCode!: number | null;
  public ip!: string | null;
  public userAgent!: string | null;
  public summary!: string | null;
  public changes!: Record<string, unknown> | null;
  public subjectId!: string | null;
  public subjectName!: string | null;
  public clientCreatedAt!: Date | null;
}

AuditLog.init(
  {
    ...baseAttributes,
    actorId: { type: DataTypes.UUID, allowNull: true },
    actorEmail: { type: DataTypes.STRING, allowNull: true },
    actorRole: { type: DataTypes.STRING(20), allowNull: true },
    source: {
      type: DataTypes.ENUM(...Object.values(AuditSource)),
      allowNull: false,
      defaultValue: AuditSource.SYSTEM,
    },
    action: { type: DataTypes.STRING(64), allowNull: false },
    entityType: { type: DataTypes.STRING(40), allowNull: true },
    entityId: { type: DataTypes.STRING(64), allowNull: true },
    method: { type: DataTypes.STRING(10), allowNull: true },
    path: { type: DataTypes.STRING(255), allowNull: true },
    statusCode: { type: DataTypes.INTEGER, allowNull: true },
    ip: { type: DataTypes.STRING(64), allowNull: true },
    userAgent: { type: DataTypes.STRING(500), allowNull: true },
    summary: { type: DataTypes.STRING(500), allowNull: true },
    changes: { type: DataTypes.JSONB, allowNull: true },
    subjectId: { type: DataTypes.UUID, allowNull: true },
    subjectName: { type: DataTypes.STRING(255), allowNull: true },
    clientCreatedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    modelName: 'AuditLog',
    tableName: 'audit_logs',
    indexes: [
      { fields: ['createdAt'] },
      { fields: ['actorId', 'createdAt'] },
      { fields: ['entityType', 'entityId'] },
      { fields: ['action'] },
      { fields: ['subjectId', 'createdAt'] },
    ],
  }
);

export default AuditLog;
