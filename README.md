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

## Receiving data from nodes

Sensor nodes talk to Blues Notehub over cellular. Notehub forwards each
note to this API through a route. Set it up once per Notehub project:

1. Generate a token and put it in `.env` as `NOTEHUB_INGEST_TOKEN`:
   `openssl rand -hex 32`
2. In Notehub, open the project, then **Routes**, then **Create Route**,
   type **General HTTP/HTTPS Request/Response**.
3. URL: `https://your-api-host/ingest/notehub`
4. HTTP headers: add `Authorization` with the value `Bearer <your token>`.
5. Notefiles: **Select Notefiles** and choose `device.qo`, `data.qo`, and
   `alert.qo`. Leaving it on all files also works; the server acknowledges
   and ignores Notehub's system files.
6. Data format: **JSON**, with the default transform (the full event).

What each note does on arrival:

| Note file | Effect |
| --- | --- |
| `device.qo` | Creates the node's Device row, or updates its name and type |
| `data.qo` | Stores every reading with the node's anomaly severity and score, evaluates alert thresholds |
| `alert.qo` | Opens, updates, or closes an Incident and sends the incident email |
| anything else | Acknowledged; location and voltage from the envelope still refresh the node |

Every envelope also updates the node's last-seen time, location
(`best_lat` / `best_lon`), and Notecard supply voltage.

## Incident notifications

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_FROM`
and `ALERT_EMAIL_TO` (comma separated) in `.env`. A plain-text email goes
out when an incident is raised, when its severity or evidence changes,
and when it clears. With no SMTP host configured the server logs a line
and carries on; ingestion never fails because mail is down.

Hosts record what they found with `POST /incidents/{id}/acknowledge`
and an outcome of `fire`, `false_alarm`, `sensor_fault`, or `unknown`.

## Tests

```sh
npm test
```

Runs against an in-memory SQLite database with a captured email
transport, so no MySQL or mail server is needed. `DB_DIALECT=sqlite` is a
test convenience only; deploy on MySQL or MariaDB.

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
