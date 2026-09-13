const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ApiKey = sequelize.define('ApiKey', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'Users',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    name: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    key: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true
    },
    prefix: {
        type: DataTypes.STRING(8),
        allowNull: true  // nullable so existing rows without a prefix still load
    },
    lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    scope: {
        // 'user' keys act as the owning user on the whole API. 'ingest' keys
        // can only reach POST /ingest/notehub and never act as a user.
        type: DataTypes.ENUM('user', 'ingest'),
        allowNull: false,
        defaultValue: 'user'
    }
}, {
    timestamps: true,
    indexes: [
        {
            fields: ['userId']
        },
        {
            fields: ['key']
        },
        {
            fields: ['prefix']
        }
    ]
});

module.exports = ApiKey;