// User administration: /me, listing, role changes and deletion, with the
// guards that keep at least one admin and stop admins locking themselves out.
//   npm test
process.env.NODE_ENV = 'test';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.ALERT_EMAIL_TRANSPORT = 'json';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sequelize = require('../config/database');
const models = require('../models');
const { createApp } = require('../app');

let server, base;

async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function register(username) {
  const r = await call('POST', '/register', { username, email: `${username}@example.com`, password: 'Str0ngPassw0rd!' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.user.id, auth: { authorization: `Bearer ${r.body.token}` } };
}

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

test('admins manage users; guards keep an admin and stop self-lockout', async () => {
  const boss = await register('boss');
  const ana = await register('ana');
  const ben = await register('ben');
  await models.User.update({ role: 'admin' }, { where: { id: boss.id } });

  // /me reflects the database role, so a promotion shows without re-login.
  assert.equal((await call('GET', '/me', undefined, boss.auth)).body.role, 'admin');
  assert.equal((await call('GET', '/me', undefined, ana.auth)).body.role, 'user');
  assert.equal((await call('GET', '/me')).status, 401);

  // Non-admins get nothing.
  assert.equal((await call('GET', '/users', undefined, ana.auth)).status, 403);
  assert.equal((await call('PATCH', `/users/${ben.id}/role`, { role: 'admin' }, ana.auth)).status, 403);
  assert.equal((await call('DELETE', `/users/${ben.id}`, undefined, ana.auth)).status, 403);

  // Ana owns an ingest key, as a Notehub route would.
  const key = await call('POST', '/api-keys', { name: 'Notehub route', scope: 'ingest' }, ana.auth);
  assert.equal(key.status, 201, JSON.stringify(key.body));

  const list = await call('GET', '/users', undefined, boss.auth);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map(u => [u.username, u.role]), [['boss', 'admin'], ['ana', 'user'], ['ben', 'user']]);
  assert.equal(list.body.find(u => u.username === 'ana').ingestKeys, 1);
  assert.ok(list.body.every(u => !('password' in u)));

  // Promote: takes effect on the next request with the same token.
  const promoted = await call('PATCH', `/users/${ana.id}/role`, { role: 'admin' }, boss.auth);
  assert.equal(promoted.status, 200);
  assert.equal(promoted.body.role, 'admin');
  assert.equal((await call('GET', '/users', undefined, ana.auth)).status, 200);

  assert.equal((await call('PATCH', `/users/${ben.id}/role`, { role: 'owner' }, boss.auth)).status, 422);
  assert.equal((await call('PATCH', '/users/9999/role', { role: 'admin' }, boss.auth)).status, 404);

  // No self-demotion or self-delete, even with another admin around.
  const selfDemote = await call('PATCH', `/users/${boss.id}/role`, { role: 'user' }, boss.auth);
  assert.equal(selfDemote.status, 409);
  assert.equal((await call('DELETE', `/users/${boss.id}`, undefined, boss.auth)).status, 409);

  // Ana demotes boss; ana is now the only admin and cannot be demoted.
  assert.equal((await call('PATCH', `/users/${boss.id}/role`, { role: 'user' }, ana.auth)).status, 200);
  await models.User.update({ role: 'admin' }, { where: { id: ben.id } });
  assert.equal((await call('PATCH', `/users/${ben.id}/role`, { role: 'user' }, ana.auth)).status, 200);
  const last = await call('DELETE', `/users/${ana.id}`, undefined, ana.auth);
  assert.equal(last.status, 409);

  // Deleting a user revokes their keys and keeps the incident outcome they recorded.
  await models.User.update({ role: 'admin' }, { where: { id: boss.id } });
  const device = await models.Device.create({ deviceId: 'u-1', name: 'U', type: 't', createdBy: ana.id });
  const incident = await models.Incident.create({
    deviceId: device.id, status: 'closed', severity: 'none', peakSeverity: 'alert', score: 0,
    openedAt: new Date(), lastEventAt: new Date(), acknowledgedBy: ana.id, acknowledgedAt: new Date(), outcome: 'false_alarm',
  });
  const del = await call('DELETE', `/users/${ana.id}`, undefined, boss.auth);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(del.body.revokedKeys, 1);
  assert.equal(await models.ApiKey.count({ where: { userId: ana.id } }), 0);
  assert.equal((await device.reload()).createdBy, null);
  await incident.reload();
  assert.equal(incident.acknowledgedBy, null);
  assert.equal(incident.outcome, 'false_alarm');
  // Their token no longer works.
  assert.equal((await call('GET', '/me', undefined, ana.auth)).status, 401);
});

test('registration still ignores a role in the body', async () => {
  const r = await call('POST', '/register', { username: 'sneaky', email: 'sneaky@example.com', password: 'Str0ngPassw0rd!', role: 'admin' });
  assert.equal(r.status, 201);
  assert.equal((await models.User.findByPk(r.body.user.id)).role, 'user');
});
