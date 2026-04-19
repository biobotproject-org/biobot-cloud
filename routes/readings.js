const express = require('express');
const { Sequelize } = require('sequelize');
const { Reading, Device } = require('../models');
const { authenticate } = require('../middleware/authenticate');
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Readings
 *   description: Historical sensor data retrieval
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ReadingGroup:
 *       type: object
 *       properties:
 *         requestId:
 *           type: string
 *           format: uuid
 *         timestamp:
 *           type: string
 *           format: date-time
 *         deviceId:
 *           type: string
 *         deviceName:
 *           type: string
 *         deviceType:
 *           type: string
 *         readingCount:
 *           type: integer
 *         readings:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id:
 *                 type: integer
 *               value:
 *                 type: number
 *               unit:
 *                 type: string
 *               readingType:
 *                 type: string
 *               timestamp:
 *                 type: string
 *                 format: date-time
 */

/**
 * @swagger
 * /readings:
 *   get:
 *     summary: Query historical sensor readings
 *     description: >
 *       Returns historical readings grouped by their submission requestId.
 *       Supports filtering by device, date range, value range, and pagination.
 *     tags: [Readings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: deviceId
 *         schema:
 *           type: string
 *         description: Filter by string device ID
 *       - in: query
 *         name: readingType
 *         schema:
 *           type: string
 *         description: Filter by sensor type (e.g. temperature)
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start of time range
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End of time range
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Number of request groups per page
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *     responses:
 *       200:
 *         description: A paginated list of reading groups
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                 totalRequests:
 *                   type: integer
 *                 totalReadings:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
 *                 requests:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ReadingGroup'
 *       500:
 *         description: Server error
 */
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

    const validGroupSortFields = ['timestamp', 'readingCount'];
    const groupSortField = validGroupSortFields.includes(sortBy) ? sortBy : 'timestamp';

    const groupedRequestsPage = await Reading.findAll({
      where,
      attributes: [
        'requestId',
        [Sequelize.fn('MAX', Sequelize.col('timestamp')), 'timestamp'],
        [Sequelize.fn('COUNT', Sequelize.col('id')), 'readingCount']
      ],
      group: ['requestId'],
      order: [[Sequelize.literal(groupSortField), orderDirection]],
      limit: limitNum,
      offset,
      raw: true,
      subQuery: false
    });

    const [totalRequests, totalReadings] = await Promise.all([
      Reading.count({ where, distinct: true, col: 'requestId' }),
      Reading.count({ where })
    ]);

    const requestIds = groupedRequestsPage.map(group => group.requestId);

    let readings = [];
    if (requestIds.length > 0) {
      readings = await Reading.findAll({
        where: {
          ...where,
          requestId: { [Sequelize.Op.in]: requestIds }
        },
        include: [{ model: Device, as: 'device' }],
        order: [['timestamp', orderDirection]]
      });
    }

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

    const groupedRequests = groupedRequestsPage.map(group => {
      const reqId = group.requestId;
      const groupedRequest = groupedByRequestId[reqId] || {
        requestId: reqId,
        timestamp: group.timestamp,
        deviceId: null,
        deviceName: null,
        deviceType: null,
        readingCount: Number(group.readingCount) || 0,
        readings: []
      };

      groupedRequest.timestamp = group.timestamp;
      groupedRequest.readingCount = Number(group.readingCount) || groupedRequest.readingCount;
      return groupedRequest;
    });

    const totalPages = Math.ceil(totalRequests / limitNum);

    res.json({ 
      count: groupedRequests.length,
      totalRequests: totalRequests,
      totalReadings,
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