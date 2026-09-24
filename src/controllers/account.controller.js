/**
 * Account Lookup Controller
 * Phone-number lookups the customer apps need for phone login and duplicate checks.
 */

const { normalizePhilippinePhone, isValidPhilippinePhone } = require('../utils/phone.util');
const { getAccountLookup } = require('../services/account-lookup.service');

function readPhone(req, res) {
  const phone = normalizePhilippinePhone(req.body?.phone);
  if (!isValidPhilippinePhone(phone)) {
    res.status(400).json({
      success: false,
      error: 'A valid 11-digit Philippine mobile number (09XXXXXXXXX) is required.',
    });
    return null;
  }
  return phone;
}

/**
 * POST /resolve-login-phone
 * Body: { phone }
 * Returns the email to sign in with for a registered mobile number.
 */
async function resolveLoginPhone(req, res, next) {
  try {
    const phone = readPhone(req, res);
    if (!phone) return undefined;

    const email = await getAccountLookup().resolveLoginEmail(phone);
    if (!email) {
      return res.status(404).json({ success: false, error: 'No account found with this phone number.' });
    }
    return res.status(200).json({ success: true, email });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /check-phone-available
 * Body: { phone }. Optional Bearer token: the caller's own account doesn't count as a clash.
 */
async function checkPhoneAvailable(req, res, next) {
  try {
    const phone = readPhone(req, res);
    if (!phone) return undefined;

    const available = await getAccountLookup().isPhoneAvailable(phone, req.user?.uid);
    return res.status(200).json({ success: true, available });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  resolveLoginPhone,
  checkPhoneAvailable,
};
