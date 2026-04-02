const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PowerEvent = sequelize.define('PowerEvent', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  eventType: {
    type: DataTypes.ENUM('outage', 'restoration', 'fluctuation'),
    allowNull: false
  },
  startTime: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  endTime: {
    type: DataTypes.DATE
  },
  duration: {
    type: DataTypes.INTEGER
  },
  affectedDevices: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
});

module.exports = PowerEvent;
