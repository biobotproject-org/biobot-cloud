const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AlertThreshold = sequelize.define('AlertThreshold', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    readingType: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: 'Matches Reading.readingType (e.g. "temperature", "humidity", "smoke")'
    },
    operator: {
        type: DataTypes.ENUM('>', '>=', '<', '<='),
        allowNull: false,
        comment: 'Comparison operator applied to the incoming reading value'
    },
    thresholdValue: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        comment: 'The value the reading is compared against'
    },
    severity: {
        type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
        allowNull: false,
        comment: 'Severity written to the Alert record'
    },
    message: {
        type: DataTypes.STRING(500),
        allowNull: false,
        comment: 'Alert message template. Use {value} and {unit} as substitution tokens.'
    },
    enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Disabled rules are loaded but skipped, allowing soft-toggle without deletion'
    }
}, {
    tableName: 'alert_thresholds',
    timestamps: true,
    indexes: [
        { fields: ['readingType'] },
        { fields: ['enabled'] }
    ]
});

module.exports = AlertThreshold;