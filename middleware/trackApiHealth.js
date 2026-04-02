const ApiHealth = require('../models/ApiHealth');

const trackApiHealth = async (req, res, next) => {
  // Skip health endpoints to avoid infinite loops
  if (req.originalUrl.startsWith('/api/health')) {
    return next();
  }

  const start = Date.now();

  // Store original methods
  const originalSend = res.send;
  const originalJson = res.json;

  let errorMessage = null;
  let responseLogged = false;

  // Helper function to log the request
  const logRequest = async () => {
    if (responseLogged) return;
    responseLogged = true;

    const latency = Date.now() - start;
    const statusCode = res.statusCode;

    const healthData = {
      endpoint: req.originalUrl,
      method: req.method,
      statusCode: statusCode,
      latency: latency,
      timestamp: new Date(),
      userAgent: req.get('user-agent') || null,
      ipAddress: req.ip || req.connection.remoteAddress || null,
      errorMessage: errorMessage,
      isSuccess: statusCode < 400,
      isServerError: statusCode >= 500
    };

    try {
      const result = await ApiHealth.create(healthData);
      console.log(`[API Health] ✓ Saved to DB with ID: ${result.id}`);
    } catch (error) {
      console.error('[API Health] ✗ DATABASE ERROR:');
      console.error('  Message:', error.message);
      console.error('  Name:', error.name);
      if (error.sql) console.error('  SQL:', error.sql);
      if (error.parent) console.error('  Parent:', error.parent.message);
      console.error('  Data attempted:', healthData);
    }
  };

  // Override res.json
  res.json = function(data) {
    if (res.statusCode >= 400 && data && data.error) {
      errorMessage = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
    }

    setImmediate(logRequest);
    return originalJson.call(this, data);
  };

  // Override res.send
  res.send = function(data) {
    setImmediate(logRequest);
    return originalSend.call(this, data);
  };

  // Fallback: use finish event as backup
  res.on('finish', () => {
    setImmediate(logRequest);
  });

  next();
};

module.exports = trackApiHealth;