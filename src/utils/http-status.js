/**
 * HTTP status codes by name, so handlers read `HTTP_STATUS.TOO_MANY_REQUESTS` instead of `429`.
 */

const HTTP_STATUS = Object.freeze({
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
});

/** True for a status that is the caller's doing (4xx). */
function isClientError(status) {
  return status >= 400 && status < 500;
}

/** True for any real HTTP error status (4xx or 5xx). */
function isErrorStatus(status) {
  return Number.isInteger(status) && status >= 400 && status < 600;
}

module.exports = { HTTP_STATUS, isClientError, isErrorStatus };
