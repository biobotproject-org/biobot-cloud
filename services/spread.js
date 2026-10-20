const { destination } = require('./geo');

// A deliberately simple fire-spread envelope for "where could this be in an
// hour if it is a fire". It is a planning aid for the person driving out,
// not a fire behaviour prediction.
//
// Rate of spread: the 10% wind speed rule of thumb (Cruz & Alexander 2019,
// International Journal of Wildland Fire 28(6)): forward spread in forest and
// shrubland under dry fuel conditions is roughly 10% of the 10-m open wind
// speed. It errs high when fuels are moist, which is the right side to err
// on for this use.
//
// Shape: the Canadian FBP System length-to-breadth ratio for wind-driven
// fires, LB = 1 + 8.729 (1 - e^(-0.030 U))^2.155, U in km/h (ST-X-3, 1992),
// as an ellipse whose rear focus is the node.

const HORIZONS_MIN = [30, 60, 120];
const ELLIPSE_POINTS = 48;
const MIN_RATE_KMH = 0.05;  // calm-air creep, so a zero-wind cone is not a dot
const BACKING_FRACTION = 0.1;

const ASSUMPTIONS = 'Rough guide. Forward spread = 10% of 10-m wind speed (dry forest/shrub fuels); ' +
    'shape from the Canadian FBP length-to-breadth ratio. Ignores terrain, fuel moisture and spotting.';

function lengthToBreadth(windKmh) {
  return 1 + 8.729 * (1 - Math.exp(-0.030 * windKmh)) ** 2.155;
}

// Polygon [[lat, lon], ...] for the area a fire starting at (lat, lon) could
// cover after `minutes`, given the forward rate and heading.
function ellipse(lat, lon, headingDeg, rateKmh, lb, minutes) {
  const head = rateKmh * minutes / 60;
  const back = head * BACKING_FRACTION;
  const a = (head + back) / 2;       // semi-major, km
  const b = a / lb;                  // semi-minor, km
  const offset = (head - back) / 2;  // ellipse centre ahead of the ignition point
  const points = [];
  for (let i = 0; i < ELLIPSE_POINTS; i++) {
    const t = (2 * Math.PI * i) / ELLIPSE_POINTS;
    const along = offset + a * Math.cos(t);  // km downwind
    const across = b * Math.sin(t);          // km to the right of the heading
    const dist = Math.hypot(along, across);
    const bearing = headingDeg + Math.atan2(across, along) * 180 / Math.PI;
    const [plat, plon] = destination(lat, lon, bearing, dist);
    points.push([round(plat), round(plon)]);
  }
  return { minutes, headKm: round(head, 2), polygon: points };
}

function round(n, d = 6) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// weather: the shape returned by services/weather.currentWeather.
function spreadEnvelope(latitude, longitude, weather) {
  const lat = Number(latitude), lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !weather || weather.status !== 'ok') return null;
  const wind = Math.max(0, weather.windSpeedKmh);
  const headingDeg = (weather.windFromDeg + 180) % 360;
  const rateKmh = Math.max(MIN_RATE_KMH, 0.1 * wind);
  const lb = lengthToBreadth(wind);
  return {
    model: '10pct-wind-fbp-lb',
    headingDeg: round(headingDeg, 1),
    rateKmh: round(rateKmh, 2),
    lengthToBreadth: round(lb, 2),
    horizons: HORIZONS_MIN.map(m => ellipse(lat, lon, headingDeg, rateKmh, lb, m)),
    assumptions: ASSUMPTIONS,
  };
}

module.exports = { spreadEnvelope, lengthToBreadth, HORIZONS_MIN };
