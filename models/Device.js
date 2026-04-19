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