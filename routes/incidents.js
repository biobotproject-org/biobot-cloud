const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { Incident, IncidentEvent, Device, User } = require('../models');
const { authenticate } = require('../middleware/authenticate');
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Incidents
 *   description: Anomaly episodes raised by nodes, and what hosts found when they checked
 */

function rejectInvalid(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return true;
  }
  return false;
}

/**
 * @swagger
 * /incidents:
 *   get:
 *     summary: List incidents
 *     tags: [Incidents]
 *     security: [{ ApiKeyAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, closed] }
 *       - in: query
 *         name: deviceId
 *         schema: { type: string }
 *         description: The node's string deviceId
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200: { description: Incidents, newest first }
 */
router.get('/incidents', authenticate,
    query('status').optional().isIn(['open', 'closed']),
    query('limit').optional().isInt({ min: 1, max: 500 }),
    async (req, res) => {
      if (rejectInvalid(req, res)) return;
      try {
        const where = {};
        if (req.query.status) where.status = req.query.status;
        const include = [{ model: Device, as: 'device', attributes: ['id', 'deviceId', 'name', 'latitude', 'longitude'] }];
        if (req.query.deviceId) include[0].where = { deviceId: req.query.deviceId };
        const incidents = await Incident.findAll({
          where, include,
          order: [['openedAt', 'DESC']],
          limit: parseInt(req.query.limit || '50', 10),
        });
        res.json(incidents);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

/**
 * @swagger
 * /incidents/{id}:
 *   get:
 *     summary: One incident with its full event timeline
 *     tags: [Incidents]
 *     security: [{ ApiKeyAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Incident with events }
 *       404: { description: Not found }
 */
router.get('/incidents/:id', authenticate, param('id').isInt({ min: 1 }), async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const incident = await Incident.findByPk(req.params.id, {
      include: [
        { model: Device, as: 'device', attributes: ['id', 'deviceId', 'name', 'latitude', 'longitude'] },
        { model: IncidentEvent, as: 'events' },
        { model: User, as: 'acknowledger', attributes: ['id', 'username', 'email'] },
      ],
      order: [[{ model: IncidentEvent, as: 'events' }, 'occurredAt', 'ASC']],
    });
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    res.json(incident);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /incidents/{id}/acknowledge:
 *   post:
 *     summary: Record what the host found on the drive-out
 *     description: >
 *       Marks the incident acknowledged by the calling user and stores the
 *       outcome. This is the confirmation step in the BioBot model: detect,
 *       drive out, act.
 *     tags: [Incidents]
 *     security: [{ ApiKeyAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [outcome]
 *             properties:
 *               outcome: { type: string, enum: [unknown, fire, false_alarm, sensor_fault] }
 *               notes:   { type: string, maxLength: 2000 }
 *     responses:
 *       200: { description: Updated incident }
 *       404: { description: Not found }
 */
router.post('/incidents/:id/acknowledge', authenticate,
    param('id').isInt({ min: 1 }),
    body('outcome').isIn(['unknown', 'fire', 'false_alarm', 'sensor_fault']),
    body('notes').optional({ values: 'null' }).isString().isLength({ max: 2000 }),
    async (req, res) => {
      if (rejectInvalid(req, res)) return;
      try {
        const incident = await Incident.findByPk(req.params.id);
        if (!incident) return res.status(404).json({ error: 'Incident not found' });
        await incident.update({
          acknowledgedAt: new Date(),
          acknowledgedBy: req.user.id,
          outcome: req.body.outcome,
          outcomeNotes: req.body.notes || null,
        });
        res.json(incident);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

module.exports = router;
