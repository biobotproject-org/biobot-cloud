const express = require('express');
const sequelize = require('./config/database');
const cors = require('cors');
const chalk = require('chalk');
require('./models');
const trackApiHealth = require('./middleware/trackApiHealth');
const authRoutes = require('./routes/auth');
const submitRoutes = require('./routes/submit');
const devicesRoutes = require('./routes/devices');
const readingsRoutes = require('./routes/readings');
const alertsRoutes = require('./routes/alerts');
const powerStatusRoutes = require('./routes/powerStatus');
const healthRoutes = require('./routes/health');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');

const app = express();

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());
app.use(trackApiHealth);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const methodColor =
        req.method === 'GET'    ? chalk.cyan    :
            req.method === 'POST'   ? chalk.green   :
                req.method === 'PUT'    ? chalk.yellow  :
                    req.method === 'PATCH'  ? chalk.magenta :
                        req.method === 'DELETE' ? chalk.red     : chalk.white;
    const statusColor =
        res.statusCode >= 500 ? chalk.redBright    :
            res.statusCode >= 400 ? chalk.yellowBright :
                res.statusCode >= 300 ? chalk.cyanBright   : chalk.greenBright;
    console.log(
        `${chalk.gray(new Date().toLocaleTimeString())} | ` +
        `${methodColor(req.method)} ${chalk.white(req.originalUrl)} ` +
        `${statusColor(res.statusCode)} ` +
        `${chalk.gray(`(${duration} ms)`)}`
    );
  });
  next();
});

app.use((req, res, next) => {
  if (!app.locals.dbReady) {
    return res.status(503).json({
      error: 'Service temporarily unavailable — database is reconnecting, please try again shortly.',
    });
  }
  next();
});

app.use('/', authRoutes);
app.use('/', submitRoutes);
app.use('/', devicesRoutes);
app.use('/', readingsRoutes);
app.use('/', alertsRoutes);
app.use('/', powerStatusRoutes);
app.use('/', healthRoutes);

const RECONNECT_DELAY_MS = 10_000;

async function initDatabase() {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });
    app.locals.dbReady = true;
    console.log(chalk.green(' Database connected and synchronized.'));
  } catch (err) {
    app.locals.dbReady = false;
    console.error(chalk.red(` Database unavailable: ${err.message}`));
    console.log(chalk.yellow(`  Retrying in ${RECONNECT_DELAY_MS / 1000} seconds...`));
    setTimeout(initDatabase, RECONNECT_DELAY_MS);
  }
}

sequelize.addHook('afterDisconnect', () => {
  if (app.locals.dbReady) {
    app.locals.dbReady = false;
    console.warn(chalk.yellow(' Database connection lost. Attempting to reconnect...'));
    setTimeout(initDatabase, RECONNECT_DELAY_MS);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(chalk.blue('\n Initializing server...'));
  console.log(chalk.yellow(`✓ Server running at:      ${chalk.bold(`http://localhost:${PORT}`)}`));
  console.log(chalk.cyan(`✓ API Health Dashboard:   ${chalk.bold(`http://localhost:${PORT}/api/health/stats`)}`));
  console.log(chalk.magenta(`✓ API Docs:               ${chalk.bold(`http://localhost:${PORT}/api-docs`)}\n`));
  initDatabase();
});

module.exports = { app, sequelize };