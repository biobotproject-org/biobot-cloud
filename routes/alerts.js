const express = require('express');
const { Alert, Device, Location, AlertAcknowledgment, User } = require('../models');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

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

router.post('/alerts/:id/acknowledge', authenticate, async (req, res) => {
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