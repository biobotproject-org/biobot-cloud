// Current surface weather at a point, from Open-Meteo.
//
// Open-Meteo needs no key and is free for non-commercial use (CC BY 4.0,
// attribution shown in the dashboard). Wind is what matters here: it sets
// which way smoke and fire travel from a node. Lookups snap to a 0.1°
// (~10 km) cell, about the resolution of the global models behind it, so
// nodes in one area share one wind and one cached call for WEATHER_TTL_MS.
//
// A failed lookup never throws; callers get { status: 'unavailable' } and
// carry on without wind.

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const WEATHER_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;

let fetcher = (...args) => fetch(...args);
const cache = new Map();

const CELL_DEG = 0.1;
const snap = v => Math.round(Math.round(v / CELL_DEG) * CELL_DEG * 1e4) / 1e4;

// The centre of the weather cell containing a point.
function cellCenter(lat, lon) {
  return { latitude: snap(Number(lat)), longitude: snap(Number(lon)) };
}

async function currentWeather(latitude, longitude) {
  const lat = Number(latitude), lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { status: 'unavailable', error: 'No coordinates' };
  }
  const cellLat = snap(lat), cellLon = snap(lon);
  const key = `${cellLat.toFixed(2)},${cellLon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < WEATHER_TTL_MS) return hit.value;

  const params = new URLSearchParams({
    latitude: cellLat.toFixed(2),
    longitude: cellLon.toFixed(2),
    current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    wind_speed_unit: 'kmh',
    timezone: 'UTC',
  });

  let value;
  try {
    const res = await fetcher(`${OPEN_METEO_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const c = (await res.json()).current;
    if (!c || !Number.isFinite(Number(c.wind_speed_10m)) || !Number.isFinite(Number(c.wind_direction_10m))) {
      throw new Error('Open-Meteo response has no current wind');
    }
    value = {
      status: 'ok',
      source: 'open-meteo',
      observedAt: c.time ? new Date(`${c.time}Z`).toISOString() : new Date().toISOString(),
      temperatureC: Number(c.temperature_2m),
      humidityPct: Number(c.relative_humidity_2m),
      windSpeedKmh: Number(c.wind_speed_10m),
      windGustKmh: Number.isFinite(Number(c.wind_gusts_10m)) ? Number(c.wind_gusts_10m) : null,
      // Meteorological convention: the direction the wind blows FROM.
      windFromDeg: Number(c.wind_direction_10m),
    };
  } catch (err) {
    console.error(`[weather] ${key}: ${err.message}`);
    // Do not cache failures for long; retry on the next minute.
    value = { status: 'unavailable', error: err.message };
    cache.set(key, { at: Date.now() - WEATHER_TTL_MS + 60 * 1000, value });
    return value;
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

function _setFetch(fn) { fetcher = fn; }
function _reset() { cache.clear(); fetcher = (...args) => fetch(...args); }

module.exports = { currentWeather, cellCenter, CELL_DEG, _setFetch, _reset };
