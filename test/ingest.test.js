// End-to-end tests for the Notehub ingress and incidents API.
// Runs against an in-memory SQLite database with a captured email transport.
//   npm test
process.env.NODE_ENV = 'test';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.NOTEHUB_INGEST_TOKEN = 'nh-test-token';
process.env.ALERT_EMAIL_TRANSPORT = 'json';
process.env.ALERT_EMAIL_TO = 'host@example.com';
process.env.DASHBOARD_URL = 'https://app.example.com';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const sequelize = require('../config/database');
const models = require('../models');
const { createApp } = require('../app');
const notify = require('../services/notify');

let server, base;

before(async () => {
  await sequelize.sync({ force: true });
  const app = createApp({ requestLog: false });
  app.locals.dbReady = true;
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await sequelize.close();
});

beforeEach(async () => {
  for (const m of [models.IncidentEvent, models.Incident, models.Alert, models.Reading, models.Device]) {
    await m.destroy({ where: {}, truncate: false });
  }
  notify._reset();
});

async function post(path, body, headers = {}) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
async function get(path, headers = {}) {
  const res = await fetch(base + path, { headers });
  return { status: res.status, body: await res.json() };
}
const NH = { authorization: 'Bearer nh-test-token' };

// A Notehub JSON route envelope, trimmed to the fields that matter. Every
// call gets a fresh event id, as Notehub would assign; pass extra.event to
// simulate a redelivery of the same event.
let eventCounter = 0;
function envelope(file, body, extra = {}) {
  return {
    event: `evt-${++eventCounter}`, session: 'ses-1', device: 'dev:864475046123456', sn: 'node-kelowna-01',
    product: 'com.example:biobot', req: 'note.add', received: 1757700000.5, when: 1757700000,
    file, body, best_location_type: 'triangulated', best_lat: 49.887, best_lon: -119.496,
    best_location: 'Kelowna BC', voltage: 4.97, temp: 23.5, ...extra,
  };
}

const DEVICE_QO = { request_type: 'create_device', deviceId: 'biobot-001', name: 'Knox Mountain', type: 'air-quality-monitor', status: 'active' };

function readings(overrides = {}) {
  const v = { temperature: 18.2, humidity: 52.0, pressure: 962.1, gasResistance: 118.4, altitude: 430, pm1: 3.1, pm25: 4.0, pm10: 5.2, ...overrides };
  const ts = '2026-09-12T18:00:00Z';
  const unit = { temperature: '°C', humidity: '%', pressure: 'hPa', gasResistance: 'kΩ', altitude: 'm', pm1: 'μg/m³', pm25: 'μg/m³', pm10: 'μg/m³' };
  return Object.entries(v).map(([readingType, value]) => ({ readingType, unit: unit[readingType], value, timestamp: ts }));
}

test('rejects requests without the ingest token', async () => {
  const r1 = await post('/ingest/notehub', envelope('data.qo', {}));
  assert.equal(r1.status, 401);
  const r2 = await post('/ingest/notehub', envelope('data.qo', {}), { authorization: 'Bearer wrong' });
  assert.equal(r2.status, 401);
});

test('device.qo registers a node with location and voltage from the envelope', async () => {
  const r = await post('/ingest/notehub', envelope('device.qo', DEVICE_QO), NH);
  assert.equal(r.status, 200);
  assert.equal(r.body.action, 'device_created');
  const d = await models.Device.findOne({ where: { deviceId: 'biobot-001' } });
  assert.equal(d.name, 'Knox Mountain');
  assert.equal(d.notecardUid, 'dev:864475046123456');
  assert.equal(Number(d.latitude), 49.887);
  assert.equal(Number(d.longitude), -119.496);
  assert.equal(Number(d.lastVoltage), 4.97);
  assert.equal(d.createdBy, null);

  // A second device.qo is an update, not a duplicate.
  const r2 = await post('/ingest/notehub', envelope('device.qo', { ...DEVICE_QO, name: 'Knox Mountain north' }), NH);
  assert.equal(r2.body.action, 'device_updated');
  assert.equal(await models.Device.count(), 1);
  assert.equal((await d.reload()).name, 'Knox Mountain north');
});

