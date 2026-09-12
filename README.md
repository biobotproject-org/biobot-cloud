# biobot-cloud

REST API for the BioBot wildfire sensor network. Node.js, Express, and
Sequelize on MySQL or MariaDB. Receives readings from sensor nodes, stores
them, evaluates alert thresholds, and serves the dashboard.

## Run locally

```sh
cp .env.example .env     # fill in DB_PASSWORD and JWT_SECRET
npm ci
npm run dev
```

Swagger UI is served at `/api-docs`. The server refuses to start if
`JWT_SECRET` or `DB_PASSWORD` is missing.

## Run with Docker

See `biobotproject-org/biobot-infrastructure` for the Compose stack.

## Security notes

- `.env` is git-ignored. Earlier revisions committed one with a real
  database password; rotate that password anywhere it was used and purge
  the file from history.
- Device deletion and status changes are limited to the device's owner or
  an admin. Health statistics require authentication because they include
  client addresses.
- The database schema is still applied with `sequelize.sync({ alter: true })`
  at startup. Replacing this with migrations is on the roadmap.
