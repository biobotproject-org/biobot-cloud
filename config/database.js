require('dotenv').config();
const { Sequelize } = require('sequelize');
const chalk = require('chalk');

const dialect = process.env.DB_DIALECT === 'sqlite' ? 'sqlite' : 'mysql';

if (dialect === 'mysql' && !process.env.DB_PASSWORD) {
  throw new Error('DB_PASSWORD is not set. Add it to .env (see .env.example).');
}

const dbConfig = {
  name: process.env.DB_NAME || 'iot_monitoring',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  showSql: process.env.SHOW_SQL === 'true',
};

const logging = dbConfig.showSql
    ? (msg) => console.log(chalk.gray(`[Sequelize] ${msg}`))
    : false;

// DB_DIALECT=sqlite runs against a local file or in-memory database. It is
// meant for tests and quick local experiments, not deployment.
const sequelize = dialect === 'sqlite'
    ? new Sequelize({
        dialect: 'sqlite',
        storage: process.env.DB_STORAGE || ':memory:',
        logging,
      })
    : new Sequelize(dbConfig.name, dbConfig.user, dbConfig.password, {
        host: dbConfig.host,
        dialect: 'mysql',
        port: dbConfig.port,
        logging,
        pool: {
          max: 5,
          min: 0,
          acquire: 30000,
          idle: 10000,
        },
      });

if (process.env.NODE_ENV !== 'test') {
console.log(chalk.cyanBright('\n Database Configuration:'));
console.table({
  'Database Name': dbConfig.name,
  'User': dbConfig.user,
  'Host': dbConfig.host,
  'Port': dbConfig.port,
  'Show SQL Logs': dbConfig.showSql,
  'Dialect': dialect,
});
}

const RECONNECT_DELAY_MS = 10_000;
let isConnected = false;
let isSynchronized = false;
let dbReadyCallback = null;

sequelize.setDbReadyCallback = function(callback) {
  dbReadyCallback = callback;
  // If we're already connected, immediately notify the new callback
  if (isConnected && dbReadyCallback) {
    dbReadyCallback(true, isSynchronized);
  }
};

sequelize.setDbSynchronized = function() {
  isSynchronized = true;
};

async function connectWithRetry() {
  try {
    await sequelize.authenticate();
    if (!isConnected) {
      isConnected = true;
      console.log(chalk.greenBright('✔ Database connection established successfully.'));
    }
    if (dbReadyCallback) {
      dbReadyCallback(true, isSynchronized);
    }
  } catch (err) {
    isConnected = false;
    isSynchronized = false;
    if (dbReadyCallback) {
      dbReadyCallback(false, false);
    }
    console.error(chalk.redBright(`✘ Unable to connect to the database: ${err.message}`));
    console.log(chalk.yellow(`  ↻ Retrying in ${RECONNECT_DELAY_MS / 1000} seconds...`));
    setTimeout(connectWithRetry, RECONNECT_DELAY_MS);
  }
}

connectWithRetry();

module.exports = sequelize;