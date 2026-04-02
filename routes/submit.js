const express = require('express');
const { v4: uuidv4 } = require('uuid'); 
const { Device, Reading, Alert } = require('../models');
const { authenticate } = require('../middleware/authenticate');
const router = express.Router();

router.post('/sensordata', authenticate, async (req, res) => {
  try {
    const { requests } = req.body;
    
    if (!requests || !Array.isArray(requests)) {
      return res.status(400).json({ 
        error: 'Invalid request format. Expected { requests: [...] }' 
      });
    }

    const results = [];

    for (const request of requests) {
      const requestId = uuidv4(); 
      const { deviceId, readings } = request;

      try {
        if (!deviceId || !readings || !Array.isArray(readings)) {
          results.push({
            requestId,
            success: false,
            error: 'Invalid request format: missing deviceId or readings'
          });
          continue;
        }

        const device = await Device.findOne({ where: { deviceId } });
        if (!device) {
          results.push({
            requestId,
            success: false,
            error: 'Device not found'
          });
          continue;
        }

        await device.update({ lastSeen: new Date() });

        const createdReadings = await Promise.all(
          readings.map(reading =>
            Reading.create({
              deviceId: device.id,
              value: reading.value,
              unit: reading.unit,
              readingType: reading.readingType,
              timestamp: reading.timestamp || new Date(),
              requestId 
            })
          )
        );

        for (const reading of readings) {
          if (reading.readingType === 'temperature' && reading.value > 80) {
            await Alert.create({
              deviceId: device.id,
              severity: 'high',
              message: `High temperature detected: ${reading.value}${reading.unit}`,
              triggeredAt: new Date(),
              requestId
            });
          }
        }

        results.push({
          requestId,
          success: true,
          message: 'Readings submitted successfully',
          count: createdReadings.length,
          readings: createdReadings
        });
      } catch (error) {
        results.push({
          requestId,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const statusCode = successCount === results.length ? 201 : 
                       successCount > 0 ? 207 : 400; 

    res.status(statusCode).json({
      totalRequests: results.length,
      successful: successCount,
      failed: results.length - successCount,
      results
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/sensordata', authenticate, async (req, res) => {
  try {
    const { 
      deviceId, 
      limit = 100, 
      requestId,
      readingType,
      startDate,
      endDate,
      sortBy = 'timestamp',
      sortOrder = 'DESC'
    } = req.query;
    
    const where = {};

    if (deviceId) {
      const device = await Device.findOne({ where: { deviceId } });
      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }
      where.deviceId = device.id;
    }

    if (requestId) {
      where.requestId = requestId;
    }

    if (readingType) {
      where.readingType = readingType;
    }

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp[require('sequelize').Op.gte] = new Date(startDate);
      if (endDate) where.timestamp[require('sequelize').Op.lte] = new Date(endDate);
    }

    const validSortFields = ['timestamp', 'value', 'readingType', 'id'];
    const orderField = validSortFields.includes(sortBy) ? sortBy : 'timestamp';
    const orderDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const readings = await Reading.findAll({
      where,
      order: [[orderField, orderDirection]],
      limit: parseInt(limit, 10),
      include: [{ model: Device, as: 'device', attributes: ['deviceId', 'name'] }]
    });

    res.json({ 
      count: readings.length,
      filters: {
        deviceId,
        requestId,
        readingType,
        startDate,
        endDate,
        sortBy: orderField,
        sortOrder: orderDirection
      },
      readings 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Supports ?deviceId=<id> or ?readingId=<id>
router.delete('/sensordata', authenticate, async (req, res) => {
  try {
    const { deviceId, readingId } = req.query;

    if (!deviceId && !readingId) {
      return res.status(400).json({ error: 'Provide deviceId or readingId to delete.' });
    }

    if (readingId) {
      const deleted = await Reading.destroy({ where: { id: readingId } });
      if (!deleted) return res.status(404).json({ error: 'Reading not found.' });
      return res.json({ message: 'Reading deleted successfully.' });
    }

    const device = await Device.findOne({ where: { deviceId } });
    if (!device) return res.status(404).json({ error: 'Device not found.' });

    const deletedCount = await Reading.destroy({ where: { deviceId: device.id } });
    res.json({ message: `Deleted ${deletedCount} readings for device ${deviceId}.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;