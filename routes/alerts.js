const express = require('express');
const { Alert, Device, Location, AlertAcknowledgment, User } = require('../models');
const { authenticate } = require('../middleware/authenticate');
const { validateAcknowledgeAlert } = require('../middleware/validate');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Alerts
 *   description: Alert monitoring and acknowledgment
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     AlertAcknowledgment:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 5
 *         acknowledgedAt:
 *           type: string
 *           format: date-time
 *           example: "2026-04-18T16:00:00.000Z"
 *         notes:
 *           type: string
 *           example: "Investigating the sensor reading"
 *         user:
 *           $ref: '#/components/schemas/UserProfile'
 *
 *     Alert:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 101
 *         severity:
 *           type: string
 *           enum: [low, medium, high, critical]
 *           example: "high"
 *         message:
 *           type: string
 *           example: "High temperature detected: 95.4°C"
 *         status:
 *           type: string
 *           enum: [active, acknowledged, resolved]
 *           example: "active"
 *         triggeredAt:
 *           type: string
 *           format: date-time
 *           example: "2026-04-18T14:22:00.000Z"
 *         device:
 *           $ref: '#/components/schemas/Device'
 *         acknowledgments:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AlertAcknowledgment'
 */

/**
 * @swagger
 * /alerts:
 *   get:
 *     summary: List all alerts
 *     description: Returns a list of alerts, optionally filtered by status, severity, or device.
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, acknowledged, resolved]
 *         description: Filter by alert status
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [low, medium, high, critical]
 *         description: Filter by alert severity
 *       - in: query
 *         name: deviceId
 *         schema:
 *           type: string
 *         description: Filter by the string device ID (e.g. "BIOBOT-001")
 *     responses:
 *       200:
 *         description: A list of alerts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                   example: 1
 *                 alerts:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Alert'
 *       500:
 *         description: Server error
 */
router.get('/alerts', authenticate, async (req, res) => {
  try {
    const { status, severity, deviceId } = req.query;

    const where = {};
    if (status) where.status = status;
    if (severity) where.severity = severity;

    if (deviceId) {
      const device = await Device.findOne({ where: { deviceId } });
      if (device) where.deviceId = device.id;
    }

    const alerts = await Alert.findAll({
      where,
      include: [
        { model: Device, as: 'device', include: [{ model: Location, as: 'location' }] },
        { model: AlertAcknowledgment, as: 'acknowledgments', include: [{ model: User, as: 'user' }] }
      ],
      order: [['triggeredAt', 'DESC']]
    });

    res.json({ count: alerts.length, alerts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /alerts/{id}/acknowledge:
 *   post:
 *     summary: Acknowledge an alert
 *     description: Sets an alert's status to "acknowledged" and records user notes.
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The numeric ID of the alert to acknowledge
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *                 example: "Checking the sensor hardware"
 *     responses:
 *       200:
 *         description: Alert acknowledged successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Alert acknowledged successfully"
 *                 alert:
 *                   $ref: '#/components/schemas/Alert'
 *       400:
 *         description: Alert already acknowledged or invalid request
 *       404:
 *         description: Alert not found
 */
router.post('/alerts/:id/acknowledge', authenticate, validateAcknowledgeAlert, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const alert = await Alert.findByPk(id);
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    if (alert.status === 'acknowledged') {
      return res.status(400).json({ error: 'Alert already acknowledged' });
    }

    await alert.update({ status: 'acknowledged' });

    await AlertAcknowledgment.create({
      alertId: alert.id,
      userId: req.user.id,
      notes,
      acknowledgedAt: new Date()
    });

    const updatedAlert = await Alert.findByPk(id, {
      include: [
        { model: Device, as: 'device' },
        { model: AlertAcknowledgment, as: 'acknowledgments', include: [{ model: User, as: 'user' }] }
      ]
    });

    res.json({
      message: 'Alert acknowledged successfully',
      alert: updatedAlert
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;