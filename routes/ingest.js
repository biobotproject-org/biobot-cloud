const express = require('express');
const crypto = require('crypto');
const { ingest } = require('../services/ingest');
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Ingest
 *   description: Endpoint that Blues Notehub routes deliver sensor-node notes to
 */

// Notehub routes cannot sign requests, so the route is configured to send a
// fixed bearer token in the Authorization header. Compare in constant time.
function tokenMatches(presented) {
  const expected = process.env.NOTEHUB_INGEST_TOKEN || '';
  if (!expected || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authenticateNotehub(req, res, next) {
  if (!process.env.NOTEHUB_INGEST_TOKEN) {
    return res.status(503).json({ error: 'NOTEHUB_INGEST_TOKEN is not configured on this server' });
  }
  const header = req.headers.authorization || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : (req.headers['x-ingest-token'] || '');
  if (!tokenMatches(presented)) {
    return res.status(401).json({ error: 'Invalid ingest token' });
  }
  next();
}

/**
 * @swagger
 * /ingest/notehub:
 *   post:
 *     summary: Receive a note forwarded by a Blues Notehub route
 *     description: >
 *       Configure a Notehub HTTP route to POST every event from the fleet to
 *       this endpoint with the header `Authorization: Bearer <NOTEHUB_INGEST_TOKEN>`.
 *       The body is Notehub's JSON event envelope. The server dispatches on
 *       the `file` field: `device.qo` registers or updates a node, `data.qo`
 *       stores readings, `alert.qo` opens, updates, or closes an incident and
 *       sends notifications. Other files are acknowledged and ignored.
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
 *       401: { description: Bad or missing ingest token }
 *       503: { description: Ingest token not configured }
 */
router.post('/ingest/notehub', authenticateNotehub, async (req, res) => {
  try {
    const result = await ingest(req.body, { baseUrl: process.env.DASHBOARD_URL });
    res.status(200).json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`[ingest] ${err.stack || err.message}`);
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
