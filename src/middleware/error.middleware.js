/**
 * Centralized Error & 404 Handlers
 */

function notFoundHandler(req, res, next) {
  res.status(404).json({
    error: `Endpoint '${req.method} ${req.originalUrl}' not found on this server.`,
  });
}

function globalErrorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error occurred.';

  console.error(`💥 [Error] ${req.method} ${req.originalUrl}:`, err.stack || err.message);

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}

module.exports = {
  notFoundHandler,
  globalErrorHandler,
};