test('data.qo stores every reading with its anomaly tag and updates the node', async () => {
  const body = { requests: [
    { deviceId: 'biobot-001', readings: readings(), anomaly: { severity: 'none', score: 0 } },
    { deviceId: 'biobot-001', readings: readings({ pm25: 41.0 }), anomaly: { severity: 'watch', score: 1 } },
  ] };
  const r = await post('/ingest/notehub', envelope('data.qo', body), NH);
  assert.equal(r.status, 200);
  assert.equal(r.body.action, 'readings_stored');
  assert.equal(r.body.readings, 16);
  // Device was auto-created because data arrived before device.qo.
  const d = await models.Device.findOne({ where: { deviceId: 'biobot-001' } });
  assert.ok(d, 'device auto-created');
  assert.equal(d.lastSeverity, 'watch');
  assert.equal(d.lastAnomalyScore, 1);
  const rows = await models.Reading.findAll({ where: { deviceId: d.id, readingType: 'pm25' }, order: [['id', 'ASC']] });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].anomalySeverity, 'watch');
  assert.equal(Number(rows[1].value), 41);
  assert.equal(rows[1].timestamp.toISOString(), '2026-09-12T18:00:00.000Z');
});

test('GET /readings exposes per-reading and per-group anomaly fields', async () => {
  const reg = await post('/register', { username: 'viewer', email: 'viewer@example.com', password: 'Str0ngPassw0rd!' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const auth = { authorization: `Bearer ${reg.body.token}` };

  const body = { requests: [
    { deviceId: 'biobot-001', readings: readings(), anomaly: { severity: 'none', score: 0 } },
    { deviceId: 'biobot-001', readings: readings({ pm25: 41.0 }), anomaly: { severity: 'watch', score: 1 } },
  ] };
  const stored = await post('/ingest/notehub', envelope('data.qo', body, { event: 'evt-readings-api' }), NH);
  assert.equal(stored.status, 200);

  const r = await get('/readings?deviceId=biobot-001', auth);
  assert.equal(r.status, 200);
  assert.equal(r.body.requests.length, 2);
  const watchGroup = r.body.requests.find(g => g.requestId === 'evt-readings-api:1');
  const noneGroup = r.body.requests.find(g => g.requestId === 'evt-readings-api:0');
  assert.ok(watchGroup && noneGroup, 'both request groups returned');
  assert.equal(watchGroup.anomalySeverity, 'watch');
  assert.equal(watchGroup.readings.length, 8);
  for (const reading of watchGroup.readings) {
    assert.equal(reading.anomalySeverity, 'watch');
    assert.equal(reading.anomalyScore, 1);
  }
  assert.equal(noneGroup.anomalySeverity, 'none');
  assert.equal(noneGroup.readings[0].anomalyScore, 0);
});

test('data.qo without a requests array is a 400, not a crash', async () => {
  const r = await post('/ingest/notehub', envelope('data.qo', { readings: [] }), NH);
  assert.equal(r.status, 400);
});

test('alert.qo opens, escalates, and closes an incident, emailing each step', async () => {
  await post('/ingest/notehub', envelope('device.qo', DEVICE_QO), NH);
  const alertBody = (event, severity, score, signals) => ({
    request_type: 'anomaly', deviceId: 'biobot-001', event, severity, score, signals,
    timestamp: '2026-09-12T18:05:00Z',
    readings: { temperature: 19.0, humidity: 30.0, pressure: 961.8, gasResistance: 44.0, pm1: 30, pm25: 62.5, pm10: 70 },
    baseline: { ready: true, temperature: 18.1, humidity: 52.0, gasResistance: 118.0, pm25: 4.1 },
  });

  // raised
  let r = await post('/ingest/notehub', envelope('alert.qo', alertBody('raised', 'alert', 3, ['pm25_elevated', 'pm25_high'])), NH);
  assert.equal(r.status, 200);
  assert.equal(r.body.action, 'incident_opened');
  assert.equal(r.body.notified, true);
  const incidentId = r.body.incidentId;
  let inc = await models.Incident.findByPk(incidentId);
  assert.equal(inc.status, 'open');
  assert.equal(inc.severity, 'alert');
  assert.deepEqual(inc.signals, ['pm25_elevated', 'pm25_high']);
  assert.equal(inc.readings.pm25, 62.5);
  assert.equal((await models.Alert.count()), 1, 'legacy Alert row for the current dashboard');
  let mail = notify._sentMessages();
  assert.equal(mail.length, 1);
  assert.match(mail[0].subject, /ALERT at Knox Mountain/);
  assert.match(mail[0].text, /PM2\.5\s+62\.5 µg\/m³\s+4\.1 µg\/m³/);
  assert.match(mail[0].text, /openstreetmap\.org\/\?mlat=49\.887/);
  assert.match(mail[0].text, /incidents\/\d+/);
  assert.equal(mail[0].to[0].address, 'host@example.com');

  // updated: escalation to critical on the same open incident
  r = await post('/ingest/notehub', envelope('alert.qo', alertBody('updated', 'critical', 5, ['pm25_elevated', 'pm25_high', 'gas_resistance_drop', 'humidity_drop'])), NH);
  assert.equal(r.body.action, 'incident_updated');
  assert.equal(r.body.incidentId, incidentId);
  inc = await models.Incident.findByPk(incidentId);
  assert.equal(inc.severity, 'critical');
  assert.equal(inc.peakSeverity, 'critical');
  assert.equal(inc.score, 5);
  assert.equal(await models.Incident.count(), 1);
  assert.equal(await models.IncidentEvent.count({ where: { incidentId } }), 2);
  assert.match(notify._sentMessages()[1].subject, /CRITICAL continues/);

  // de-escalation keeps the peak
  r = await post('/ingest/notehub', envelope('alert.qo', alertBody('updated', 'alert', 2, ['pm25_high'])), NH);
  inc = await models.Incident.findByPk(incidentId);
  assert.equal(inc.severity, 'alert');
  assert.equal(inc.peakSeverity, 'critical');

  // cleared
  r = await post('/ingest/notehub', envelope('alert.qo', { ...alertBody('cleared', 'none', 0, []), timestamp: '2026-09-12T19:20:00Z' }), NH);
  assert.equal(r.body.action, 'incident_closed');
  inc = await models.Incident.findByPk(incidentId);
  assert.equal(inc.status, 'closed');
  assert.ok(inc.closedAt);
  const legacy = await models.Alert.findByPk(inc.alertId);
  assert.equal(legacy.status, 'resolved');
  const last = notify._sentMessages().at(-1);
  assert.match(last.subject, /All clear at Knox Mountain/);
  assert.match(last.text, /open for 1 h 15 min/);
  const d = await models.Device.findOne({ where: { deviceId: 'biobot-001' } });
  assert.equal(d.lastSeverity, 'none');
});

test('a cleared with nothing open is recorded as an already-closed incident', async () => {
  const r = await post('/ingest/notehub', envelope('alert.qo', { deviceId: 'biobot-002', event: 'cleared', severity: 'none', score: 0, signals: [] }), NH);
  assert.equal(r.status, 200);
  assert.equal(r.body.action, 'incident_closed_unmatched');
  const inc = await models.Incident.findByPk(r.body.incidentId);
  assert.equal(inc.status, 'closed');
});

test('a redelivered data.qo is stored once', async () => {
  const note = envelope('data.qo', { requests: [{ deviceId: 'biobot-001', readings: readings(), anomaly: { severity: 'none', score: 0 } }] }, { event: 'evt-redelivered-data' });
  const first = await post('/ingest/notehub', note, NH);
  assert.equal(first.status, 200);
  assert.equal(first.body.readings, 8);
  assert.equal(first.body.duplicates, 0);
  const before = await models.Reading.count();

  const again = await post('/ingest/notehub', note, NH);
  assert.equal(again.status, 200);
  assert.equal(again.body.readings, 0);
  assert.equal(again.body.duplicates, 1);
  assert.equal(await models.Reading.count(), before);
});

test('a redelivered alert.qo does not reopen, re-escalate, or re-email', async () => {
  notify._reset();
  const raise = envelope('alert.qo', {
    request_type: 'anomaly', deviceId: 'biobot-001', event: 'raised', severity: 'alert', score: 2,
    signals: ['pm25_elevated', 'gas_resistance_drop'], timestamp: '2026-09-12T19:00:00Z',
    readings: { pm25: 41, gasResistance: 50 }, baseline: { pm25: 4, gasResistance: 118 },
  }, { event: 'evt-redelivered-alert' });
  const first = await post('/ingest/notehub', raise, NH);
  assert.equal(first.status, 200);
  assert.equal(first.body.action, 'incident_opened');
  const emailsAfterFirst = notify._sentMessages().length;
  const eventsBefore = await models.IncidentEvent.count();

  const again = await post('/ingest/notehub', raise, NH);
  assert.equal(again.status, 200);
  assert.equal(again.body.action, 'duplicate_ignored');
  assert.equal(again.body.incidentId, first.body.incidentId);
  assert.equal(again.body.notified, false);
  assert.equal(await models.IncidentEvent.count(), eventsBefore);
  assert.equal(notify._sentMessages().length, emailsAfterFirst);
  assert.equal(await models.Incident.count({ where: { status: 'open' } }), 1);

  // Close it so later tests start clean.
  const clear = envelope('alert.qo', { request_type: 'anomaly', deviceId: 'biobot-001', event: 'cleared', severity: 'none', score: 0, signals: [], timestamp: '2026-09-12T19:30:00Z' });
  const closed = await post('/ingest/notehub', clear, NH);
  assert.equal(closed.body.action, 'incident_closed');
});

test('a bad event name is rejected', async () => {
  const r = await post('/ingest/notehub', envelope('alert.qo', { deviceId: 'biobot-001', event: 'fire!', severity: 'alert' }), NH);
  assert.equal(r.status, 400);
});

test('Notehub system files are acknowledged and still refresh a known node', async () => {
  await post('/ingest/notehub', envelope('device.qo', DEVICE_QO), NH);
  const r = await post('/ingest/notehub', envelope('_session.qo', { why: 'periodic' }, { voltage: 3.71, when: 1757703600 }), NH);
  assert.equal(r.status, 200);
  assert.equal(r.body.action, 'ignored');
  const d = await models.Device.findOne({ where: { deviceId: 'biobot-001' } });
  assert.equal(Number(d.lastVoltage), 3.71);
  assert.equal(d.lastSeen.getTime(), 1757703600 * 1000);
});

test('emails are skipped, not fatal, when no recipient is configured', async () => {
  const saved = process.env.ALERT_EMAIL_TO;
  process.env.ALERT_EMAIL_TO = '';
  try {
    const r = await post('/ingest/notehub', envelope('alert.qo', { deviceId: 'biobot-003', event: 'raised', severity: 'alert', score: 2, signals: ['pm25_high'] }), NH);
    assert.equal(r.status, 200);
    assert.equal(r.body.action, 'incident_opened');
    assert.equal(r.body.notified, false);
  } finally {
    process.env.ALERT_EMAIL_TO = saved;
  }
});

test('incidents API lists, shows the timeline, and records the drive-out outcome', async () => {
  const reg = await post('/register', { username: 'engin', email: 'engin@example.com', password: 'Str0ngPassw0rd!' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const auth = { authorization: `Bearer ${reg.body.token}` };

  await post('/ingest/notehub', envelope('device.qo', DEVICE_QO), NH);
  const raised = await post('/ingest/notehub', envelope('alert.qo', { deviceId: 'biobot-001', event: 'raised', severity: 'alert', score: 2, signals: ['pm25_high'], timestamp: '2026-09-12T18:05:00Z' }), NH);
  const id = raised.body.incidentId;

  const noAuth = await get('/incidents');
  assert.equal(noAuth.status, 401);

  const list = await get('/incidents?status=open', auth);
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].device.deviceId, 'biobot-001');

  const one = await get(`/incidents/${id}`, auth);
  assert.equal(one.status, 200);
  assert.equal(one.body.events.length, 1);
  assert.equal(one.body.events[0].event, 'raised');

  const bad = await post(`/incidents/${id}/acknowledge`, { outcome: 'dragon' }, auth);
  assert.equal(bad.status, 422);

  const ack = await post(`/incidents/${id}/acknowledge`, { outcome: 'false_alarm', notes: 'Neighbour burning yard waste.' }, auth);
  assert.equal(ack.status, 200);
  assert.equal(ack.body.outcome, 'false_alarm');
  assert.ok(ack.body.acknowledgedAt);
  assert.equal(ack.body.acknowledgedBy, reg.body.user.id);

  const missing = await get('/incidents/9999', auth);
  assert.equal(missing.status, 404);
});

test('legacy /sensordata still evaluates thresholds after the refactor', async () => {
  const reg = await post('/register', { username: 'legacy', email: 'legacy@example.com', password: 'Str0ngPassw0rd!' });
  const auth = { authorization: `Bearer ${reg.body.token}` };
  await models.AlertThreshold.create({ readingType: 'temperature', operator: '>', thresholdValue: 80, severity: 'high', message: 'Hot: {value}{unit}', enabled: true });
  const dev = await post('/devices', { deviceId: 'legacy-1', name: 'Legacy', type: 'test' }, auth);
  assert.equal(dev.status, 201, JSON.stringify(dev.body));
  const r = await post('/sensordata', { requests: [{ deviceId: 'legacy-1', readings: [{ readingType: 'temperature', unit: 'C', value: 95 }] }] }, auth);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const alerts = await models.Alert.findAll();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].message, 'Hot: 95C');
});
