const express = require('express');
const { Sequelize } = require('sequelize');
const { PowerEvent, Location } = require('../models');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Power Status
 *   description: Monitoring grid power events and outages
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     PowerEvent:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         locationId:
 *           type: integer
 *         eventType:
 *           type: string
 *           enum: [outage, restoration]
 *         startTime:
 *           type: string
 *           format: date-time
 *         endTime:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         location:
 *           $ref: '#/components/schemas/Location'
 */

/**
 * @swagger
 * /power-status:
 *   get:
 *     summary: List power events and outages
 *     description: Returns a history of power events and a summary of currently active outages.
 *     tags: [Power Status]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: locationId
 *         schema:
 *           type: integer
 *         description: Filter by location ID
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter events starting after this date
 *     responses:
 *       200:
 *         description: Power status data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 activeOutages:
 *                   type: integer
 *                   example: 1
 *                 totalEvents:
 *                   type: integer
 *                   example: 15
 *                 events:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PowerEvent'
 *                 currentOutages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PowerEvent'
 */
router.get('/power-status', authenticate, async (req, res) => {
  try {
    const { locationId, startDate, endDate } = req.query;
    
    const where = {};
    if (locationId) where.locationId = locationId;
    if (startDate || endDate) {
      where.startTime = {};
      if (startDate) where.startTime[Sequelize.Op.gte] = new Date(startDate);
      if (endDate) where.startTime[Sequelize.Op.lte] = new Date(endDate);
    }

    const powerEvents = await PowerEvent.findAll({
      where,
      include: [{ model: Location, as: 'location' }],
      order: [['startTime', 'DESC']]
    });

    const activeOutages = await PowerEvent.findAll({
      where: {
        eventType: 'outage',
        endTime: null
      },
      include: [{ model: Location, as: 'location' }]
    });

    res.json({
      activeOutages: activeOutages.length,
      totalEvents: powerEvents.length,
      events: powerEvents,
      currentOutages: activeOutages
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
