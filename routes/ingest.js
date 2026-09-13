const express = require('express');
const { ingest } = require('../services/ingest');
const { authenticateIngestCredential } = require('../services/ingestKeys');
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Ingest
 *   description: Endpoint that Blues Notehub routes deliver sensor-node notes to
 */

// Notehub routes cannot sign requests, so the route sends a fixed bearer in
// the Authorization header: an ingest-scoped API key from the dashboard, or
// the legacy NOTEHUB_INGEST_TOKEN. services/ingestKeys.js does the matching.
async function authenticateNotehub(req, res, next) {
  const header = req.headers.authorization || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : (req.headers['x-ingest-token'] || '');
  try {
    const result = await authenticateIngestCredential(presented);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    req.ingestKey = result.key;
    next();
  } catch (err) {
    console.error(`[ingest] auth failed: ${err.stack || err.message}`);
    res.status(500).json({ error: 'Ingest authentication failed' });
  }
}

/**
 * @swagger
 * /ingest/notehub:
 *   post:
 *     summary: Receive a note forwarded by a Blues Notehub route
 *     description: >
 *       Configure a Notehub HTTP route to POST every event from the fleet to
 *       this endpoint with the header `Authorization: Bearer <ingest key>`,
 *       where the key was created in the dashboard with scope `ingest`
 *       (`POST /api-keys` with `scope: ingest`). Such keys can only reach
 *       this endpoint. The legacy `NOTEHUB_INGEST_TOKEN` environment value
 *       is still accepted as a fallback and logs a deprecation warning.
 *       When a dashboard key was used the response includes `ingestKey`
 *       with the key's name.
 *       The body is Notehub's JSON event envelope. The server dispatches on
 *       the `file` field: `device.qo` registers or updates a node, `data.qo`
 *       stores readings, `alert.qo` opens, updates, or closes an incident and
 *       sends notifications. Other files are acknowledged and ignored, except
 *       that `_health.qo` also stores `body.voltage` as the node's supply
 *       voltage (live Notehub envelopes carry no top-level `voltage`); an
 *       envelope `voltage` is still honoured as a fallback. Unknown Notecard
 *       UIDs on system files create nothing.
 *     tags: [Ingest]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               file:     { type: string, example: alert.qo }
 *               device:   { type: string, example: "dev:864475046123456" }
 *               when:     { type: integer, example: 1757700000 }
 *               best_lat: { type: number, example: 49.888 }
 *               best_lon: { type: number, example: -119.496 }
 *               voltage:  { type: number, example: 4.98 }
 *               body:     { type: object, description: The JSON the node placed in the note }
 *     responses:
 *       200: { description: Event processed }
 *       400: { description: Malformed event }
 *       401: { description: Bad or missing ingest key or token }
 *       503: { description: No ingest key exists and NOTEHUB_INGEST_TOKEN is not set }
 */
router.post('/ingest/notehub', authenticateNotehub, async (req, res) => {
  try {
    const result = await ingest(req.body, { baseUrl: process.env.DASHBOARD_URL });
    if (req.ingestKey) result.ingestKey = req.ingestKey.name;
    res.status(200).json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`[ingest] ${err.stack || err.message}`);
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
