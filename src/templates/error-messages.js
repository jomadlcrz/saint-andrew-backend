/**
 * What families and staff read when a request fails. Raw errors (Firebase, Semaphore, Brevo,
 * parse errors, stack traces) stay in the server log; these plain messages go back instead.
 */

const { HTTP_STATUS } = require('../utils/http-status');

const ERROR_MESSAGES = Object.freeze({
  SERVER: 'Something went wrong on our side. Please try again in a moment.',
  BY_STATUS: Object.freeze({
    [HTTP_STATUS.BAD_REQUEST]: "We couldn't read that request. Please check what you entered and try again.",
    [HTTP_STATUS.UNAUTHORIZED]: 'Please sign in again to continue.',
    [HTTP_STATUS.FORBIDDEN]: "You don't have access to do that.",
    [HTTP_STATUS.NOT_FOUND]: "We couldn't find what you were looking for.",
    [HTTP_STATUS.REQUEST_TIMEOUT]: 'That took too long. Please try again.',
    [HTTP_STATUS.CONFLICT]: 'That was already changed. Please refresh and try again.',
    [HTTP_STATUS.PAYLOAD_TOO_LARGE]: 'That file or message is too large. Please try a smaller one.',
    [HTTP_STATUS.TOO_MANY_REQUESTS]: 'Too many tries. Please wait a few minutes and try again.',
    [HTTP_STATUS.SERVICE_UNAVAILABLE]: 'This service is busy right now. Please try again in a few minutes.',
  }),
});

module.exports = { ERROR_MESSAGES };
