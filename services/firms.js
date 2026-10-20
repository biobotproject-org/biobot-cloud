const { bbox, distanceKm, bearingDeg } = require('./geo');

// Satellite hotspot cross-check against NASA FIRMS (Fire Information for
// Resource Management System). FIRMS publishes active-fire detections from
// VIIRS and MODIS within about three hours of the overpass.
//
// Needs a free MAP_KEY: https://firms.modaps.eosdis.nasa.gov/api/map_key/
// Set FIRMS_MAP_KEY; without it every lookup returns status 'not_configured'
// and nothing else changes. FIRMS_SOURCES overrides the product list.
//
// A satellite seeing nothing is not evidence of no fire: overpasses are a few
// times a day and small or smouldering fires are below detection. The point
// of the cross-check is the other direction: a node raising an incident next
// to a fresh hotspot is very likely a real fire.

const FIRMS_URL = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const DEFAULT_SOURCES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'MODIS_NRT'];
const DAY_RANGE = 2;
const FIRMS_TTL_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 8000;
const DEFAULT_RADIUS_KM = 25;

let fetcher = (...args) => fetch(...args);
const cache = new Map();

function sources() {
  const s = (process.env.FIRMS_SOURCES || '').split(',').map(x => x.trim()).filter(Boolean);
  return s.length ? s : DEFAULT_SOURCES;
}

function isConfigured() {
  return Boolean(process.env.FIRMS_MAP_KEY);
}

// FIRMS CSV: a header row then one detection per line. VIIRS and MODIS
// products have different brightness columns, so read by header name.
function parseCsv(text) {
  const lines = String(text).trim().split(/\r?\n/);
  if (!lines.length || !/latitude/.test(lines[0])) {
    // FIRMS answers a bad key or bad request with a plain-text message.
    throw new Error(`FIRMS: ${lines[0] ? lines[0].slice(0, 120) : 'empty response'}`);
  }
  const header = lines[0].split(',');
  return lines.slice(1).filter(Boolean).map(line => {
    const cols = line.split(',');
    const row = Object.fromEntries(header.map((h, i) => [h, cols[i]]));
    const time = String(row.acq_time || '').padStart(4, '0');
    return {
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      detectedAt: new Date(`${row.acq_date}T${time.slice(0, 2)}:${time.slice(2)}:00Z`).toISOString(),
      satellite: row.satellite || null,
      instrument: row.instrument || null,
      // VIIRS: l / n / h; MODIS: 0-100.
      confidence: row.confidence ?? null,
      frpMw: Number.isFinite(Number(row.frp)) ? Number(row.frp) : null,
      daynight: row.daynight || null,
    };
  }).filter(h => Number.isFinite(h.latitude) && Number.isFinite(h.longitude));
}

async function fetchArea(source, area) {
  const url = `${FIRMS_URL}/${encodeURIComponent(process.env.FIRMS_MAP_KEY)}/${source}/${area.map(n => n.toFixed(3)).join(',')}/${DAY_RANGE}`;
  const res = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`FIRMS ${source} HTTP ${res.status}`);
  return parseCsv(await res.text());
}

// All detections within radiusKm of the point, nearest first, each with its
// distance and bearing from the point.
async function hotspotsNear(latitude, longitude, radiusKm = DEFAULT_RADIUS_KM) {
  const lat = Number(latitude), lon = Number(longitude);
  if (!isConfigured()) return { status: 'not_configured', radiusKm, hotspots: [] };
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { status: 'unavailable', error: 'No coordinates', radiusKm, hotspots: [] };

  const key = `${lat.toFixed(1)},${lon.toFixed(1)},${radiusKm}`;
  const hit = cache.get(key);
  let raw;
  if (hit && Date.now() - hit.at < FIRMS_TTL_MS) {
    raw = hit.value;
  } else {
    // Query a box a little larger than the radius around the cached cell so
    // every point that maps to this cell is covered.
    const area = bbox(Number(lat.toFixed(1)), Number(lon.toFixed(1)), radiusKm + 8);
    const results = await Promise.allSettled(sources().map(s => fetchArea(s, area)));
    const ok = results.filter(r => r.status === 'fulfilled');
    if (!ok.length) {
      const error = results.map(r => r.reason && r.reason.message).filter(Boolean)[0] || 'FIRMS unavailable';
      console.error(`[firms] ${key}: ${error}`);
      return { status: 'unavailable', error, radiusKm, hotspots: [] };
    }
    const seen = new Set();
    raw = [];
    for (const r of ok) {
      for (const h of r.value) {
        const id = `${h.latitude},${h.longitude},${h.detectedAt}`;
        if (!seen.has(id)) { seen.add(id); raw.push(h); }
      }
    }
    raw = { checkedAt: new Date().toISOString(), sources: sources(), hotspots: raw };
    cache.set(key, { at: Date.now(), value: raw });
  }

  const hotspots = raw.hotspots
      .map(h => ({
        ...h,
        distanceKm: Math.round(distanceKm(lat, lon, h.latitude, h.longitude) * 100) / 100,
        bearingDeg: Math.round(bearingDeg(lat, lon, h.latitude, h.longitude)),
      }))
      .filter(h => h.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  return { status: 'ok', checkedAt: raw.checkedAt, sources: raw.sources, dayRange: DAY_RANGE, radiusKm, hotspots };
}

function _setFetch(fn) { fetcher = fn; }
function _reset() { cache.clear(); fetcher = (...args) => fetch(...args); }

module.exports = { hotspotsNear, parseCsv, isConfigured, DEFAULT_RADIUS_KM, _setFetch, _reset };
