const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AlertAcknowledgment = sequelize.define('AlertAcknowledgment', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  acknowledgedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  notes: {
    type: DataTypes.TEXT
  }
});

module.exports = AlertAcknowledgment;