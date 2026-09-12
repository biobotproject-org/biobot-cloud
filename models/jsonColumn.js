const { DataTypes } = require('sequelize');

// A JSON value stored as TEXT. MariaDB has no native JSON type and the mysql
// dialect returns JSON columns as strings on it, so this keeps behaviour
// identical across MariaDB, MySQL, and SQLite.
function jsonColumn(fieldName, options = {}) {
  return {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const raw = this.getDataValue(fieldName);
      if (raw === null || raw === undefined) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    set(value) {
      this.setDataValue(fieldName, value === null || value === undefined ? null : JSON.stringify(value));
    },
    ...options,
  };
}

module.exports = { jsonColumn };
