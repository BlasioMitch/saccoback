import { Model, DataTypes } from 'sequelize';
import type { ModelStatic, ModelDefined } from 'sequelize';
import sequelize from '../lib/sequelize.js';

export class BaseModel<T extends object> extends Model<T> {
  public id!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export const baseAttributes = {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
}; 