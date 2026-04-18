const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User, ApiKey } = require('../models');
const { JWT_SECRET, authenticate } = require('../middleware/authenticate');
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: User registration, login, and API key management
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     UserProfile:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 7
 *         username:
 *           type: string
 *           example: "jane_doe"
 *         email:
 *           type: string
 *           format: email
 *           example: "jane@example.com"
 *         role:
 *           type: string
 *           enum: [user, admin]
 *           example: "user"
 *
 *     AuthResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *           example: "Login successful"
 *         user:
 *           $ref: '#/components/schemas/UserProfile'
 *         token:
 *           type: string
 *           description: Signed JWT valid for 24 hours. Pass as a Bearer token on subsequent requests.
 *           example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *
 *     ApiKeySummary:
 *       type: object
 *       description: A redacted API key record (the raw key value is never returned after creation).
 *       properties:
 *         id:
 *           type: integer
 *           example: 3
 *         name:
 *           type: string
 *           example: "Production key"
 *         description:
 *           type: string
 *           nullable: true
 *           example: "Used by the production data pipeline"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2026-04-16T09:00:00.000Z"
 *         lastUsedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           example: "2026-04-16T11:22:00.000Z"
 *
 *     ApiKeyCreated:
 *       allOf:
 *         - $ref: '#/components/schemas/ApiKeySummary'
 *         - type: object
 *           properties:
 *             key:
 *               type: string
 *               description: >
 *                 The raw API key — only returned once at creation time.
 *                 Store it securely; it cannot be retrieved again.
 *               example: "sk_4a3b2c1d..."
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
 * /register:
 *   post:
 *     summary: Register a new user
 *     description: >
 *       Creates a new user account. The password is hashed with bcrypt before
 *       storage and is never returned. On success a signed JWT (24 h expiry) is
 *       returned so the caller can immediately begin making authenticated requests
 *       without a separate login step. All new accounts are assigned the `"user"`
 *       role server-side; the `role` field is not accepted from the request body.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - email
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 example: "jane_doe"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "jane@example.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 1
 *                 example: "S3cur3P@ss!"
 *     responses:
 *       201:
 *         description: User registered successfully. JWT included in response.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/AuthResponse'
 *                 - type: object
 *                   properties:
 *                     message:
 *                       example: "User registered successfully"
 *       400:
 *         description: >
 *           Bad request — required fields are missing, or a database/validation
 *           constraint was violated (e.g. duplicate username or email).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               missingFields:
 *                 summary: Required fields absent
 *                 value:
 *                   error: "Missing required fields"
 *               duplicate:
 *                 summary: Username or email already taken
 *                 value:
 *                   error: "Validation error: username must be unique"
 */
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      role: 'user'  // always assigned server-side; callers cannot elevate their own role
    });
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '24h' });
    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      },
      token
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /login:
 *   post:
 *     summary: Authenticate a user and obtain a JWT
 *     description: >
 *       Accepts either `username` or `email` together with `password`.
 *       At least one of `username` / `email` must be provided alongside `password`.
 *       Returns a signed JWT (24 h expiry) on success. For security, both
 *       "user not found" and "wrong password" scenarios return the same
 *       `401 Invalid credentials` response to prevent user enumeration.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 description: Provide either username or email (not both required).
 *                 example: "jane_doe"
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Provide either username or email (not both required).
 *                 example: "jane@example.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "S3cur3P@ss!"
 *     responses:
 *       200:
 *         description: Login successful. JWT included in response.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Bad request — password and at least one of username/email are required.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Missing required fields"
 *       401:
 *         description: Invalid credentials — user not found or password incorrect.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Invalid credentials"
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/login', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if ((!username && !email) || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const user = await User.findOne({
      where: username ? { username } : { email }
    });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '24h' });
    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      },
      token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api-keys:
 *   post:
 *     summary: Create a new API key
 *     description: >
 *       Generates a new cryptographically random API key (`sk_` prefix + 64 hex
 *       characters) and associates it with the authenticated user. The raw key
 *       is returned **once** in this response and is then hashed before storage —
 *       it cannot be retrieved again. Store it securely immediately.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: A short label to identify this key.
 *                 example: "Production key"
 *               description:
 *                 type: string
 *                 nullable: true
 *                 description: Optional longer description of the key's purpose.
 *                 example: "Used by the production data pipeline"
 *     responses:
 *       201:
 *         description: API key created. The raw key value is included — save it now.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "API key created successfully"
 *                 apiKey:
 *                   $ref: '#/components/schemas/ApiKeyCreated'
 *                 warning:
 *                   type: string
 *                   example: "Save this API key securely. You will not be able to see it again."
 *       400:
 *         description: Bad request — name is required.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "API key name is required"
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
router.post('/api-keys', authenticate, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'API key name is required' });
    }
    const apiKey = `sk_${crypto.randomBytes(32).toString('hex')}`;
    const hashedApiKey = await bcrypt.hash(apiKey, 10);
    const apiKeyRecord = await ApiKey.create({
      userId: req.user.id,
      name,
      description,
      key: hashedApiKey,
      prefix: apiKey.substring(0, 8),
      lastUsedAt: null
    });
    res.status(201).json({
      message: 'API key created successfully',
      apiKey: {
        id: apiKeyRecord.id,
        name: apiKeyRecord.name,
        description: apiKeyRecord.description,
        key: apiKey,
        createdAt: apiKeyRecord.createdAt
      },
      warning: 'Save this API key securely. You will not be able to see it again.'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api-keys:
 *   get:
 *     summary: List all API keys for the authenticated user
 *     description: >
 *       Returns all API keys belonging to the currently authenticated user,
 *       ordered newest-first. Raw key values are never included — only metadata
 *       such as name, description, creation date, and last-used timestamp.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully retrieved API key list.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 apiKeys:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ApiKeySummary'
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
router.get('/api-keys', authenticate, async (req, res) => {
  try {
    const apiKeys = await ApiKey.findAll({
      where: { userId: req.user.id },
      attributes: ['id', 'name', 'description', 'createdAt', 'lastUsedAt'],
      order: [['createdAt', 'DESC']]
    });
    res.status(200).json({
      apiKeys
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api-keys/{id}:
 *   delete:
 *     summary: Revoke an API key
 *     description: >
 *       Permanently deletes the specified API key. The key must belong to the
 *       authenticated user — keys owned by other users will return 404 rather
 *       than 403 to avoid leaking information about key existence.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The primary key (database ID) of the API key to revoke.
 *         example: 3
 *     responses:
 *       200:
 *         description: API key revoked successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "API key deleted successfully"
 *       401:
 *         description: Unauthorized — missing or invalid authentication token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: API key not found or does not belong to the authenticated user.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "API key not found"
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/api-keys/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const apiKey = await ApiKey.findOne({
      where: {
        id,
        userId: req.user.id
      }
    });
    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }
    await apiKey.destroy();
    res.status(200).json({
      message: 'API key deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;