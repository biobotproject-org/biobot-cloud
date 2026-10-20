const express = require('express');
const { param, body, validationResult } = require('express-validator');
const { Incident, Device } = require('../models');
const { authenticate } = require('../middleware/authenticate');
const { incidentContext, mapOverview } = require('../services/situation');
const demo = require('../services/demo');
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Situation
 *   description: Live map data, wind-driven spread envelopes, satellite cross-checks, and the demo fire
 */

function rejectInvalid(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return true;
  }
  return false;
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
}

/**
 * @swagger
 * /map:
 *   get:
 *     summary: Everything the live map draws, in one call
 *     description: >
 *       All nodes with their last position and severity; every open incident
 *       with current wind (Open-Meteo), a spread envelope for 30/60/120
 *       minutes, and the nearest NASA FIRMS satellite hotspot; and all FIRMS
 *       hotspots within 25 km of any node over the last two days.
 *       `satellite.status` is `not_configured` until FIRMS_MAP_KEY is set.
 *       Weather and satellite lookups are cached (10 and 15 minutes), so
 *       polling this every 15 s is fine.
 *     tags: [Situation]
 *     security: [{ ApiKeyAuth: [] }]
 *     responses:
 *       200:
 *         description: Map overview
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 generatedAt: { type: string, format: date-time }
 *                 devices: { type: array, items: { type: object } }
 *                 openIncidents: { type: array, items: { type: object } }
 *                 satellite:
 *                   type: object
 *                   properties:
 *                     status: { type: string, enum: [ok, not_configured, unavailable, no_located_nodes] }
 *                     radiusKm: { type: number }
 *                     hotspots: { type: array, items: { type: object } }
 */
router.get('/map', authenticate, async (req, res) => {
  try {
    res.json(await mapOverview());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /incidents/{id}/context:
 *   get:
 *     summary: Wind, spread envelope and satellite cross-check for one incident
 *     description: >
 *       `spread` is null for closed incidents and when weather is unavailable.
 *       `satellite.nearest` is the closest FIRMS detection within
 *       `satellite.radiusKm`, or null. No detection does not mean no fire.
 *     tags: [Situation]
 *     security: [{ ApiKeyAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Incident context }
 *       404: { description: Not found }
 */
router.get('/incidents/:id/context', authenticate, param('id').isInt({ min: 1 }), async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const incident = await Incident.findByPk(req.params.id, {
      include: [{ model: Device, as: 'device', attributes: ['id', 'deviceId', 'name', 'latitude', 'longitude'] }],
    });
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    res.json({ incidentId: incident.id, status: incident.status, ...(await incidentContext(incident, incident.device)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /demo:
 *   get:
 *     summary: State of the demo fire
 *     tags: [Situation]
 *     security: [{ ApiKeyAuth: [] }]
 *     responses:
 *       200: { description: "{ running, startedAt, finishedAt, center, wind }" }
 *   delete:
 *     summary: Stop the demo and delete every demo node and its data
 *     tags: [Situation]
 *     security: [{ ApiKeyAuth: [] }]
 *     responses:
 *       200: { description: "{ removedDevices }" }
 *       403: { description: Admins only }
 */
router.get('/demo', authenticate, (req, res) => {
  res.json(demo.status());
});

router.delete('/demo', authenticate, requireAdmin, async (req, res) => {
  try {
    res.json(await demo.clearDemo());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /demo/fire:
 *   post:
 *     summary: Start a scripted wildfire on five demo nodes
 *     description: >
 *       Places five demo nodes (type `demo`) around the given point using the
 *       live wind there, then plays about 40 seconds of Notehub notes through
 *       the normal ingest path: downwind nodes raise incidents and escalate,
 *       flanks go to watch, the upwind node stays quiet. No email is sent for
 *       demo nodes. Replaces any earlier demo. The point may move up to
 *       ~2.6 km so all five nodes fall in one 0.1° weather cell and share one
 *       wind. Defaults to Southeast Kelowna BC.
 *     tags: [Situation]
 *     security: [{ ApiKeyAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *     responses:
 *       202: { description: Demo started }
 *       403: { description: Admins only }
 *       409: { description: A demo is already running }
 */
router.post('/demo/fire', authenticate, requireAdmin,
    body('latitude').optional().isFloat({ min: -90, max: 90 }),
    body('longitude').optional().isFloat({ min: -180, max: 180 }),
    async (req, res) => {
      if (rejectInvalid(req, res)) return;
      try {
        const { done, ...started } = await demo.startDemo(req.body || {});
        done.catch(() => {});
        res.status(202).json(started);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

module.exports = router;
