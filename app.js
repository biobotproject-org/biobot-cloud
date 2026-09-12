// Builds the Express app without connecting to a database or listening.
// server.js does the bootstrapping; tests build the app directly.
const express = require('express');
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
const ingestRoutes = require('./routes/ingest');
const incidentsRoutes = require('./routes/incidents');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');

function createApp({ requestLog = true } = {}) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(trackApiHealth);

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));

  if (requestLog) {
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
  }

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
  app.use('/', ingestRoutes);
  app.use('/', incidentsRoutes);

  return app;
}

module.exports = { createApp };
