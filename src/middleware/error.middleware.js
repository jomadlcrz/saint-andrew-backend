/**
 * Centralized Error & 404 Handlers
 * Families and staff only ever see a plain message (templates/error-messages.js): raw errors
 * (Firebase, Semaphore, Brevo, parse errors, stack traces) stay in the server log.
 */

const { HTTP_STATUS, isClientError, isErrorStatus } = require('../utils/http-status');
const { ERROR_MESSAGES } = require('../templates/error-messages');

/** Text that comes from a library or a gateway rather than from our own code. */
const RAW_MESSAGE = /firebase|firestore|auth\/|semaphore|brevo|smtp|ECONN|ETIMEDOUT|ENOTFOUND|unexpected token|JSON|stack|TypeError|ReferenceError|Cannot read prop|undefined|null|CORS|Cross-Origin|\(status \d+\)|status code/i;

/** The plain message for a status (a generic one for any server error). */
function messageForStatus(status) {
  if (ERROR_MESSAGES.BY_STATUS[status]) return ERROR_MESSAGES.BY_STATUS[status];
  return isClientError(status) ? ERROR_MESSAGES.BY_STATUS[HTTP_STATUS.BAD_REQUEST] : ERROR_MESSAGES.SERVER;
}

/** The message to send back: our own words for a 4xx, a plain one for everything else. */
function getErrorMessage(err, status) {
  const message = typeof err?.message === 'string' ? err.message.trim() : '';
  // Errors we raise ourselves carry a 4xx status and words written for people; library errors
  // (body-parser marks its own with `type`) never pass through
  if (isClientError(status) && message && !RAW_MESSAGE.test(message) && !err?.type) return message;
  return messageForStatus(status);
}

function notFoundHandler(req, res, _next) {
  console.warn(`⚠️ [404] ${req.method} ${req.originalUrl}`);
  res.status(HTTP_STATUS.NOT_FOUND).json({ error: messageForStatus(HTTP_STATUS.NOT_FOUND) });
}

// Express knows an error handler by its four parameters, so _next stays even though it isn't called
function globalErrorHandler(err, req, res, _next) {
  const raw = Number(err?.status || err?.statusCode);
  const status = isErrorStatus(raw) ? raw : HTTP_STATUS.INTERNAL_SERVER_ERROR;

  console.error(`💥 [Error] ${req.method} ${req.originalUrl}:`, err?.stack || err?.message || err);

  res.status(status).json({
    error: getErrorMessage(err, status),
    ...(process.env.NODE_ENV === 'development' ? { stack: err?.stack } : {}),
  });
}

module.exports = {
  notFoundHandler,
  globalErrorHandler,
  getErrorMessage,
};
