const express = require('express');
const { param, body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/authenticate');
const { requireAdmin } = require('../middleware/requireAdmin');
const users = require('../services/users');
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: The signed-in user, and user administration for admins
 */

function rejectInvalid(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return true;
  }
  return false;
}

function sendError(res, err) {
  res.status(err.status || 500).json({ error: err.message });
}

/**
 * @swagger
 * /me:
 *   get:
 *     summary: The signed-in user, with the role currently in the database
 *     description: >
 *       The dashboard calls this on load so a role change made by an admin
 *       takes effect without signing out and in again.
 *     tags: [Users]
 *     security: [{ ApiKeyAuth: [] }]
 *     responses:
 *       200: { description: "{ id, username, email, role }" }
 *       401: { description: Not signed in }
 */
router.get('/me', authenticate, (req, res) => {
  const { id, username, email, role } = req.user;
  res.json({ id, username, email, role });
});

/**
 * @swagger
 * /users:
 *   get:
 *     summary: List all users (admins only)
 *     description: >
 *       Each user comes with counts of their ingest keys, other API keys and
 *       owned devices. Deleting a user revokes their keys, so a non-zero
 *       `ingestKeys` means a Notehub route depends on that account.
 *     tags: [Users]
 *     security: [{ ApiKeyAuth: [] }]
 *     responses:
 *       200: { description: "Array of { id, username, email, role, createdAt, ingestKeys, apiKeys, devices }" }
 *       403: { description: Admins only }
 */
router.get('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    res.json(await users.listUsers());
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * @swagger
 * /users/{id}/role:
 *   patch:
 *     summary: Change a user's role (admins only)
 *     description: >
 *       The only way a role changes; registration never accepts one. An admin
 *       cannot demote themselves, and the last admin cannot be demoted.
 *     tags: [Users]
 *     security: [{ ApiKeyAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [admin, user] }
 *     responses:
 *       200: { description: Updated user }
 *       403: { description: Admins only }
 *       404: { description: Not found }
 *       409: { description: Would demote yourself or the last admin }
 */
router.patch('/users/:id/role', authenticate, requireAdmin,
    param('id').isInt({ min: 1 }),
    body('role').isIn(users.ROLES),
    async (req, res) => {
      if (rejectInvalid(req, res)) return;
      try {
        const u = await users.setRole(req.user, Number(req.params.id), req.body.role);
        res.json({ id: u.id, username: u.username, email: u.email, role: u.role });
      } catch (err) {
        sendError(res, err);
      }
    });

/**
 * @swagger
 * /users/{id}:
 *   delete:
 *     summary: Delete a user (admins only)
 *     description: >
 *       Revokes all of the user's API keys (including ingest keys used by
 *       Notehub routes), removes their alert acknowledgements, and clears
 *       them as owner of devices and acknowledger of incidents. Incident
 *       outcomes they recorded are kept. You cannot delete yourself or the
 *       last admin.
 *     tags: [Users]
 *     security: [{ ApiKeyAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "{ deleted, revokedKeys }" }
 *       403: { description: Admins only }
 *       404: { description: Not found }
 *       409: { description: Would delete yourself or the last admin }
 */
router.delete('/users/:id', authenticate, requireAdmin, param('id').isInt({ min: 1 }), async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    res.json(await users.deleteUser(req.user, Number(req.params.id)));
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
