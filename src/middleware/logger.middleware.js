/**
 * Request Logging Middleware
 * Provides concise and formatted request/response logging.
 */

function requestLogger(req, res, next) {
  const start = Date.now();
  const method = req.method;
  const path = req.originalUrl || req.url;

  // Intercept response finish to log response status and duration
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const indicator = status < 400 ? '✅' : status < 500 ? '⚠️' : '❌';

    console.log(`${indicator} [HTTP] ${method} ${path} -> ${status} (${duration}ms)`);
  });

  next();
}

module.exports = {
  requestLogger,
};
