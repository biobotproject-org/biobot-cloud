// Anomaly severity vocabulary shared by the firmware, Incident, and Reading.
// Rank orders severities for "highest wins" comparisons; alert and fault are
// peers (both mean "act now" but for different reasons).
const SEVERITY_RANK = { none: 0, watch: 1, alert: 2, critical: 3, fault: 2 };

// Returns the higher-ranked of two severities; unknown or missing values rank
// below `none`, so any tagged severity beats an untagged one.
function maxSeverity(a, b) {
  const ra = a in SEVERITY_RANK ? SEVERITY_RANK[a] : -1;
  const rb = b in SEVERITY_RANK ? SEVERITY_RANK[b] : -1;
  return rb > ra ? b : a;
}

module.exports = { SEVERITY_RANK, maxSeverity };
