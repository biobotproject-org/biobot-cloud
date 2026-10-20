// Live map, incident context (wind, spread, satellite) and the demo fire.
// Open-Meteo and NASA FIRMS are stubbed; nothing leaves the machine.
//   npm test
process.env.NODE_ENV = 'test';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.NOTEHUB_INGEST_TOKEN = 'nh-test-token';
process.env.ALERT_EMAIL_TRANSPORT = 'json';
process.env.ALERT_EMAIL_TO = 'host@example.com';
process.env.DEMO_STEP_MS = '0';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const sequelize = require('../config/database');
const models = require('../models');
const { createApp } = require('../app');
const notify = require('../services/notify');
const weather = require('../services/weather');
const firms = require('../services/firms');
const demo = require('../services/demo');
const { spreadEnvelope, lengthToBreadth } = require('../services/spread');
const { distanceKm, bearingDeg } = require('../services/geo');

let server, base, user, admin;

async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const post = (p, b, h) => call('POST', p, b, h);
const get = (p, h) => call('GET', p, undefined, h);
const del = (p, h) => call('DELETE', p, undefined, h);
const NH = { authorization: 'Bearer nh-test-token' };

// Wind from the west at 30 km/h: fire heads east.
const WEATHER_OK = {
  current: { time: '2026-10-20T10:00', temperature_2m: 24, relative_humidity_2m: 22, wind_speed_10m: 30, wind_direction_10m: 270, wind_gusts_10m: 45 },
};
let weatherCalls = 0;
function stubWeather(payload = WEATHER_OK, ok = true) {
  weatherCalls = 0;
  weather._reset();
  weather._setFetch(async () => {
    weatherCalls++;
    return { ok, status: ok ? 200 : 503, json: async () => payload };
  });
}

// One VIIRS detection ~3 km east of the Kelowna test node, one far away.
const FIRMS_CSV = [
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
  '49.887,-119.454,340.1,0.39,0.36,2026-10-20,0948,N20,VIIRS,h,2.0NRT,295.2,12.4,D',
  '49.700,-118.900,320.0,0.4,0.4,2026-10-20,0948,N20,VIIRS,n,2.0NRT,290.0,3.1,D',
].join('\n');
let firmsUrls = [];
function stubFirms(text = FIRMS_CSV) {
  firmsUrls = [];
  firms._reset();
  firms._setFetch(async (url) => {
    firmsUrls.push(url);
    return { ok: true, status: 200, text: async () => text };
  });
}

let eventCounter = 0;
function envelope(file, body) {
  return {
    event: `sit-${++eventCounter}`, device: 'dev:864475046123456', when: Math.floor(Date.now() / 1000),
    file, body, best_lat: 49.887, best_lon: -119.496,
  };
}
async function openIncident() {
  await post('/ingest/notehub', envelope('device.qo', { deviceId: 'biobot-001', name: 'Knox Mountain', type: 'air-quality-monitor' }), NH);
  const r = await post('/ingest/notehub', envelope('alert.qo', {
    deviceId: 'biobot-001', event: 'raised', severity: 'alert', score: 60, signals: ['pm25_high'],
    readings: { pm25: 80 }, baseline: { pm25: 4 },
  }), NH);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.incidentId;
}

before(async () => {
  await sequelize.sync({ force: true });
  const app = createApp({ requestLog: false });
  app.locals.dbReady = true;
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  const u = await post('/register', { username: 'mapviewer', email: 'mapviewer@example.com', password: 'Str0ngPassw0rd!' });
  assert.equal(u.status, 201, JSON.stringify(u.body));
  user = { authorization: `Bearer ${u.body.token}` };
  const a = await post('/register', { username: 'mapadmin', email: 'mapadmin@example.com', password: 'Str0ngPassw0rd!' });
  await models.User.update({ role: 'admin' }, { where: { username: 'mapadmin' } });
  admin = { authorization: `Bearer ${a.body.token}` };
});

after(async () => {
  await demo.clearDemo();
  server.close();
  await sequelize.close();
});

