const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { jsonColumn } = require('./jsonColumn');

// One alert.qo note from the node: raised, updated, or cleared.
const IncidentEvent = sequelize.define('IncidentEvent', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  event: {
    type: DataTypes.ENUM('raised', 'updated', 'cleared'),
    allowNull: false
  },
  severity: {
    type: DataTypes.STRING(16),
    allowNull: false
  },
  score: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  signals: jsonColumn('signals'),
  readings: jsonColumn('readings'),
  baseline: jsonColumn('baseline'),
  occurredAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  notified: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Whether a notification was sent for this event'
  }
});

module.exports = IncidentEvent;
