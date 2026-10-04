/**
 * Chapel Controller
 * GET /chapel-availability: the days St. Andrew Chapel is taken by accepted wakes, from today on,
 * so the family's form can offer it only when it's free. Days only: never who or which case.
 */

const { db, isFirebaseInitialized } = require('../config/firebase.config');
const { createChapelService } = require('../services/chapel.service');

let service = null;

/**
 * GET /chapel-availability
 * Response: { success: true, today: "YYYY-MM-DD", stays: [{ from: "YYYY-MM-DD", to: "YYYY-MM-DD" | null }] }
 *   to: null while that wake's burial is to be announced.
 */
async function getChapelAvailability(req, res, next) {
  try {
    if (!isFirebaseInitialized || !db) {
      return res.status(503).json({ success: false, error: 'Chapel schedule is not available right now. Please try again later.' });
    }
    service ||= createChapelService({ db });
    const { today, stays } = await service.availability();
    res.set('Cache-Control', 'public, max-age=60');
    return res.status(200).json({ success: true, today, stays });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getChapelAvailability };