beforeEach(async () => {
  await demo.clearDemo();
  for (const m of [models.IncidentEvent, models.Incident, models.Alert, models.Reading, models.Device]) {
    await m.destroy({ where: {}, truncate: false });
  }
  notify._reset();
  stubWeather();
  stubFirms();
  delete process.env.FIRMS_MAP_KEY;
});

test('spread envelope heads downwind and grows with time', () => {
  const s = spreadEnvelope(49.887, -119.496, { status: 'ok', windSpeedKmh: 30, windFromDeg: 270 });
  assert.equal(s.headingDeg, 90);
  assert.equal(s.rateKmh, 3);  // 10% of 30 km/h
  assert.deepEqual(s.horizons.map(h => h.minutes), [30, 60, 120]);
  assert.deepEqual(s.horizons.map(h => h.headKm), [1.5, 3, 6]);
  // The furthest point of the 60-minute envelope is about 3 km east.
  const far = s.horizons[1].polygon.reduce((best, p) => {
    const d = distanceKm(49.887, -119.496, p[0], p[1]);
    return d > best.d ? { d, p } : best;
  }, { d: 0 });
  assert.ok(Math.abs(far.d - 3) < 0.05, `head ${far.d}`);
  assert.ok(Math.abs(bearingDeg(49.887, -119.496, far.p[0], far.p[1]) - 90) < 2);
  // Stronger wind, longer and thinner fire.
  assert.ok(lengthToBreadth(40) > lengthToBreadth(10));
  assert.equal(lengthToBreadth(0), 1);
  // No usable weather, no envelope.
  assert.equal(spreadEnvelope(49.887, -119.496, { status: 'unavailable' }), null);
});

test('FIRMS CSV parses VIIRS rows and rejects a plain-text error', () => {
  const rows = firms.parseCsv(FIRMS_CSV);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].detectedAt, '2026-10-20T09:48:00.000Z');
  assert.equal(rows[0].confidence, 'h');
  assert.equal(rows[0].frpMw, 12.4);
  assert.throws(() => firms.parseCsv('Invalid MAP_KEY.'), /Invalid MAP_KEY/);
});

test('incident context gives wind, a spread envelope, and the nearest hotspot', async () => {
  process.env.FIRMS_MAP_KEY = 'test-key';
  const id = await openIncident();
  const r = await get(`/incidents/${id}/context`, user);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.weather.status, 'ok');
  assert.equal(r.body.weather.windFromDeg, 270);
  assert.equal(r.body.spread.headingDeg, 90);
  assert.equal(r.body.satellite.status, 'ok');
  // Only the nearby detection is inside 25 km.
  assert.equal(r.body.satellite.hotspots.length, 1);
  assert.ok(r.body.satellite.nearest.distanceKm > 2 && r.body.satellite.nearest.distanceKm < 4);
  assert.ok(Math.abs(r.body.satellite.nearest.bearingDeg - 90) < 5);
  // Four FIRMS products queried with the key and a west,south,east,north box.
  assert.equal(firmsUrls.length, 4);
  assert.match(firmsUrls[0], /\/api\/area\/csv\/test-key\/VIIRS_SNPP_NRT\/-?\d+\.\d+,-?\d+\.\d+,-?\d+\.\d+,-?\d+\.\d+\/2$/);

  // Cached: a second call does not refetch either service.
  const callsBefore = weatherCalls;
  await get(`/incidents/${id}/context`, user);
  assert.equal(weatherCalls, callsBefore);
  assert.equal(firmsUrls.length, 4);
});

test('without FIRMS_MAP_KEY or weather the context degrades instead of failing', async () => {
  stubWeather({}, false);
  const id = await openIncident();
  const r = await get(`/incidents/${id}/context`, user);
  assert.equal(r.status, 200);
  assert.equal(r.body.weather.status, 'unavailable');
  assert.equal(r.body.spread, null);
  assert.equal(r.body.satellite.status, 'not_configured');
  assert.equal(r.body.satellite.nearest, null);
  assert.equal(firmsUrls.length, 0);

  const missing = await get('/incidents/9999/context', user);
  assert.equal(missing.status, 404);
  assert.equal((await get(`/incidents/${id}/context`)).status, 401);
});

