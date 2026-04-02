const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User, ApiKey } = require('../models');
const { JWT_SECRET, authenticate } = require('../middleware/authenticate');
const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      role: role || 'user'
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