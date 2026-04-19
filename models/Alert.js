const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Alert = sequelize.define('Alert', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  severity: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('active', 'acknowledged', 'resolved'),
    defaultValue: 'active'
  },
  triggeredAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  requestId: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'The UUID of the submission batch that triggered this alert'
  }
});

module.exports = Alert;
