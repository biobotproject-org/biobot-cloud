const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { ApiKey } = require('../models');

// Credentials a Notehub route may present to POST /ingest/notehub.
//
// Preferred: an API key with scope 'ingest', created in the dashboard and
// stored as a bcrypt hash. Fallback: the legacy NOTEHUB_INGEST_TOKEN env
// value, compared in constant time. Ingest keys never act as a user; see
// middleware/authenticate.js for the matching rejection.

let warnedAboutEnvToken = false;

// Returns { id, name } for a valid ingest-scoped key, or null.
async function matchIngestKey(presented) {
  if (typeof presented !== 'string' || !presented.startsWith('sk_')) return null;
  const candidate = await ApiKey.findOne({ where: { prefix: presented.substring(0, 8), scope: 'ingest' } });
  if (!candidate || !(await bcrypt.compare(presented, candidate.key))) return null;
  await candidate.update({ lastUsedAt: new Date() });
  return { id: candidate.id, name: candidate.name };
}

function envTokenMatches(presented) {
  const expected = process.env.NOTEHUB_INGEST_TOKEN || '';
  if (!expected || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function warnEnvTokenOnce() {
  if (warnedAboutEnvToken) return;
  warnedAboutEnvToken = true;
  console.warn('[ingest] NOTEHUB_INGEST_TOKEN is deprecated; create an ingest key in the dashboard');
}

function hasIngestKeys() {
  return ApiKey.count({ where: { scope: 'ingest' } }).then(n => n > 0);
}

// Resolve a presented bearer to one of:
//   { ok: true, key: { id, name } }   DB ingest key
//   { ok: true, key: null }           legacy env token
//   { ok: false, status, error }
async function authenticateIngestCredential(presented) {
  const key = await matchIngestKey(presented);
  if (key) return { ok: true, key };

  if (process.env.NOTEHUB_INGEST_TOKEN) {
    if (envTokenMatches(presented)) {
      warnEnvTokenOnce();
      return { ok: true, key: null };
    }
    return { ok: false, status: 401, error: 'Invalid ingest token' };
  }

  if (!(await hasIngestKeys())) {
    return { ok: false, status: 503, error: 'No ingest key configured. Create an ingest key in the dashboard (API Keys -> New key -> scope Ingest).' };
  }
  return { ok: false, status: 401, error: 'Invalid ingest token' };
}

module.exports = { authenticateIngestCredential, matchIngestKey, envTokenMatches, hasIngestKeys, _resetWarning: () => { warnedAboutEnvToken = false; } };
