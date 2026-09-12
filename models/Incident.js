const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { jsonColumn } = require('./jsonColumn');

// An Incident is one continuous anomaly episode on one node, from the
// moment the on-device detector raises it until it clears. It is the unit a
// host drives out to investigate, and the record of what they found.
const Incident = sequelize.define('Incident', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  status: {
    type: DataTypes.ENUM('open', 'closed'),
    allowNull: false,
    defaultValue: 'open'
  },
  severity: {
    type: DataTypes.STRING(16),
    allowNull: false,
    comment: 'Current severity: alert, critical, or fault'
  },
  peakSeverity: {
    type: DataTypes.STRING(16),
    allowNull: false
  },
  score: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  signals: jsonColumn('signals', { comment: 'Array of signal names currently active' }),
  readings: jsonColumn('readings', { comment: 'Sensor values at the most recent event' }),
  baseline: jsonColumn('baseline', { comment: 'Learned baselines at the most recent event' }),
  openedAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  lastEventAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  closedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  acknowledgedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  outcome: {
    type: DataTypes.ENUM('unknown', 'fire', 'false_alarm', 'sensor_fault'),
    allowNull: false,
    defaultValue: 'unknown',
    comment: 'What the host found on the drive-out'
  },
  outcomeNotes: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  indexes: [
    { fields: ['deviceId', 'status'] },
    { fields: ['openedAt'] }
  ]
});

module.exports = Incident;
