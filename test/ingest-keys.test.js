// Ingest-scoped API keys: created in the dashboard, accepted only by
// POST /ingest/notehub, rejected everywhere else. Legacy env token fallback.
//   npm test
process.env.NODE_ENV = 'test';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';
process.env.JWT_SECRET = 'test-secret';
delete process.env.NOTEHUB_INGEST_TOKEN;
process.env.ALERT_EMAIL_TRANSPORT = 'json';
process.env.ALERT_EMAIL_TO = 'host@example.com';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sequelize = require('../config/database');
const models = require('../models');
const { createApp } = require('../app');
const ingestKeys = require('../services/ingestKeys');

let server, base, auth, userKey, ingestKey, ingestKeyId;

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

async function post(path, body, headers = {}) {
  const res = await fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
async function get(path, headers = {}) {
  const res = await fetch(base + path, { headers });
  return { status: res.status, body: await res.json() };
}

let n = 0;
function envelope(file, body) {
  return { event: `evt-key-${++n}`, device: 'dev:864475046999999', when: 1757700000, file, body, best_lat: 49.9, best_lon: -119.5 };
}
const DEVICE_QO = { request_type: 'create_device', deviceId: 'biobot-key-1', name: 'Key Test Ridge', type: 'air-quality-monitor' };

test('with no ingest key and no env token, ingest answers 503', async () => {
  const r = await post('/ingest/notehub', envelope('device.qo', DEVICE_QO), { authorization: 'Bearer sk_nothing' });
  assert.equal(r.status, 503);
  assert.match(r.body.error, /No ingest key configured/);
});

test('POST /api-keys creates an ingest-scoped key and lists scope and lastUsedAt', async () => {
  const reg = await post('/register', { username: 'keymaker', email: 'keymaker@example.com', password: 'Str0ngPassw0rd!' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  auth = { authorization: `Bearer ${reg.body.token}` };

  const bad = await post('/api-keys', { name: 'Bad scope', scope: 'admin' }, auth);
  assert.equal(bad.status, 422, JSON.stringify(bad.body));

  const created = await post('/api-keys', { name: 'Notehub route', scope: 'ingest' }, auth);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.apiKey.scope, 'ingest');
  assert.equal(created.body.apiKey.lastUsedAt, null);
  assert.match(created.body.apiKey.key, /^sk_[0-9a-f]{64}$/);
  ingestKey = created.body.apiKey.key;
  ingestKeyId = created.body.apiKey.id;

  const plain = await post('/api-keys', { name: 'Dashboard script' }, auth);
  assert.equal(plain.status, 201);
  assert.equal(plain.body.apiKey.scope, 'user', 'scope defaults to user');
  userKey = plain.body.apiKey.key;

  const list = await get('/api-keys', auth);
  assert.equal(list.status, 200);
  const row = list.body.apiKeys.find(k => k.id === ingestKeyId);
  assert.equal(row.scope, 'ingest');
  assert.equal(row.lastUsedAt, null);
  assert.equal(row.key, undefined, 'hash never returned');
});

test('ingest succeeds with the ingest key, names it, and stamps lastUsedAt', async () => {
  const r = await post('/ingest/notehub', envelope('device.qo', DEVICE_QO), { authorization: `Bearer ${ingestKey}` });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.action, 'device_created');
  assert.equal(r.body.ingestKey, 'Notehub route');
  const row = await models.ApiKey.findByPk(ingestKeyId);
  assert.ok(row.lastUsedAt, 'lastUsedAt set');
  assert.ok(Date.now() - row.lastUsedAt.getTime() < 10000);
  const list = await get('/api-keys', auth);
  assert.ok(list.body.apiKeys.find(k => k.id === ingestKeyId).lastUsedAt);
});

test('an ingest key is rejected on every authenticated route', async () => {
  const devices = await get('/devices', { authorization: `Bearer ${ingestKey}` });
  assert.equal(devices.status, 401);
  assert.match(devices.body.error, /ingest scope/);
  const incidents = await get('/incidents', { authorization: `Bearer ${ingestKey}` });
  assert.equal(incidents.status, 401);
  const keys = await get('/api-keys', { authorization: `Bearer ${ingestKey}` });
  assert.equal(keys.status, 401);
});

test('a user key is rejected on /ingest/notehub and a wrong key is 401', async () => {
  const asUser = await post('/ingest/notehub', envelope('device.qo', DEVICE_QO), { authorization: `Bearer ${userKey}` });
  assert.equal(asUser.status, 401);
  // ...but the same user key still works on the normal API.
  const ok = await get('/devices', { authorization: `Bearer ${userKey}` });
  assert.equal(ok.status, 200);

  const wrong = await post('/ingest/notehub', envelope('device.qo', DEVICE_QO), { authorization: 'Bearer sk_0000000000000000000000000000000000000000000000000000000000000000' });
  assert.equal(wrong.status, 401);
  const samePrefix = await post('/ingest/notehub', envelope('device.qo', DEVICE_QO), { authorization: `Bearer ${ingestKey.slice(0, 8)}${'f'.repeat(59)}` });
  assert.equal(samePrefix.status, 401);
  const none = await post('/ingest/notehub', envelope('device.qo', DEVICE_QO));
  assert.equal(none.status, 401);
});

test('the legacy env token still works as a fallback and warns once', async () => {
  process.env.NOTEHUB_INGEST_TOKEN = 'legacy-env-token';
  ingestKeys._resetWarning();
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const r1 = await post('/ingest/notehub', envelope('data.qo', { requests: [] }), { authorization: 'Bearer legacy-env-token' });
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.equal(r1.body.ingestKey, undefined, 'no key name for the env token');
    const r2 = await post('/ingest/notehub', envelope('data.qo', { requests: [] }), { 'x-ingest-token': 'legacy-env-token' });
    assert.equal(r2.status, 200, 'x-ingest-token header still accepted');
    const bad = await post('/ingest/notehub', envelope('data.qo', { requests: [] }), { authorization: 'Bearer legacy-env-tokeN' });
    assert.equal(bad.status, 401);
    // DB keys keep working alongside the env token.
    const viaKey = await post('/ingest/notehub', envelope('data.qo', { requests: [] }), { authorization: `Bearer ${ingestKey}` });
    assert.equal(viaKey.status, 200);
    assert.equal(viaKey.body.ingestKey, 'Notehub route');
  } finally {
    console.warn = origWarn;
    delete process.env.NOTEHUB_INGEST_TOKEN;
  }
  assert.equal(warnings.filter(w => /NOTEHUB_INGEST_TOKEN is deprecated/.test(w)).length, 1);
});

test('revoking the ingest key locks the route out again', async () => {
  const del = await fetch(`${base}/api-keys/${ingestKeyId}`, { method: 'DELETE', headers: auth });
  assert.equal(del.status, 200);
  const r = await post('/ingest/notehub', envelope('data.qo', { requests: [] }), { authorization: `Bearer ${ingestKey}` });
  assert.equal(r.status, 503, 'no ingest keys left and no env token');
});
