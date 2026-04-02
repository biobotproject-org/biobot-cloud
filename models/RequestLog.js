const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RequestLog = sequelize.define('RequestLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  requestId: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true,
    index: true
  },
  readingCount: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
});

module.exports = RequestLog;