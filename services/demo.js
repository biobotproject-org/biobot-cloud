const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { Device, Reading, Alert, Incident, IncidentEvent } = require('../models');
const { ingest } = require('./ingest');
const weather = require('./weather');
const { destination } = require('./geo');

// A scripted wildfire for demos and training. Five demo nodes are placed
// around an ignition point using the real wind there, then Notehub-shaped
// notes are fed through the normal ingest path on a timeline: the node
// downwind smells smoke first, the next one downwind follows, the flank goes
// to watch, the upwind node stays quiet. Everything the dashboard shows comes
// from the same tables real nodes write to.
//
// Demo devices have type 'demo' and deviceIds starting 'demo-'. Their alerts
// are ingested with { silent: true }, so no email is ever sent for them.
// clearDemo() removes every row they produced.

const DEMO_TYPE = 'demo';
// Southeast Kelowna BC: orchards against forest, where the 2003 Okanagan
// Mountain Park fire came into town. On land, and the centre of a weather cell.
const DEFAULT_CENTER = { latitude: 49.8, longitude: -119.4 };
const FALLBACK_WIND_FROM = 270;  // prevailing westerly, when live wind is unavailable

const UNITS = { temperature: '°C', humidity: '%', pressure: 'hPa', gasResistance: 'kΩ', pm1: 'μg/m³', pm25: 'μg/m³', pm10: 'μg/m³' };
const BASELINE = { temperature: 16.5, humidity: 48, pressure: 962, gasResistance: 120, pm1: 3, pm25: 4.2, pm10: 5.5 };

// Placement relative to the ignition point; `offset` is degrees from the
// downwind heading.
const NODES = [
  { key: 'downwind', name: 'Demo · Downwind ridge', offset: 0, km: 1.0 },
  { key: 'far', name: 'Demo · Far downwind', offset: 10, km: 2.6 },
  { key: 'flank-r', name: 'Demo · East flank', offset: 65, km: 1.3 },
  { key: 'flank-l', name: 'Demo · West flank', offset: -65, km: 1.3 },
  { key: 'upwind', name: 'Demo · Upwind trailhead', offset: 180, km: 1.5 },
];

// Scenario seconds. `k` is smoke intensity at the node, 0..1.
const TIMELINE = [
  { at: 4, node: 'downwind', k: 0.45, alert: { event: 'raised', severity: 'alert', score: 62, signals: ['pm25_high', 'gas_resistance_drop'] } },
  { at: 12, node: 'flank-r', k: 0.12, watch: 24 },
  { at: 18, node: 'far', k: 0.35, alert: { event: 'raised', severity: 'alert', score: 55, signals: ['pm25_elevated', 'humidity_drop'] } },
  { at: 26, node: 'downwind', k: 0.9, alert: { event: 'updated', severity: 'critical', score: 88, signals: ['pm25_critical', 'gas_resistance_drop', 'temperature_rise'] } },
  { at: 32, node: 'flank-l', k: 0.08, watch: 18 },
  { at: 40, node: 'far', k: 0.7, alert: { event: 'updated', severity: 'critical', score: 81, signals: ['pm25_critical', 'humidity_drop', 'gas_resistance_drop'] } },
];
const DURATION_S = Math.max(...TIMELINE.map(s => s.at));

let run = null;

function stepMs() {
  const n = parseInt(process.env.DEMO_STEP_MS || '1000', 10);
  return Number.isFinite(n) && n >= 0 ? n : 1000;
}

function values(k) {
  return {
    temperature: BASELINE.temperature + 6 * k,
    humidity: BASELINE.humidity - 18 * k,
    pressure: BASELINE.pressure,
    gasResistance: BASELINE.gasResistance * (1 - 0.6 * k),
    pm1: BASELINE.pm1 + 120 * k,
    pm25: BASELINE.pm25 + 180 * k,
    pm10: BASELINE.pm10 + 210 * k,
  };
}

function readingList(v, timestamp) {
  return Object.entries(v).map(([readingType, value]) => ({
    readingType, unit: UNITS[readingType], value: Math.round(value * 10) / 10, timestamp,
  }));
}

function channels(v) {
  return { pm25: v.pm25, gasResistance: v.gasResistance, humidity: v.humidity, temperature: v.temperature };
}

function envelope(node, file, body) {
  return {
    event: `demo-${uuidv4()}`, device: node.notecardUid, file, body,
    when: Math.floor(Date.now() / 1000), best_lat: node.latitude, best_lon: node.longitude,
  };
}

async function send(node, file, body) {
  return ingest(envelope(node, file, body), { silent: true });
}

async function playStep(step, nodes) {
  const node = nodes.find(n => n.key === step.node);
  const v = values(step.k);
  const now = new Date().toISOString();
  const severity = step.alert ? step.alert.severity : 'watch';
  const score = step.alert ? step.alert.score : step.watch;
  await send(node, 'data.qo', { requests: [{ deviceId: node.deviceId, readings: readingList(v, now), anomaly: { severity, score } }] });
  if (step.alert) {
    await send(node, 'alert.qo', {
      deviceId: node.deviceId, ...step.alert, timestamp: now,
      readings: channels(v), baseline: channels(BASELINE),
    });
  }
}

