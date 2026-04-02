const express = require('express');
const { Sequelize } = require('sequelize');
const { PowerEvent, Location } = require('../models');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

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
