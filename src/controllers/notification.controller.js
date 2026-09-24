/**
 * Notification Controller
 * Lets admin-web notify a family (in-app + push) after an admin action succeeds.
 */

const { sanitizeString } = require('../utils/sanitize.util');
const { NOTIFICATION_TYPES, notifyUser } = require('../services/notification.service');

const MAX_TITLE = 80;
const MAX_BODY = 240;
const MAX_ROUTE = 120;

// A single leading "/" (never "//" or "/\", which browsers and deep-link handlers treat as another host)
// followed only by path/query characters, so a notification can never open an external link
const IN_APP_ROUTE = /^\/(?![\/\\])[A-Za-z0-9\-._~()\/\[\]?=&%+:@!$'*,;]*$/;

/**
 * True for strings usable as a single Firestore document id.
 * Rejects "/", ".", ".." and the reserved "__name__" form, which Firestore refuses with a 500.
 */
function isDocumentId(value) {
  return Boolean(value) && !value.includes('/') && value !== '.' && value !== '..' && !/^__.*__$/.test(value);
}

/**
 * POST /notify-user
 * Body: { userId, type, title, body, route?, refId? }
 */
async function notifyUserHandler(req, res, next) {
  try {
    const userId = sanitizeString(req.body?.userId, 128);
    const type = sanitizeString(req.body?.type, 40);
    const title = sanitizeString(req.body?.title, MAX_TITLE);
    const body = sanitizeString(req.body?.body, MAX_BODY);
    const route = sanitizeString(req.body?.route, MAX_ROUTE);
    const refId = sanitizeString(req.body?.refId, 128);

    if (!isDocumentId(userId)) {
      return res.status(400).json({ success: false, error: 'A valid userId is required.' });
    }
    if (!NOTIFICATION_TYPES.includes(type)) {
      return res.status(400).json({ success: false, error: `type must be one of: ${NOTIFICATION_TYPES.join(', ')}.` });
    }
    if (!title || !body) {
      return res.status(400).json({ success: false, error: 'title and body are required.' });
    }
    if (refId && !isDocumentId(refId)) {
      return res.status(400).json({ success: false, error: 'refId must be a document id.' });
    }
    if (route && !IN_APP_ROUTE.test(route)) {
      return res.status(400).json({ success: false, error: 'route must be an in-app path starting with "/".' });
    }

    const result = await notifyUser({ userId, type, title, body, route, refId });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  notifyUserHandler,
};
