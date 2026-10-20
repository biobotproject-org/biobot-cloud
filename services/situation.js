const { Device, Incident } = require('../models');
const weather = require('./weather');
const firms = require('./firms');
const { spreadEnvelope } = require('./spread');

// Situational picture for the live map and the incident page: where the
// nodes are, which are in an incident, which way the wind would carry a
// fire from them, and whether a satellite has seen heat nearby.

const DEVICE_FIELDS = ['id', 'deviceId', 'name', 'type', 'status', 'latitude', 'longitude',
  'lastSeen', 'lastSeverity', 'lastAnomalyScore', 'lastVoltage'];

function hasCoords(d) {
  return d && d.latitude !== null && d.latitude !== undefined && d.longitude !== null && d.longitude !== undefined;
}

// Weather, spread envelope and nearby hotspots for one incident. Spread is
// only computed while the incident is open; a closed one is history.
async function incidentContext(incident, device) {
  if (!hasCoords(device)) {
    return { location: null, weather: { status: 'unavailable', error: 'Node has no location' }, spread: null,
      satellite: { status: 'unavailable', error: 'Node has no location', hotspots: [] } };
  }
  const lat = Number(device.latitude), lon = Number(device.longitude);
  const [wx, sat] = await Promise.all([weather.currentWeather(lat, lon), firms.hotspotsNear(lat, lon)]);
  return {
    location: { latitude: lat, longitude: lon },
    weather: wx,
    spread: incident.status === 'open' ? spreadEnvelope(lat, lon, wx) : null,
    satellite: { ...sat, nearest: sat.hotspots[0] || null },
  };
}

async function mapOverview() {
  const [devices, open] = await Promise.all([
    Device.findAll({ attributes: DEVICE_FIELDS, order: [['id', 'ASC']] }),
    Incident.findAll({
      where: { status: 'open' },
      include: [{ model: Device, as: 'device', attributes: DEVICE_FIELDS }],
      order: [['openedAt', 'DESC']],
    }),
  ]);

  const openIncidents = await Promise.all(open.map(async inc => {
    const ctx = await incidentContext(inc, inc.device);
    return {
      id: inc.id, severity: inc.severity, peakSeverity: inc.peakSeverity, score: inc.score,
      signals: inc.signals, openedAt: inc.openedAt, lastEventAt: inc.lastEventAt,
      acknowledgedAt: inc.acknowledgedAt, outcome: inc.outcome,
      device: inc.device, ...ctx,
    };
  }));

  // Satellite detections near any node with a location, deduplicated.
  // Lookups are cached per ~10 km cell, so nodes close together share one.
  const located = devices.filter(hasCoords);
  const results = await Promise.all(located.map(d => firms.hotspotsNear(d.latitude, d.longitude)));
  const seen = new Set();
  const hotspots = [];
  for (const r of results) {
    for (const h of r.hotspots) {
      const id = `${h.latitude},${h.longitude},${h.detectedAt}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const { distanceKm, bearingDeg, ...rest } = h;  // relative to one node; meaningless network-wide
      hotspots.push(rest);
    }
  }
  const satelliteStatus = !firms.isConfigured() ? 'not_configured'
      : !located.length ? 'no_located_nodes'
          : results.some(r => r.status === 'ok') ? 'ok' : 'unavailable';

  return {
    generatedAt: new Date().toISOString(),
    devices: devices.map(d => ({ ...d.toJSON(), isDemo: d.type === 'demo' })),
    openIncidents,
    satellite: { status: satelliteStatus, radiusKm: firms.DEFAULT_RADIUS_KM, hotspots },
  };
}

module.exports = { incidentContext, mapOverview };
