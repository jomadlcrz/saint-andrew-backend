/**
 * Notification Controller
 * Lets admin-web notify a family (in-app + push) after an admin action succeeds.
 */

const { sanitizeString } = require('../utils/sanitize.util');
const { NOTIFICATION_TYPES, notifyUser } = require('../services/notification.service');

const MAX_TITLE = 80;
const MAX_BODY = 240;
const MAX_ROUTE = 120;
/** Largest PDF a notice may carry (decoded bytes). */
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const PDF_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,78}\.pdf$/i;

/**
 * The PDF to attach, checked: a .pdf name, base64 content that decodes to a real PDF ("%PDF-")
 * within the size limit. Returns { attachment } or { error }.
 */
function readAttachment(raw) {
  if (raw === undefined || raw === null) return { attachment: null };
  const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
  const content = typeof raw?.content === 'string' ? raw.content.trim() : '';
  if (!PDF_NAME.test(name)) return { error: 'attachment.name must be a .pdf file name.' };
  if (!content || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) return { error: 'attachment.content must be base64.' };
  // Checked on the encoded length first, so a huge upload is refused before decoding
  if (Math.floor((content.length * 3) / 4) > MAX_ATTACHMENT_BYTES + 3) return { error: 'attachment is too large (2 MB at most).' };
  const bytes = Buffer.from(content, 'base64');
  if (bytes.length > MAX_ATTACHMENT_BYTES) return { error: 'attachment is too large (2 MB at most).' };
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return { error: 'attachment must be a PDF.' };
  return { attachment: { name, content } };
}

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
 * Body: { userId, type, title, body, route?, refId?, email?, attachment? }
 *   email: true also emails the family at their account's own address (if it is a real one).
 *   attachment: { name: "contract.pdf", content: base64 } to attach to that email.
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
    const email = req.body?.email === true;
    const { attachment, error: attachmentError } = readAttachment(req.body?.attachment);
    if (attachmentError) {
      return res.status(400).json({ success: false, error: attachmentError });
    }
    if (attachment && !email) {
      return res.status(400).json({ success: false, error: 'An attachment needs email: true.' });
    }

    const result = await notifyUser({ userId, type, title, body, route, refId, email, attachment });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  notifyUserHandler,
  readAttachment,
};
