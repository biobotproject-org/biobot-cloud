const express = require('express');
const { Device, Location, Reading } = require('../models');
const { authenticate } = require('../middleware/authenticate');
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Devices
 *   description: Device management endpoints
 */

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *
 *   schemas:
 *     Location:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         name:
 *           type: string
 *           example: "Warehouse A"
 *
 *     Device:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 42
 *         deviceId:
 *           type: string
 *           example: "dev-abc-123"
 *         name:
 *           type: string
 *           example: "Temperature Sensor 1"
 *         type:
 *           type: string
 *           example: "temperature"
 *         status:
 *           type: string
 *           enum: [active, inactive, maintenance, hibernation]
 *           example: "active"
 *         locationId:
 *           type: integer
 *           nullable: true
 *           example: 1
 *         lastSeen:
 *           type: string
 *           format: date-time
 *           example: "2026-04-16T10:30:00.000Z"
 *         location:
 *           $ref: '#/components/schemas/Location'
 *
 *     DeviceListResponse:
 *       type: object
 *       properties:
 *         count:
 *           type: integer
 *           example: 3
 *         devices:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Device'
 *
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           example: "An error occurred."
 */

/**
 * @swagger
 * /devices:
 *   get:
 *     summary: List all devices
 *     description: >
 *       Returns a filtered list of all registered devices, optionally narrowed by
 *       status, type, or location. Each device is returned with its associated
 *       location (if any).
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive, maintenance, hibernation]
 *         description: Filter devices by their current status.
 *         example: active
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter devices by type (e.g. "temperature", "humidity").
 *         example: temperature
 *       - in: query
 *         name: locationId
 *         schema:
 *           type: integer
 *         description: Filter devices by their assigned location ID.
 *         example: 1
 *     responses:
 *       200:
 *         description: Successfully retrieved the list of devices.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceListResponse'
 *       401:
 *         description: Unauthorized — missing or invalid authentication token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @swagger
 * /devices:
 *   post:
 *     summary: Register a new device
 *     description: >
 *       Creates a new device record. The `deviceId`, `name`, and `type` fields
 *       are required. If a `locationId` is provided it must reference an existing
 *       location. `status` defaults to `"active"` when omitted.
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - deviceId
 *               - name
 *               - type
 *             properties:
 *               deviceId:
 *                 type: string
 *                 description: Unique external identifier for the device.
 *                 example: "dev-abc-123"
 *               name:
 *                 type: string
 *                 description: Human-readable display name.
 *                 example: "Temperature Sensor 1"
 *               type:
 *                 type: string
 *                 description: Category / sensor type of the device.
 *                 example: "temperature"
 *               locationId:
 *                 type: integer
 *                 nullable: true
 *                 description: ID of an existing location to assign the device to.
 *                 example: 1
 *               status:
 *                 type: string
 *                 enum: [active, inactive, maintenance, hibernation]
 *                 description: Initial status. Defaults to "active" if omitted.
 *                 example: "active"
 *     responses:
 *       201:
 *         description: Device created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Device created successfully."
 *                 device:
 *                   $ref: '#/components/schemas/Device'
 *       400:
 *         description: Bad request — required fields are missing.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "deviceId, name, and type are required."
 *       401:
 *         description: Unauthorized — missing or invalid authentication token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: The provided locationId does not match any existing location.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Location not found."
 *       409:
 *         description: Conflict — a device with the given deviceId already exists.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Device ID already exists."
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @swagger
 * /devices/{id}:
 *   delete:
 *     summary: Delete a device and all its readings
 *     description: >
 *       Permanently removes the specified device along with every reading record
 *       that belongs to it. This action is irreversible.
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The primary key (database ID) of the device to delete.
 *         example: 42
 *     responses:
 *       200:
 *         description: Device and all associated readings deleted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Device and its readings deleted successfully."
 *       401:
 *         description: Unauthorized — missing or invalid authentication token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: No device found with the given ID.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Device not found."
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @swagger
 * /devices/{id}/status:
 *   patch:
 *     summary: Update a device's status
 *     description: >
 *       Updates the `status` field of the specified device and automatically
 *       refreshes its `lastSeen` timestamp to the current time.
 *       Valid statuses are: `active`, `inactive`, `maintenance`, `hibernation`.
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The primary key (database ID) of the device to update.
 *         example: 42
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, inactive, maintenance, hibernation]
 *                 description: The new status to apply to the device.
 *                 example: "maintenance"
 *     responses:
 *       200:
 *         description: Device status updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Device status and last seen updated successfully."
 *                 device:
 *                   $ref: '#/components/schemas/Device'
 *       400:
 *         description: Bad request — status is missing or not a valid value.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               missing:
 *                 summary: Status field absent
 *                 value:
 *                   error: "Status is required."
 *               invalid:
 *                 summary: Status value not allowed
 *                 value:
 *                   error: "Invalid status. Valid options: active, inactive, maintenance, hibernation"
 *       401:
 *         description: Unauthorized — missing or invalid authentication token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: No device found with the given ID.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Device not found."
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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