const { fn, col } = require('sequelize');
const sequelize = require('../config/database');
const { User, ApiKey, Device, Incident, AlertAcknowledgment } = require('../models');

// User administration for admins: list, change role, delete.
//
// Two guards keep the dashboard from being locked out: there is always at
// least one admin, and an admin cannot demote or delete themselves (another
// admin has to). Deleting a user revokes their API keys, which matters
// because a Notehub route authenticates with an ingest key: delete its owner
// and that route starts getting 401s. The list reports ingest keys per user
// so the dashboard can warn first.

const ROLES = ['admin', 'user'];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function countBy(model, field, where = {}) {
  const rows = await model.findAll({
    attributes: [field, [fn('COUNT', col('id')), 'n']],
    where,
    group: [field],
    raw: true,
  });
  return new Map(rows.map(r => [r[field], Number(r.n)]));
}

async function listUsers() {
  const [users, ingestKeys, otherKeys, devices] = await Promise.all([
    User.findAll({ attributes: ['id', 'username', 'email', 'role', 'createdAt'], order: [['id', 'ASC']] }),
    countBy(ApiKey, 'userId', { scope: 'ingest' }),
    countBy(ApiKey, 'userId', { scope: 'user' }),
    countBy(Device, 'createdBy'),
  ]);
  return users.map(u => ({
    ...u.toJSON(),
    ingestKeys: ingestKeys.get(u.id) || 0,
    apiKeys: otherKeys.get(u.id) || 0,
    devices: devices.get(u.id) || 0,
  }));
}

async function findTarget(id) {
  const user = await User.findByPk(id);
  if (!user) throw httpError(404, 'User not found');
  return user;
}

async function assertNotLastAdmin(user) {
  if (user.role === 'admin' && await User.count({ where: { role: 'admin' } }) <= 1) {
    throw httpError(409, 'There must always be at least one admin.');
  }
}

async function setRole(actor, id, role) {
  if (!ROLES.includes(role)) throw httpError(422, `role must be one of ${ROLES.join(', ')}`);
  const user = await findTarget(id);
  if (user.role === role) return user;
  if (role !== 'admin') {
    if (user.id === actor.id) throw httpError(409, 'You cannot remove your own admin role. Ask another admin.');
    await assertNotLastAdmin(user);
  }
  await user.update({ role });
  return user;
}

async function deleteUser(actor, id) {
  const user = await findTarget(id);
  if (user.id === actor.id) throw httpError(409, 'You cannot delete your own account here. Ask another admin.');
  await assertNotLastAdmin(user);
  return sequelize.transaction(async transaction => {
    const revokedKeys = await ApiKey.destroy({ where: { userId: user.id }, transaction });
    await AlertAcknowledgment.destroy({ where: { userId: user.id }, transaction });
    // Keep the incident outcome they recorded; only the name goes.
    await Incident.update({ acknowledgedBy: null }, { where: { acknowledgedBy: user.id }, transaction });
    await Device.update({ createdBy: null }, { where: { createdBy: user.id }, transaction });
    await user.destroy({ transaction });
    return { deleted: user.id, revokedKeys };
  });
}

module.exports = { listUsers, setRole, deleteUser, ROLES };
