const express = require('express');
const { Sequelize } = require('sequelize');
const { Reading, Device } = require('../models');
const { authenticate } = require('../middleware/authenticate');
const router = express.Router();

router.get('/readings', authenticate, async (req, res) => {
  try {
    const { 
      deviceId, 
      readingType, 
      startDate, 
      endDate, 
      limit = 100, 
      requestId,
      minValue,
      maxValue,
      unit,
      sortBy = 'timestamp',
      sortOrder = 'DESC',
      page = 1
    } = req.query;
    
    const where = {};

    if (readingType) {
      where.readingType = readingType;
    }

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp[Sequelize.Op.gte] = new Date(startDate);
      if (endDate) where.timestamp[Sequelize.Op.lte] = new Date(endDate);
    }

    if (deviceId) {
      const device = await Device.findOne({ where: { deviceId } });
      if (device) where.deviceId = device.id;
    }

    if (requestId) {
      where.requestId = requestId;
    }

    if (minValue || maxValue) {
      where.value = {};
      if (minValue) where.value[Sequelize.Op.gte] = parseFloat(minValue);
      if (maxValue) where.value[Sequelize.Op.lte] = parseFloat(maxValue);
    }

    if (unit) {
      where.unit = unit;
    }

    const validSortFields = ['timestamp', 'value', 'readingType', 'id', 'unit'];
    const orderField = validSortFields.includes(sortBy) ? sortBy : 'timestamp';
    const orderDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const readings = await Reading.findAll({
      where,
      include: [{ model: Device, as: 'device' }],
      order: [['timestamp', orderDirection]]
    });

    const groupedByRequestId = {};
    
    readings.forEach(reading => {
      const reqId = reading.requestId;
      if (!groupedByRequestId[reqId]) {
        groupedByRequestId[reqId] = {
          requestId: reqId,
          timestamp: reading.timestamp,
          deviceId: reading.device?.deviceId,
          deviceName: reading.device?.name,
          deviceType: reading.device?.type,
          readingCount: 0,
          readings: []
        };
      }
      groupedByRequestId[reqId].readings.push({
        id: reading.id,
        value: reading.value,
        unit: reading.unit,
        readingType: reading.readingType,
        timestamp: reading.timestamp
      });
      groupedByRequestId[reqId].readingCount++;
    });

    let groupedRequests = Object.values(groupedByRequestId);
    
    const validGroupSortFields = ['timestamp', 'readingCount'];
    if (validGroupSortFields.includes(sortBy)) {
      const sortMultiplier = orderDirection === 'ASC' ? 1 : -1;
      groupedRequests.sort((a, b) => {
        if (a[sortBy] < b[sortBy]) return -sortMultiplier;
        if (a[sortBy] > b[sortBy]) return sortMultiplier;
        return 0;
      });
    }

    const totalRequests = groupedRequests.length;
    const totalPages = Math.ceil(totalRequests / limitNum);
    groupedRequests = groupedRequests.slice(offset, offset + limitNum);

    res.json({ 
      count: groupedRequests.length,
      totalRequests: totalRequests,
      totalReadings: readings.length,
      page: pageNum,
      totalPages,
      limit: limitNum,
      filters: {
        deviceId,
        readingType,
        startDate,
        endDate,
        requestId,
        minValue,
        maxValue,
        unit,
        sortBy: orderField,
        sortOrder: orderDirection
      },
      requests: groupedRequests
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;