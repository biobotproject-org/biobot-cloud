const express = require('express');
const { Sequelize } = require('sequelize');
const { Reading, Device } = require('../models');
const { authenticate } = require('../middleware/authenticate');
const { maxSeverity } = require('../services/severity');
const router = express.Router();

// The dashboard links nodes three ways: the database id (/devices/3), the
// id the firmware was configured with (biobot-001), and the Notecard UID
// Notehub stamps on every event (dev:864475046123456). Accept all three so
// a caller never gets another node's data because it picked the wrong one.
async function resolveDevice(id) {
  const key = String(id).trim();
  if (!key) return null;
  if (/^\d+$/.test(key)) return Device.findByPk(key);
  if (key.startsWith('dev:')) return Device.findOne({ where: { notecardUid: key } });
  return Device.findOne({ where: { deviceId: key } });
}

function emptyPage(filters, page, limit) {
  return {
    count: 0, totalRequests: 0, totalReadings: 0, page, totalPages: 0, limit,
    filters: {
      ...filters,
      sortBy: filters.sortBy || 'timestamp',
      sortOrder: String(filters.sortOrder || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC',
    },
    requests: [],
  };
}

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
 *         anomalySeverity:
 *           type: string
 *           nullable: true
 *           enum: [none, watch, alert, critical, fault]
 *           description: Highest on-device anomaly severity among the group's readings
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
 *               anomalySeverity:
 *                 type: string
 *                 nullable: true
 *                 enum: [none, watch, alert, critical, fault]
 *                 description: On-device anomaly severity at the time of this sample
 *               anomalyScore:
 *                 type: integer
 *                 nullable: true
 *                 description: On-device anomaly score at the time of this sample
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
 *         description: >
 *           Filter to one node, given as its database id, its configured
 *           deviceId (e.g. biobot-001), or its Notecard UID (dev:...). An
 *           id that matches no node returns an empty page.
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
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 100;
    const offset = (pageNum - 1) * limitNum;

    if (readingType) {
      where.readingType = readingType;
    }

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp[Sequelize.Op.gte] = new Date(startDate);
      if (endDate) where.timestamp[Sequelize.Op.lte] = new Date(endDate);
    }

    if (deviceId) {
      const device = await resolveDevice(deviceId);
      if (!device) {
        // An unknown device has no readings. Dropping the filter here used to
        // return every node's readings, which the dashboard then plotted as
        // one device.
        return res.json(emptyPage({ deviceId, readingType, startDate, endDate, requestId, minValue, maxValue, unit, sortBy, sortOrder }, pageNum, limitNum));
      }
      where.deviceId = device.id;
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
          anomalySeverity: null,
          readings: []
        };
      }
      groupedByRequestId[reqId].readings.push({
        id: reading.id,
        value: reading.value,
        unit: reading.unit,
        readingType: reading.readingType,
        timestamp: reading.timestamp,
        anomalySeverity: reading.anomalySeverity,
        anomalyScore: reading.anomalyScore
      });
      groupedByRequestId[reqId].anomalySeverity = maxSeverity(groupedByRequestId[reqId].anomalySeverity, reading.anomalySeverity);
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
        anomalySeverity: null,
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