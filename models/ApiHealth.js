const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ApiHealth = sequelize.define('ApiHealth', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  endpoint: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'API endpoint path'
  },
  method: {
    type: DataTypes.ENUM('GET', 'POST', 'PUT', 'PATCH', 'DELETE'),
    allowNull: false,
    comment: 'HTTP method'
  },
  statusCode: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'HTTP response status code'
  },
  latency: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Response time in milliseconds'
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: 'When the request was made'
  },
  userAgent: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Client user agent'
  },
  ipAddress: {
    type: DataTypes.STRING(45),
    allowNull: true,
    comment: 'Client IP address'
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Error message if request failed'
  },
  isSuccess: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'True if status code < 400 (successful request)'
  },
  isServerError: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'True if status code >= 500 (internal server error)'
  }
}, {
  tableName: 'api_health',
  timestamps: false,
  indexes: [
    { fields: ['endpoint'] },
    { fields: ['timestamp'] },
    { fields: ['statusCode'] },
    { fields: ['method'] },
    { fields: ['isServerError'] },
    { fields: ['isSuccess'] }
  ]
});

module.exports = ApiHealth;