import { DataTypes } from 'sequelize';
import { BaseModel, baseAttributes } from './base.js';
import sequelize from '../lib/sequelize.js';
import User from './user.js';
export var AccountStatus;
(function (AccountStatus) {
    AccountStatus["ACTIVE"] = "ACTIVE";
    AccountStatus["INACTIVE"] = "INACTIVE";
    AccountStatus["CLOSED"] = "CLOSED";
})(AccountStatus || (AccountStatus = {}));
class Account extends BaseModel {
}
Account.init({
    ...baseAttributes,
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: User,
            key: 'id',
        },
    },
    accountNumber: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    balance: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
    },
    status: {
        type: DataTypes.ENUM(...Object.values(AccountStatus)),
        allowNull: false,
        defaultValue: AccountStatus.ACTIVE,
    },
    paidMembership: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
    hasLoan: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
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
    },
}, {
    sequelize,
    modelName: 'Account',
    tableName: 'accounts',
});
export default Account;
