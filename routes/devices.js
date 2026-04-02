const express = require('express');
const { Device, Location, Reading } = require('../models');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

router.get('/devices', authenticate, async (req, res) => {
  try {
    const { status, type, locationId } = req.query;
    const where = {};

    if (status) where.status = status;
    if (type) where.type = type;
    if (locationId) where.locationId = locationId;

    const devices = await Device.findAll({
      where,
      include: [
        { model: Location, as: 'location' },
      ]
    });

    res.json({ count: devices.length, devices });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/devices', authenticate, async (req, res) => {
  try {
    const { deviceId, name, type, locationId, status } = req.body;

    if (!deviceId || !name || !type) {
      return res.status(400).json({ error: 'deviceId, name, and type are required.' });
    }

    const existing = await Device.findOne({ where: { deviceId } });
    if (existing) {
      return res.status(409).json({ error: 'Device ID already exists.' });
    }

    if (locationId) {
      const location = await Location.findByPk(locationId);
      if (!location) {
        return res.status(404).json({ error: 'Location not found.' });
      }
    }

    const newDevice = await Device.create({
      deviceId,
      name,
      type,
      locationId: locationId || null,
      status: status || 'active',
      lastSeen: new Date()
    });

    res.status(201).json({
      message: 'Device created successfully.',
      device: newDevice
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/devices/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const device = await Device.findByPk(id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found.' });
    }

    await Reading.destroy({ where: { deviceId: id } });
    await device.destroy();

    res.json({ message: 'Device and its readings deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


router.patch('/devices/:id/status', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required.' });
    }

    const validStatuses = ['active', 'inactive', 'maintenance', 'hibernation'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Valid options: ${validStatuses.join(', ')}` });
    }

    const device = await Device.findByPk(id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found.' });
    }

    device.status = status;
    device.lastSeen = new Date(); 
    await device.save();

    res.json({ message: 'Device status and last seen updated successfully.', device });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
