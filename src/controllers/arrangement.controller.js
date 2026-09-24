/**
 * Arrangement Controller
 * Reference-code tracking for guests and claiming walk-in arrangements into an account.
 */

const { sanitizeString } = require('../utils/sanitize.util');
const { normalizePhilippinePhone, isValidPhilippinePhone } = require('../utils/phone.util');
const { getArrangementService } = require('../services/arrangement.service');

/** Validates the body up front; returns null after sending a 400. */
function readInput(req, res) {
  const code = sanitizeString(req.body?.referenceCode, 64);
  const phone = sanitizeString(req.body?.phone, 20);
  if (!code || code.includes('/')) {
    res.status(400).json({ success: false, error: 'A valid reference code is required.' });
    return null;
  }
  if (!isValidPhilippinePhone(normalizePhilippinePhone(phone))) {
    res.status(400).json({
      success: false,
      error: 'A valid 11-digit Philippine mobile number (09XXXXXXXXX) is required.',
    });
    return null;
  }
  return { code, phone };
}

function sendServiceError(err, res, next) {
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ success: false, error: err.message });
  }
  return next(err);
}

/**
 * POST /track-arrangement
 * Body: { referenceCode, phone }
 */
async function trackArrangement(req, res, next) {
  try {
    const input = readInput(req, res);
    if (!input) return undefined;
    const arrangement = await getArrangementService().trackArrangement(input);
    return res.status(200).json({ success: true, arrangement });
  } catch (err) {
    return sendServiceError(err, res, next);
  }
}

/**
 * POST /claim-arrangement (signed-in family)
 * Body: { referenceCode, phone }
 */
async function claimArrangement(req, res, next) {
  try {
    const input = readInput(req, res);
    if (!input) return undefined;
    const arrangement = await getArrangementService().claimArrangement({
      ...input,
      uid: req.user.uid,
    });
    return res.status(200).json({ success: true, arrangement });
  } catch (err) {
    return sendServiceError(err, res, next);
  }
}

module.exports = {
  trackArrangement,
  claimArrangement,
};
