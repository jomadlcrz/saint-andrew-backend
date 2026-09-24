/**
 * Notification Controller
 * Lets admin-web notify a family (in-app + push) after an admin action succeeds.
 */

const { sanitizeString } = require('../utils/sanitize.util');
const { NOTIFICATION_TYPES, notifyUser } = require('../services/notification.service');

const MAX_TITLE = 80;
const MAX_BODY = 240;
const MAX_ROUTE = 120;

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

    // Firestore document ids cannot contain "/", and walk-in placeholders are never real accounts
    if (!userId || userId.includes('/')) {
      return res.status(400).json({ error: 'A valid userId is required.' });
    }
    if (!NOTIFICATION_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${NOTIFICATION_TYPES.join(', ')}.` });
    }
    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required.' });
    }
    if (refId.includes('/')) {
      return res.status(400).json({ error: 'refId must be a document id.' });
    }
    // Only in-app paths, so a notification can never open an external link
    if (route && !route.startsWith('/')) {
      return res.status(400).json({ error: 'route must be an in-app path starting with "/".' });
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