test('GET /map lists nodes, open incidents with spread, and hotspots', async () => {
  process.env.FIRMS_MAP_KEY = 'test-key';
  const id = await openIncident();
  const r = await get('/map', user);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.devices.length, 1);
  assert.equal(r.body.devices[0].deviceId, 'biobot-001');
  assert.equal(r.body.devices[0].lastSeverity, 'alert');
  assert.equal(r.body.devices[0].isDemo, false);
  assert.equal(r.body.openIncidents.length, 1);
  assert.equal(r.body.openIncidents[0].id, id);
  assert.equal(r.body.openIncidents[0].spread.horizons.length, 3);
  assert.equal(r.body.satellite.status, 'ok');
  assert.equal(r.body.satellite.hotspots.length, 1);
  assert.equal((await get('/map')).status, 401);
});

test('demo fire is admin-only, plays through ingest silently, and clears completely', async () => {
  const forbidden = await post('/demo/fire', {}, user);
  assert.equal(forbidden.status, 403);
  assert.equal((await del('/demo', user)).status, 403);

  const started = await demo.startDemo({});
  assert.equal(started.nodes.length, 5);
  assert.equal(started.wind.source, 'live');
  await started.done;

  // Every node sits in the centre's weather cell, so all read the same wind.
  assert.deepEqual(started.center, { latitude: 49.8, longitude: -119.4 });
  const sameCell = (c, n) => assert.deepEqual(weather.cellCenter(n.latitude, n.longitude), weather.cellCenter(c.latitude, c.longitude), n.deviceId);
  started.nodes.forEach(n => sameCell(started.center, n));
  // The downwind node is east of the centre (wind from the west).
  const down = started.nodes.find(n => n.deviceId === 'demo-downwind');
  assert.ok(Math.abs(bearingDeg(started.center.latitude, started.center.longitude, down.latitude, down.longitude) - 90) < 1);

  const map = await get('/map', user);
  assert.equal(map.body.devices.filter(d => d.isDemo).length, 5);
  const open = map.body.openIncidents;
  assert.deepEqual(open.map(i => i.device.deviceId).sort(), ['demo-downwind', 'demo-far']);
  assert.ok(open.every(i => i.severity === 'critical'));
  const byId = Object.fromEntries(map.body.devices.map(d => [d.deviceId, d]));
  assert.equal(byId['demo-flank-r'].lastSeverity, 'watch');
  assert.equal(byId['demo-upwind'].lastSeverity, 'none');
  // Demo alerts never email anyone.
  assert.equal(notify._sentMessages().length, 0);

  // Starting again over HTTP replaces the old demo rather than doubling it.
  const again = await post('/demo/fire', { latitude: 50.12, longitude: -119.33 }, admin);
  assert.equal(again.status, 202, JSON.stringify(again.body));
  // Near a cell edge the centre moves only as far as needed (here ~1.3 km).
  assert.equal(again.body.center.latitude, 50.12);
  assert.ok(again.body.center.longitude > -119.33 && again.body.center.longitude < -119.31, again.body.center.longitude);
  again.body.nodes.forEach(n => sameCell(again.body.center, n));
  assert.equal(await models.Device.count({ where: { type: 'demo' } }), 5);

  const cleared = await del('/demo', admin);
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.removedDevices, 5);
  assert.equal(await models.Device.count(), 0);
  assert.equal(await models.Incident.count(), 0);
  assert.equal(await models.Reading.count(), 0);
  assert.equal(await models.Alert.count(), 0);
  assert.equal((await get('/demo', user)).body.running, false);
});

test('demo falls back to a westerly when live wind is unavailable', async () => {
  stubWeather({}, false);
  const started = await demo.startDemo({});
  assert.deepEqual(started.wind, { fromDeg: 270, speedKmh: null, source: 'assumed' });
  await started.done;
});
