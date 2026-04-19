const ApiHealth = require('../models/ApiHealth');

const trackApiHealth = (req, res, next) => {
  if (req.originalUrl.startsWith('/api/health')) {
    return next();
  }

  const start = Date.now();
  let errorMessage = null;
  let responseLogged = false;

  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);


  const logRequest = () => {
    if (responseLogged) return;
    responseLogged = true;

    const healthData = {
      endpoint: req.originalUrl,
      method: req.method,
      statusCode: res.statusCode,
      latency: Date.now() - start,
      timestamp: new Date(),
      userAgent: req.get('user-agent') || null,
      ipAddress: req.ip || req.socket?.remoteAddress || null,
      errorMessage,
      isSuccess: res.statusCode < 400,
      isServerError: res.statusCode >= 500
    };

    ApiHealth.create(healthData).catch((err) => {

      console.error(`[API Health] DB write failed (${err.name}): ${err.message}`);
    });
  };


  res.json = function (data) {
    try {
      if (res.statusCode >= 400 && data && data.error) {
        errorMessage = typeof data.error === 'string'
            ? data.error
            : JSON.stringify(data.error);
      }
      setImmediate(logRequest);
    } catch (err) {
      console.error(`[API Health] res.json override error: ${err.message}`);

    }
    return originalJson(data);
  };

  res.send = function (data) {
    try {
      setImmediate(logRequest);
    } catch (err) {
      console.error(`[API Health] res.send override error: ${err.message}`);
    }
    return originalSend(data);
  };


  res.on('finish', () => setImmediate(logRequest));

  next();
};

module.exports = trackApiHealth;