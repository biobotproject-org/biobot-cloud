// Import Sequelize and your database instance
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database'); // adjust path if needed

// Define the Device model
const Device = sequelize.define('Device', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  deviceId: {
    type: DataTypes.STRING(100),
    unique: true,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  type: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'maintenance', 'hibernation'),
    defaultValue: 'active'
  },
  lastSeen: {
    type: DataTypes.DATE
  },
  // Filled from Notehub envelopes and health notes.
  notecardUid: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: 'Blues Notecard device UID, e.g. dev:864475046123456'
  },
  latitude: {
    type: DataTypes.DECIMAL(9, 6),
    allowNull: true
  },
  longitude: {
    type: DataTypes.DECIMAL(9, 6),
    allowNull: true
  },
  lastVoltage: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    comment: 'Volts on the Notecard supply as reported by Notehub'
  },
  lastSeverity: {
    type: DataTypes.STRING(16),
    allowNull: true,
    comment: 'Most recent on-device anomaly severity: none, watch, alert, critical, fault'
  },
  lastAnomalyScore: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: true,  // nullable so existing rows without an owner still load
    references: {
      model: 'Users',
      key: 'id'
    },
    onDelete: 'SET NULL'
  }
});

module.exports = Device;