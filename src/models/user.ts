import { Model, DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';

export enum UserRole {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  USER = 'USER',
}

export enum Gender{
  MALE='MALE',
  FEMALE='FEMALE'
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

interface UserAttributes {
  id?: string;
  first_name: string;
  last_name: string;
  other_name?: string;
  email: string;
  password: string;
  role: UserRole;
  status: UserStatus;
  lastLogin?: Date;
  joinDate: Date;
  contact: string;
  gender: Gender;
  dob: Date;
  hasAccount?: boolean;
}

class User extends BaseModel<UserAttributes> implements UserAttributes {
  public id!: string;
  public email!: string;
  public password!: string;
  public role!: UserRole;
  public status!: UserStatus;
  public lastLogin?: Date;
  public joinDate!: Date;
  public contact!: string;
  public gender!: Gender;
  public dob!: Date;
  public first_name!: string;
  public last_name!: string;
  public other_name!: string;
  hasAccount?: boolean ;
  public getFullName(): string {
    return this.other_name 
      ? `${this.first_name} ${this.other_name} ${this.last_name}`
      : `${this.first_name} ${this.last_name}`;
  }
}

User.init(
  {
    ...baseAttributes,
    first_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    last_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    other_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM(...Object.values(UserRole)),
      allowNull: false,
      defaultValue: UserRole.USER,
    },
    status: {
      type: DataTypes.ENUM(...Object.values(UserStatus)),
      allowNull: false,
      defaultValue: UserStatus.ACTIVE,
    },
    lastLogin: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    joinDate: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    contact: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    gender:{
      type: DataTypes.ENUM(...Object.values(Gender)),
      allowNull: false,
    },
    dob: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    hasAccount: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false, 
    },
  },
  {
    sequelize,
    modelName: 'User',
    tableName: 'users',
  }
);

export default User; 