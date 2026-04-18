require('dotenv').config();
const { Sequelize } = require('sequelize');
const chalk = require('chalk');

const dbConfig = {
  name: process.env.DB_NAME || 'iot_monitoring',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'password',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  showSql: process.env.SHOW_SQL === 'true',
};

const sequelize = new Sequelize(dbConfig.name, dbConfig.user, dbConfig.password, {
  host: dbConfig.host,
  dialect: 'mysql',
  port: dbConfig.port,
  logging: dbConfig.showSql
      ? (msg) => console.log(chalk.gray(`[Sequelize] ${msg}`))
      : false,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
});

console.log(chalk.cyanBright('\n Database Configuration:'));
console.table({
  'Database Name': dbConfig.name,
  'User': dbConfig.user,
  'Host': dbConfig.host,
  'Port': dbConfig.port,
  'Show SQL Logs': dbConfig.showSql,
});

const RECONNECT_DELAY_MS = 10_000;
let isConnected = false;

async function connectWithRetry() {
  try {
    await sequelize.authenticate();
    isConnected = true;
    console.log(chalk.greenBright('✔ Database connection established successfully.'));
  } catch (err) {
    isConnected = false;
    console.error(chalk.redBright(`✘ Unable to connect to the database: ${err.message}`));
    console.log(chalk.yellow(`  ↻ Retrying in ${RECONNECT_DELAY_MS / 1000} seconds...`));
    setTimeout(connectWithRetry, RECONNECT_DELAY_MS);
  }
}

sequelize.addHook('afterDisconnect', () => {
  if (isConnected) {
    isConnected = false;
    console.warn(chalk.yellow('⚠ Database connection lost. Attempting to reconnect...'));
    setTimeout(connectWithRetry, RECONNECT_DELAY_MS);
  }
});

connectWithRetry();

module.exports = sequelize;