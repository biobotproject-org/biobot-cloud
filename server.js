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


const app = express();

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.use(trackApiHealth);

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const methodColor =
        req.method === 'GET' ? chalk.cyan :
            req.method === 'POST' ? chalk.green :
                req.method === 'PUT' ? chalk.yellow :
                    req.method === 'PATCH' ? chalk.magenta :
                        req.method === 'DELETE' ? chalk.red : chalk.white;
    const statusColor =
        res.statusCode >= 500 ? chalk.redBright :
            res.statusCode >= 400 ? chalk.yellowBright :
                res.statusCode >= 300 ? chalk.cyanBright :
                    chalk.greenBright;
    console.log(
        `${chalk.gray(new Date().toLocaleTimeString())} | ` +
        `${methodColor(req.method)} ${chalk.white(req.originalUrl)} ` +
        `${statusColor(res.statusCode)} ` +
        `${chalk.gray(`(${duration} ms)`)}`
    );
  });
  next();
});


app.use('/', authRoutes);
app.use('/', submitRoutes);
app.use('/', devicesRoutes);
app.use('/', readingsRoutes);
app.use('/', alertsRoutes);
app.use('/', powerStatusRoutes);
app.use('/', healthRoutes);

const PORT = process.env.PORT || 3000;

async function initialize() {
  try {
    console.log(chalk.blue('\n Initializing server...'));
    await sequelize.authenticate();
    console.log(chalk.green('✓ Database connection established successfully.'));
    await sequelize.sync({ alter: true });
    console.log(chalk.green('✓ Database synchronized.'));
    app.listen(PORT, () => {
      console.log(chalk.yellow(`\n✓ Server running at: ${chalk.bold(`http://localhost:${PORT}`)}`));
      console.log(chalk.cyan(`✓ API Health Dashboard: ${chalk.bold(`http://localhost:${PORT}/api/health/stats`)}\n`));
    });
  } catch (error) {
    console.error(chalk.red('✗ Unable to connect to the database:'), error);
  }
}

initialize();

module.exports = { app, sequelize };