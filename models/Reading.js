const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Reading = sequelize.define('Reading', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  value: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  unit: {
    type: DataTypes.STRING(20),
    allowNull: false
  },
  readingType: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false
  },
  requestId: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Request ID for tracking and lookup'
  }
});

module.exports = Reading;