import { DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
export var UserRole;
(function (UserRole) {
    UserRole["ADMIN"] = "ADMIN";
    UserRole["MANAGER"] = "MANAGER";
    UserRole["USER"] = "USER";
})(UserRole || (UserRole = {}));
export var Gender;
(function (Gender) {
    Gender["MALE"] = "MALE";
    Gender["FEMALE"] = "FEMALE";
})(Gender || (Gender = {}));
export var UserStatus;
(function (UserStatus) {
    UserStatus["ACTIVE"] = "ACTIVE";
    UserStatus["INACTIVE"] = "INACTIVE";
})(UserStatus || (UserStatus = {}));
class User extends BaseModel {
    getFullName() {
        return this.other_name
            ? `${this.first_name} ${this.other_name} ${this.last_name}`
            : `${this.first_name} ${this.last_name}`;
    }
}
User.init({
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
    gender: {
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
    is_deleted: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
    },
    deleted_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
    }
}, {
    sequelize,
    modelName: 'User',
    tableName: 'users',
});
export default User;
