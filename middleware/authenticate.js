const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { User, ApiKey } = require('../models');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');

    if (token.startsWith('sk_')) {
      const apiKeys = await ApiKey.findAll({
        include: [{
          model: User,
          as: 'user'
        }]
      });

      let matchedApiKey = null;
      for (const apiKey of apiKeys) {
        const isValid = await bcrypt.compare(token, apiKey.key);
        if (isValid) {
          matchedApiKey = apiKey;
          break;
        }
      }

      if (!matchedApiKey) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      // Update last used timestamp
      await matchedApiKey.update({ lastUsedAt: new Date() });

      // Attach user to request
      req.user = matchedApiKey.user;
      req.authType = 'apikey';
      return next();
    } else {
      // Handle JWT token
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findByPk(decoded.id);

      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      req.user = user;
      req.authType = 'jwt';
      return next();
    }
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(500).json({ error: error.message });
  }
};

module.exports = { authenticate, JWT_SECRET };