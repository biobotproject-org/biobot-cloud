const { Alert, AlertThreshold } = require('../models');

function exceedsThreshold(readingValue, operator, thresholdValue) {
  const v = parseFloat(readingValue);
  const t = parseFloat(thresholdValue);
  switch (operator) {
    case '>':  return v > t;
    case '>=': return v >= t;
    case '<':  return v < t;
    case '<=': return v <= t;
    default:   return false;
  }
}

function formatMessage(template, value, unit) {
  return String(template)
      .replace(/\{value\}/g, value)
      .replace(/\{unit\}/g, unit);
}

async function loadEnabledThresholds() {
  return AlertThreshold.findAll({ where: { enabled: true } });
}

// Evaluate stored readings against the enabled thresholds and create Alert
// rows for any that trip. Returns the created alerts.
async function evaluateThresholds(device, readings, requestId, thresholds) {
  const created = [];
  for (const reading of readings) {
    const matching = thresholds.filter(
        t => t.readingType.toLowerCase() === String(reading.readingType).toLowerCase()
    );
    for (const threshold of matching) {
      if (exceedsThreshold(reading.value, threshold.operator, threshold.thresholdValue)) {
        created.push(await Alert.create({
          deviceId: device.id,
          severity: threshold.severity,
          message: formatMessage(threshold.message, reading.value, reading.unit),
          triggeredAt: new Date(),
          requestId
        }));
      }
    }
  }
  return created;
}

module.exports = { exceedsThreshold, formatMessage, loadEnabledThresholds, evaluateThresholds };
