import { DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
import User from './user.js';

// What a notification is about; the member categories map to one of the member's notification settings,
// STAFF_REQUEST (e.g. a password reset to handle) always reaches ADMIN and MANAGER users
export enum NotificationCategory {
  TRANSACTION = 'TRANSACTION',
  LOAN_DECISION = 'LOAN_DECISION',
  UPDATE = 'UPDATE',
  STAFF_REQUEST = 'STAFF_REQUEST',
}

// The screen a tap should open in the app
export enum NotificationTarget {
  TRANSACTION = 'TRANSACTION',
  LOAN = 'LOAN',
  PROFILE = 'PROFILE',
  SECURITY = 'SECURITY',
  PASSWORD_RESET = 'PASSWORD_RESET',
}

interface NotificationAttributes {
  id?: string;
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  targetType?: NotificationTarget | null;
  targetId?: string | null;
  readAt?: Date | null;
}

class Notification extends BaseModel<NotificationAttributes> implements NotificationAttributes {
  public id!: string;
  public userId!: string;
  public category!: NotificationCategory;
  public title!: string;
  public body!: string;
  public targetType!: NotificationTarget | null;
  public targetId!: string | null;
  public readAt!: Date | null;
}

Notification.init(
  {
    ...baseAttributes,
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: User, key: 'id' },
    },
    category: {
      type: DataTypes.ENUM(...Object.values(NotificationCategory)),
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    targetType: {
      type: DataTypes.ENUM(...Object.values(NotificationTarget)),
      allowNull: true,
    },
    targetId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    sequelize,
    modelName: 'Notification',
    tableName: 'notifications',
    indexes: [{ fields: ['userId', 'createdAt'] }],
  }
);

export default Notification;
