const chalk = require('chalk');
const sequelize = require('./config/database');
const { createApp } = require('./app');
const notify = require('./services/notify');

const app = createApp();
const PORT = process.env.PORT || 3000;

sequelize.setDbReadyCallback(async (ready, alreadySynced) => {
  app.locals.dbReady = ready;
  if (ready && !alreadySynced) {
    try {
      await sequelize.sync({ alter: true });
      sequelize.setDbSynchronized();
      console.log(chalk.green(' Database synchronized.'));

      // Auto-seed thresholds if the table is empty
      const { AlertThreshold } = require('./models');
      const count = await AlertThreshold.count();
      if (count === 0) {
        console.log(chalk.yellow(' No alert thresholds found. Running seeder...'));
        const { seed } = require('./seeders/alert-thresholds');
        await seed();
      }
    } catch (err) {
      console.error(chalk.red(` Database sync error: ${err.message}`));
    }
  }
});

if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(chalk.blue('\n Initializing server...'));
    console.log(chalk.yellow(`✓ Server running at:      ${chalk.bold(`http://localhost:${PORT}`)}`));
    console.log(chalk.cyan(`✓ API Health Dashboard:   ${chalk.bold(`http://localhost:${PORT}/api/health/stats`)}`));
    console.log(chalk.magenta(`✓ API Docs:               ${chalk.bold(`http://localhost:${PORT}/api-docs`)}`));
    if (process.env.NOTEHUB_INGEST_TOKEN) {
      console.log(chalk.yellow('! NOTEHUB_INGEST_TOKEN is set (legacy). Prefer an ingest key created in the dashboard.'));
    } else {
      console.log(chalk.cyan('  /ingest/notehub accepts ingest-scoped API keys created in the dashboard.'));
    }
    if (!notify.isConfigured()) {
      console.log(chalk.yellow('! Email is not configured (SMTP_HOST / ALERT_EMAIL_TO): incident notifications will be skipped.'));
    }
    console.log('');
  });
}

module.exports = { app, sequelize };
