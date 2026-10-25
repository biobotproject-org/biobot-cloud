# Wildfire Alarm — cloud API (biobot-cloud)

REST API for the Wildfire Alarm sensor network. Node.js, Express, and
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

1. In the dashboard open **API Keys**, **New key**, choose scope
   **Notehub ingest**, and copy the key once it is shown. An ingest key can
   only deliver sensor data to `POST /ingest/notehub`; it cannot read or
   change anything, and the API Keys page shows when it was last used.
   (Legacy fallback: a static `NOTEHUB_INGEST_TOKEN` in `.env` still
   works and logs a deprecation warning once per process.)
2. In Notehub, open the project, then **Routes**, then **Create Route**,
   type **General HTTP/HTTPS Request/Response**.
3. URL: `https://your-api-host/ingest/notehub`
4. HTTP headers: add `Authorization` with the value `Bearer <your ingest key>`.
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

Notehub redelivers an event whenever the route does not answer 2xx in
time. The server keys each delivery on Notehub's event id, so a repeat of
a `data.qo` stores nothing new and a repeat of an `alert.qo` neither
reopens the incident nor sends another email.

## Simulating a node

`scripts/notehub-sim.py` (Python 3, standard library only) builds Notehub
event envelopes the way Notehub does and replays a full node lifecycle
against a running API: registration, two `data.qo` batches, an incident
that is raised, escalated, de-escalated and cleared, redeliveries of both
a data and an alert event, a bad token, and a `_health.qo` system file.
Every step prints OK or FAIL against the expected response.

```sh
INGEST_TOKEN=<ingest key or NOTEHUB_INGEST_TOKEN> python3 scripts/notehub-sim.py --device biobot-002 --name "Dilworth Ridge"
INGEST_TOKEN=... python3 scripts/notehub-sim.py --device biobot-003 --name "Kalamoir" --leave-open
```

`--leave-open` stops after the escalation to critical and leaves the
incident open, which is useful when working on the incident pages.
`API_URL` overrides the default `http://localhost:3000`.

## Incident notifications

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_FROM`
and `ALERT_EMAIL_TO` (comma separated) in `.env`. A plain-text email goes
out when an incident is raised, when its severity or evidence changes,
and when it clears. With no SMTP host configured the server logs a line
and carries on; ingestion never fails because mail is down.

Hosts record what they found with `POST /incidents/{id}/acknowledge`
and an outcome of `fire`, `false_alarm`, `sensor_fault`, or `unknown`.

## Live map, wind and satellite cross-check

`GET /map` returns everything the dashboard's Live Map draws: every node
with its last position and severity, each open incident with the current
wind at the node (Open-Meteo, no key) and a 30/60/120-minute spread
envelope, and NASA FIRMS satellite hotspots within 25 km of any node.
`GET /incidents/{id}/context` gives the same for one incident.

The spread envelope is a planning aid, not a fire model: forward spread is
10% of the 10-m wind speed (Cruz & Alexander 2019) and the shape uses the
Canadian FBP length-to-breadth ratio. It ignores terrain and fuel moisture.

The satellite cross-check needs a free FIRMS key from
https://firms.modaps.eosdis.nasa.gov/api/map_key/ in `FIRMS_MAP_KEY`.
Without it the check reports `not_configured` and nothing else changes.
Weather is cached for 10 minutes per ~10 km cell, FIRMS for 15 minutes.

## Demo fire

An admin can run a scripted wildfire from the Live Map, or with
`POST /demo/fire` (optional `latitude`/`longitude`). Five nodes of type
`demo` are placed around the point using the live wind there, and about
40 seconds of Notehub notes are played through the normal ingest path.
Demo alerts never send email. `DELETE /demo` removes the demo nodes and
every row they produced. `DEMO_STEP_MS` sets the length of one scenario
second (default 1000).

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
