const { v4: uuidv4 } = require('uuid');
const { Device, Reading, Alert, Incident, IncidentEvent } = require('../models');
const { loadEnabledThresholds, evaluateThresholds } = require('./thresholds');
const notify = require('./notify');

// Handles events forwarded by a Blues Notehub route.
//
// Notehub wraps every note in an envelope. The fields used here:
//   file       note file name, e.g. "data.qo"
//   body       the JSON the node put in the note
//   device     Notecard UID, "dev:..."
//   when       unix seconds when the note was created on the device
//   received   unix seconds when Notehub received it
//   best_lat   } best known location: GPS, or tower/triangulation fallback
//   best_lon   }
//   voltage    Notecard supply voltage
//
// The node's own JSON is inside `body`; see the firmware README.

const SEVERITY_RANK = { none: 0, watch: 1, alert: 2, critical: 3, fault: 2 };
const ACTIVE_SEVERITIES = new Set(['alert', 'critical', 'fault']);

// Map the node's severity onto the legacy Alert table so the current
// dashboard shows incidents without changes.
const LEGACY_SEVERITY = { watch: 'low', alert: 'high', critical: 'critical', fault: 'medium' };

function toDate(unixSeconds, fallback = new Date()) {
  const n = Number(unixSeconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : fallback;
}

function parseIsoOr(value, fallback) {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function parseEnvelope(payload) {
  if (!payload || typeof payload !== 'object') {
    throw Object.assign(new Error('Payload must be a JSON object'), { status: 400 });
  }
  const file = typeof payload.file === 'string' ? payload.file : null;
  if (!file) throw Object.assign(new Error('Missing "file" in Notehub event'), { status: 400 });
  const body = (payload.body && typeof payload.body === 'object') ? payload.body : {};
  return {
    file,
    body,
    // Notehub assigns every event a UUID and redelivers on any non-2xx or
    // timeout, so the id is the key for making ingestion idempotent.
    eventId: typeof payload.event === 'string' && payload.event ? payload.event.slice(0, 64) : null,
    notecardUid: typeof payload.device === 'string' ? payload.device : null,
    when: toDate(payload.when, toDate(payload.received)),
    latitude: Number.isFinite(Number(payload.best_lat)) ? Number(payload.best_lat) : null,
    longitude: Number.isFinite(Number(payload.best_lon)) ? Number(payload.best_lon) : null,
    voltage: Number.isFinite(Number(payload.voltage)) ? Number(payload.voltage) : null,
  };
}

// Find the Device row for a node, creating a placeholder if this is the
// first we have heard of it. Notehub does not guarantee delivery order, so a
// data.qo can arrive before the device.qo that introduces the node.
async function findOrCreateDevice(deviceId, env, defaults = {}) {
  if (!deviceId || typeof deviceId !== 'string') {
    throw Object.assign(new Error('Missing deviceId in note body'), { status: 400 });
  }
  let device = await Device.findOne({ where: { deviceId } });
  let created = false;
  if (!device) {
    device = await Device.create({
      deviceId,
      name: defaults.name || deviceId,
      type: defaults.type || 'air-quality-monitor',
      status: defaults.status || 'active',
      notecardUid: env.notecardUid,
    });
    created = true;
  }
  return { device, created };
}

// Every envelope carries location and voltage; keep the device row current.
function envelopeUpdates(env, when) {
  const u = { lastSeen: when };
  if (env.notecardUid) u.notecardUid = env.notecardUid;
  if (env.latitude !== null && env.longitude !== null) {
    u.latitude = env.latitude;
    u.longitude = env.longitude;
  }
  if (env.voltage !== null) u.lastVoltage = env.voltage;
  return u;
}

async function handleDeviceNote(env) {
  const b = env.body;
  const { device, created } = await findOrCreateDevice(b.deviceId, env, {
    name: b.name, type: b.type, status: b.status,
  });
  const updates = envelopeUpdates(env, env.when);
  if (!created) {
    if (typeof b.name === 'string' && b.name) updates.name = b.name;
    if (typeof b.type === 'string' && b.type) updates.type = b.type;
  }
  await device.update(updates);
  return { action: created ? 'device_created' : 'device_updated', deviceId: device.deviceId };
}

async function handleDataNote(env) {
  const requests = Array.isArray(env.body.requests) ? env.body.requests : null;
  if (!requests) throw Object.assign(new Error('data.qo body must contain a "requests" array'), { status: 400 });

  const thresholds = await loadEnabledThresholds();
  let stored = 0, alerts = 0, duplicates = 0;
  const devices = new Set();

  for (const [index, request] of requests.entries()) {
    if (!request || !Array.isArray(request.readings)) continue;
    const { device } = await findOrCreateDevice(request.deviceId, env);
    devices.add(device.deviceId);
    // One requestId per batch entry. With a Notehub event id it is stable
    // across redeliveries, so a repeat is detected and skipped.
    const requestId = env.eventId ? `${env.eventId}:${index}` : uuidv4();
    if (env.eventId && await Reading.count({ where: { requestId } }) > 0) {
      duplicates++;
      continue;
    }
    const anomaly = (request.anomaly && typeof request.anomaly === 'object') ? request.anomaly : {};
    const severity = typeof anomaly.severity === 'string' ? anomaly.severity : null;
    const score = Number.isFinite(Number(anomaly.score)) ? Number(anomaly.score) : null;

    const rows = [];
    for (const r of request.readings) {
      if (!r || typeof r.readingType !== 'string' || !Number.isFinite(Number(r.value))) continue;
      rows.push({
        deviceId: device.id,
        value: Number(r.value),
        unit: typeof r.unit === 'string' ? r.unit : '',
        readingType: r.readingType,
        timestamp: parseIsoOr(r.timestamp, env.when),
        requestId,
        anomalySeverity: severity,
        anomalyScore: score,
      });
    }
    const createdReadings = rows.length ? await Reading.bulkCreate(rows) : [];
    stored += createdReadings.length;

    const updates = envelopeUpdates(env, env.when);
    if (severity !== null) updates.lastSeverity = severity;
    if (score !== null) updates.lastAnomalyScore = score;
    await device.update(updates);

    const tripped = await evaluateThresholds(device, createdReadings, requestId, thresholds);
    alerts += tripped.length;
  }
  return { action: 'readings_stored', readings: stored, thresholdAlerts: alerts, duplicates, devices: [...devices] };
}

async function handleAlertNote(env, { baseUrl } = {}) {
  const b = env.body;
  const event = ['raised', 'updated', 'cleared'].includes(b.event) ? b.event : null;
  if (!event) throw Object.assign(new Error('alert.qo body.event must be raised, updated, or cleared'), { status: 400 });
  const severity = typeof b.severity === 'string' ? b.severity : 'alert';
  const score = Number.isFinite(Number(b.score)) ? Number(b.score) : 0;
  const signals = Array.isArray(b.signals) ? b.signals.filter(s => typeof s === 'string') : [];
  const readings = (b.readings && typeof b.readings === 'object') ? b.readings : null;
  const baseline = (b.baseline && typeof b.baseline === 'object') ? b.baseline : null;
  const occurredAt = parseIsoOr(b.timestamp, env.when);

  if (env.eventId) {
    const seen = await IncidentEvent.findOne({ where: { notehubEventId: env.eventId } });
    if (seen) {
      return { action: 'duplicate_ignored', incidentId: seen.incidentId, event, severity, notified: false };
    }
  }

  const { device } = await findOrCreateDevice(b.deviceId, env);
  const deviceUpdates = envelopeUpdates(env, occurredAt);
  deviceUpdates.lastSeverity = event === 'cleared' ? 'none' : severity;
  deviceUpdates.lastAnomalyScore = event === 'cleared' ? 0 : score;
  await device.update(deviceUpdates);

  let incident = await Incident.findOne({ where: { deviceId: device.id, status: 'open' }, order: [['openedAt', 'DESC']] });
  let action;

  if (event === 'cleared') {
    if (!incident) {
      // Nothing open: the raise was lost or predates the server. Record the
      // clear as a short, already-closed incident so the history is honest.
      incident = await Incident.create({
        deviceId: device.id, status: 'closed', severity: 'none', peakSeverity: severity || 'alert',
        score: 0, signals: [], readings, baseline,
        openedAt: occurredAt, lastEventAt: occurredAt, closedAt: occurredAt,
      });
      action = 'incident_closed_unmatched';
    } else {
      await incident.update({ status: 'closed', severity: 'none', score: 0, signals: [], readings, baseline, lastEventAt: occurredAt, closedAt: occurredAt });
      if (incident.alertId) {
        await Alert.update({ status: 'resolved' }, { where: { id: incident.alertId } });
      }
      action = 'incident_closed';
    }
  } else if (!incident) {
    const legacyAlert = await Alert.create({
      deviceId: device.id,
      severity: LEGACY_SEVERITY[severity] || 'high',
      message: `${device.name || device.deviceId}: ${severity} (score ${score}) ${signals.join(', ')}`.trim(),
      triggeredAt: occurredAt,
    });
    incident = await Incident.create({
      deviceId: device.id, status: 'open', severity, peakSeverity: severity, score, signals, readings, baseline,
      openedAt: occurredAt, lastEventAt: occurredAt, alertId: legacyAlert.id,
    });
    action = 'incident_opened';
  } else {
    const peak = (SEVERITY_RANK[severity] || 0) > (SEVERITY_RANK[incident.peakSeverity] || 0) ? severity : incident.peakSeverity;
    await incident.update({ severity, peakSeverity: peak, score, signals, readings, baseline, lastEventAt: occurredAt });
    if (incident.alertId) {
      await Alert.update({
        severity: LEGACY_SEVERITY[severity] || 'high',
        message: `${device.name || device.deviceId}: ${severity} (score ${score}) ${signals.join(', ')}`.trim(),
      }, { where: { id: incident.alertId } });
    }
    action = 'incident_updated';
  }

  const incidentEvent = await IncidentEvent.create({
    incidentId: incident.id, event, severity, score, signals, readings, baseline, occurredAt,
    notehubEventId: env.eventId,
  });

  let notified = false;
  try {
    const result = await notify.sendIncidentEmail({ incident, event: incidentEvent, device, baseUrl });
    notified = !result.skipped;
  } catch (err) {
    console.error(`[notify] email failed for incident ${incident.id}: ${err.message}`);
  }
  if (notified) await incidentEvent.update({ notified: true });

  return { action, incidentId: incident.id, event, severity, notified };
}

// Notehub system files (_session.qo, _health.qo, _track.qo, ...) and any
// file this server does not understand. Still refresh device location and
// voltage when the envelope names a node we know.
async function handleOtherNote(env) {
  if (env.notecardUid) {
    const device = await Device.findOne({ where: { notecardUid: env.notecardUid } });
    if (device) await device.update(envelopeUpdates(env, env.when));
  }
  return { action: 'ignored' };
}

async function ingest(payload, options = {}) {
  const env = parseEnvelope(payload);
  let result;
  switch (env.file) {
    case 'device.qo': result = await handleDeviceNote(env); break;
    case 'data.qo':   result = await handleDataNote(env); break;
    case 'alert.qo':  result = await handleAlertNote(env, options); break;
    default:          result = await handleOtherNote(env); break;
  }
  return { file: env.file, ...result };
}

module.exports = { ingest, parseEnvelope, ACTIVE_SEVERITIES };
