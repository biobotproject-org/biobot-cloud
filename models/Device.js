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
  }
});

module.exports = Device;