// Nudge the centre just enough that every node lands in the same weather
// cell as the centre, so all five read one wind; otherwise neighbouring
// nodes can draw spread cones in different directions. The shift is at most
// the node radius (~2.6 km), so a centre on land stays near where it was.
function fitInWeatherCell(lat, lon) {
  const reachKm = Math.max(...NODES.map(n => n.km)) + 0.1;
  const half = weather.CELL_DEG / 2;
  const marginLat = reachKm / 111.2;
  const marginLon = reachKm / (111.2 * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
  const cell = weather.cellCenter(lat, lon);
  const clamp = (v, c, m) => (m >= half ? c : Math.min(c + half - m, Math.max(c - half + m, v)));
  return {
    latitude: Math.round(clamp(lat, cell.latitude, marginLat) * 1e6) / 1e6,
    longitude: Math.round(clamp(lon, cell.longitude, marginLon) * 1e6) / 1e6,
  };
}

async function clearDemo() {
  if (run) {
    const stopping = run;
    run = null;  // pending steps see this and skip
    stopping.timers.forEach(clearTimeout);
    // A step may be mid-ingest; let it land before deleting, or it would
    // write rows for a device that no longer exists.
    await stopping.chain;
  }
  const devices = await Device.findAll({ where: { type: DEMO_TYPE }, attributes: ['id'] });
  const ids = devices.map(d => d.id);
  if (!ids.length) return { removedDevices: 0 };
  const incidents = await Incident.findAll({ where: { deviceId: { [Op.in]: ids } }, attributes: ['id'] });
  const incidentIds = incidents.map(i => i.id);
  if (incidentIds.length) {
    await IncidentEvent.destroy({ where: { incidentId: { [Op.in]: incidentIds } } });
    await Incident.destroy({ where: { id: { [Op.in]: incidentIds } } });
  }
  await Alert.destroy({ where: { deviceId: { [Op.in]: ids } } });
  await Reading.destroy({ where: { deviceId: { [Op.in]: ids } } });
  await Device.destroy({ where: { id: { [Op.in]: ids } } });
  return { removedDevices: ids.length };
}

function status() {
  if (!run) return { running: false };
  return {
    running: !run.finishedAt, startedAt: run.startedAt, finishedAt: run.finishedAt || null,
    center: run.center, wind: run.wind, durationSeconds: DURATION_S,
  };
}

// Starts the scenario and returns at once; `done` resolves when the last
// step has been ingested. A new start replaces any earlier demo.
async function startDemo({ latitude, longitude } = {}) {
  if (run && !run.finishedAt) {
    throw Object.assign(new Error('A demo is already running. Clear it first.'), { status: 409 });
  }
  await clearDemo();

  const center = fitInWeatherCell(
      Number.isFinite(Number(latitude)) ? Number(latitude) : DEFAULT_CENTER.latitude,
      Number.isFinite(Number(longitude)) ? Number(longitude) : DEFAULT_CENTER.longitude);
  const wx = await weather.currentWeather(center.latitude, center.longitude);
  const wind = wx.status === 'ok'
      ? { fromDeg: wx.windFromDeg, speedKmh: wx.windSpeedKmh, source: 'live' }
      : { fromDeg: FALLBACK_WIND_FROM, speedKmh: null, source: 'assumed' };
  const heading = (wind.fromDeg + 180) % 360;

  const nodes = NODES.map((n, i) => {
    const [lat, lon] = destination(center.latitude, center.longitude, heading + n.offset, n.km);
    return {
      ...n, deviceId: `demo-${n.key}`, notecardUid: `dev:demo0000000000${i + 1}`,
      latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lon * 1e6) / 1e6,
    };
  });

  // Register the nodes and give each half an hour of quiet history so its
  // charts have a baseline to climb from.
  const t0 = Date.now();
  for (const node of nodes) {
    await send(node, 'device.qo', { deviceId: node.deviceId, name: node.name, type: DEMO_TYPE, status: 'active' });
    const history = [];
    for (let m = 30; m >= 5; m -= 5) {
      history.push({
        deviceId: node.deviceId,
        readings: readingList(values(0.01 * Math.random()), new Date(t0 - m * 60000).toISOString()),
        anomaly: { severity: 'none', score: 0 },
      });
    }
    await send(node, 'data.qo', { requests: history });
  }

  const current = { startedAt: new Date().toISOString(), center, wind, timers: [], finishedAt: null, chain: Promise.resolve() };
  run = current;
  const ms = stepMs();
  let resolveDone;
  const done = new Promise(r => { resolveDone = r; });
  let remaining = TIMELINE.length;
  // Steps are chained so a slow ingest never lets a later step overtake an
  // earlier one (an "updated" must not land before its "raised").
  for (const step of TIMELINE) {
    current.timers.push(setTimeout(() => {
      current.chain = current.chain.then(async () => {
        if (run !== current) return;
        try {
          await playStep(step, nodes);
        } catch (err) {
          console.error(`[demo] step at ${step.at}s failed: ${err.message}`);
        }
        if (--remaining === 0) {
          current.finishedAt = new Date().toISOString();
          resolveDone();
        }
      });
    }, step.at * ms));
  }

  return {
    startedAt: current.startedAt, center, wind, durationSeconds: DURATION_S,
    nodes: nodes.map(n => ({ deviceId: n.deviceId, name: n.name, latitude: n.latitude, longitude: n.longitude })),
    done,
  };
}

module.exports = { startDemo, clearDemo, status, DEMO_TYPE, DURATION_S };
