/**
 * Phone-number Accounts Controller
 * Sign-up and password reset for families who use their mobile number instead of an email,
 * verified by an SMS code. Logic lives in phone-account.service.js.
 */

const { admin, db, isFirebaseInitialized } = require('../config/firebase.config');
const otpService = require('../services/otp.service');
const resetTokenService = require('../services/reset-token.service');
const semaphoreService = require('../services/semaphore.service');
const { createAccountLookup } = require('../services/account-lookup.service');
const { createPhoneAccounts } = require('../services/phone-account.service');
const config = require('../config/env.config');

function getPhoneAccounts() {
  if (!isFirebaseInitialized || !admin || !db) {
    const err = new Error('Accounts are not available on the server right now.');
    err.status = 503;
    throw err;
  }
  return createPhoneAccounts({
    db,
    auth: admin.auth(),
    otp: otpService,
    resetTokens: resetTokenService,
    sms: semaphoreService,
    lookup: createAccountLookup({ db }),
    dailySmsLimit: config.smsCodes.dailyLimit,
  });
}

/** Known problems (bad input, taken number, wait) go back as their message; the rest to next(). */
function respond(handler) {
  return async (req, res, next) => {
    try {
      return await handler(req, res);
    } catch (err) {
      // 503: the daily text-code limit for everyone was reached; the family should see why
      if (err.status && (err.status < 500 || err.status === 503)) {
        return res.status(err.status).json({ success: false, error: err.message });
      }
      return next(err);
    }
  };
}

/**
 * POST /send-otp-sms
 * Body: { phone, purpose: 'signup' | 'reset' }
 * A reset for an unregistered number answers the same way, without sending anything.
 */
const sendOtpSms = respond(async (req, res) => {
  await getPhoneAccounts().requestCode({ phone: req.body?.phone, purpose: req.body?.purpose });
  return res.status(200).json({ success: true, message: 'If the number can receive it, a code is on its way.' });
});

/**
 * POST /register-phone
 * Body: { phone, otp, password, firstName, middleName?, lastName, suffix?, address, addressParts?, gender, birthday }
 * The family then signs in with the number and password as usual.
 */
const registerPhone = respond(async (req, res) => {
  const b = req.body || {};
  await getPhoneAccounts().register({
    phone: b.phone,
    otp: b.otp,
    password: String(b.password || ''),
    firstName: b.firstName,
    middleName: b.middleName,
    lastName: b.lastName,
    suffix: b.suffix,
    address: b.address,
    addressParts: b.addressParts,
    gender: b.gender,
    birthday: b.birthday,
  });
  return res.status(201).json({ success: true, message: 'Account created.' });
});

/**
 * POST /verify-otp-sms
 * Body: { phone, otp }  →  { resetToken }
 */
const verifyOtpSms = respond(async (req, res) => {
  const { resetToken } = await getPhoneAccounts().verifyResetCode({ phone: req.body?.phone, otp: req.body?.otp });
  return res.status(200).json({ success: true, resetToken });
});

/**
 * POST /reset-password-phone
 * Body: { phone, token, newPassword, confirmPassword }
 */
const resetPasswordPhone = respond(async (req, res) => {
  const newPassword = String(req.body?.newPassword || '');
  if (newPassword !== String(req.body?.confirmPassword || '')) {
    return res.status(400).json({ success: false, error: 'Passwords do not match.' });
  }
  await getPhoneAccounts().resetPassword({ phone: req.body?.phone, token: req.body?.token, newPassword });
  return res.status(200).json({ success: true, message: 'Password reset successfully.' });
});

module.exports = { sendOtpSms, registerPhone, verifyOtpSms, resetPasswordPhone };
