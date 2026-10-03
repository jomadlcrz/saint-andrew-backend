/**
 * Phone-number Accounts Service
 * Families without an email sign up, sign in and reset their password with their mobile number,
 * verified by a 6-digit SMS code (Semaphore). Firebase Auth still needs an email for password
 * sign-in, so each phone account gets an internal one (`loginEmail`, never shown and never mailed);
 * its `email` stays empty. /resolve-login-phone returns `loginEmail`, so the apps' usual sign-in works.
 */

const crypto = require('crypto');
const { normalizePhilippinePhone, isValidPhilippinePhone } = require('../utils/phone.util');
const { passwordProblem } = require('../utils/password-policy');
const { HTTP_STATUS } = require('../utils/http-status');

/** Reserved domain (RFC 2606): mail to it can never be delivered. */
const INTERNAL_EMAIL_DOMAIN = 'phone.standrew.invalid';
// Each SMS costs Semaphore credits, so codes are limited (on top of the per-IP limiters):
/** One code per number per minute… */
const RESEND_COOLDOWN_MS = 60 * 1000;
/** …at most this many per number per day… */
const MAX_CODES_PER_NUMBER_PER_DAY = 5;
/** …and at most this many for everyone per day (a stop against many-number abuse). */
const DEFAULT_DAILY_SMS_LIMIT = 200;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const PURPOSES = ['signup', 'reset'];
/** Clients sign contracts, and 18 is the legal age to do so (same rule as the apps' profile.utils). */
const MIN_CLIENT_AGE = 18;
const MAX_CLIENT_AGE = 120;

function phoneError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function readPhone(raw) {
  const phone = normalizePhilippinePhone(raw);
  if (!isValidPhilippinePhone(phone)) {
    throw phoneError('Please enter a valid Philippine mobile number (e.g. 09XXXXXXXXX).');
  }
  return phone;
}

/** True for the internal sign-in email of a phone account (apps never show it). */
function isInternalEmail(email) {
  return String(email || '').toLowerCase().endsWith(`@${INTERNAL_EMAIL_DOMAIN}`);
}

/** What's wrong with a required "YYYY-MM-DD" date of birth on `today` (Manila day), or null. */
function birthdayProblem(birthday, today) {
  const value = String(birthday || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Please select your date of birth.';
  const year = Number(today.slice(0, 4));
  const shifted = (years) => `${String(year - years).padStart(4, '0')}${today.slice(4)}`;
  if (value > today) return "Your date of birth can't be in the future.";
  if (value > shifted(MIN_CLIENT_AGE)) return `You must be at least ${MIN_CLIENT_AGE} years old.`;
  if (value < shifted(MAX_CLIENT_AGE)) return 'Please check the year of your date of birth.';
  return null;
}

const ADDRESS_PART_KEYS = ['street', 'provinceCode', 'provinceName', 'cityCode', 'cityName', 'barangayCode', 'barangayName'];

/** The address as picked from the PSGC list in the apps (short strings only), or null. */
function readAddressParts(value) {
  if (!value || typeof value !== 'object') return null;
  const parts = {};
  for (const key of ADDRESS_PART_KEYS) parts[key] = String(value[key] || '').trim().slice(0, 120);
  return parts.provinceCode && parts.cityCode && parts.barangayCode ? parts : null;
}

function smsMessage(code) {
  return `Your St. Andrew Funeral Home code is ${code}. It expires in 15 minutes. Never share this code with anyone.`;
}

/**
 * Factory so tests can inject fakes.
 * @param {{ db: any, auth: any, otp: any, resetTokens: any, sms: { sendSms: Function }, lookup: any, now?: () => number }} deps
 */
function createPhoneAccounts({ db, auth, otp, resetTokens, sms, lookup, now = () => Date.now(), dailySmsLimit = DEFAULT_DAILY_SMS_LIMIT }) {
  const otpKey = (purpose, phone) => `sms-${purpose}:${phone}`;

  /** Philippine calendar day, so the daily limits reset at midnight in Manila. */
  const today = () => new Date(now() + MANILA_OFFSET_MS).toISOString().slice(0, 10);

  /** Counts this code against the limits, or refuses it (429 for the number, 503 for everyone). */
  async function allowCode(phone) {
    const day = today();
    const numberRef = db.collection('sms_code_sends').doc(phone);
    const numberSnap = await numberRef.get();
    const sent = numberSnap.exists ? numberSnap.data() : {};
    const wait = RESEND_COOLDOWN_MS - (now() - (Number(sent.sentAtMs) || 0));
    if (wait > 0) {
      throw phoneError(`Please wait ${Math.ceil(wait / 1000)} seconds before asking for another code.`, 429);
    }
    const countToday = sent.day === day ? Number(sent.countToday) || 0 : 0;
    if (countToday >= MAX_CODES_PER_NUMBER_PER_DAY) {
      throw phoneError('Too many codes were sent to this number today. Please try again tomorrow or call our office.', 429);
    }

    const dailyRef = db.collection('sms_code_daily').doc(day);
    const dailySnap = await dailyRef.get();
    const sentToday = dailySnap.exists ? Number(dailySnap.data().count) || 0 : 0;
    if (sentToday >= dailySmsLimit) {
      console.warn(`⚠️ [PhoneAccounts] Daily SMS code limit (${dailySmsLimit}) reached for ${day}.`);
      throw phoneError("We can't send text codes right now. Please sign up with your email, or try again tomorrow.", 503);
    }

    await numberRef.set({ sentAtMs: now(), day, countToday: countToday + 1 });
    await dailyRef.set({ count: sentToday + 1 });
  }

  return {
    /**
     * Texts a 6-digit code. Sign-up: the number must not be registered yet. Reset: nothing is sent
     * when no account uses the number, and the answer looks the same (no account probing).
     * @returns {Promise<{ sent: boolean }>}
     */
    async requestCode({ phone: rawPhone, purpose }) {
      if (!PURPOSES.includes(purpose)) throw phoneError('Unknown code request.');
      const phone = readPhone(rawPhone);
      const available = await lookup.isPhoneAvailable(phone);
      if (purpose === 'signup' && !available) {
        throw phoneError('An account with this mobile number already exists. Please sign in instead.', 409);
      }
      if (purpose === 'reset' && available) return { sent: false };

      await allowCode(phone);
      const code = otp.generateOtp();
      await otp.storeOtp(otpKey(purpose, phone), code);
      try {
        await sms.sendSms({ number: phone, message: smsMessage(code) });
      } catch (err) {
        // The gateway's own error (and its status) stays in the log; the family gets a plain message
        console.error(`❌ [PhoneAccounts] Could not text the ${purpose} code:`, err.message);
        throw phoneError("We couldn't send the text message right now. Please try again in a few minutes.", HTTP_STATUS.SERVICE_UNAVAILABLE);
      }
      return { sent: true };
    },

    /**
     * Creates the account once the sign-up code checks out: a Firebase user with an internal email
     * (already verified by the SMS) and an active `users/{uid}` record with no email.
     * @returns {Promise<{ uid: string }>}
     */
    async register({ phone: rawPhone, otp: code, password, firstName, middleName, lastName, suffix, address, addressParts, gender, birthday }) {
      const phone = readPhone(rawPhone);
      const first = String(firstName || '').trim();
      const last = String(lastName || '').trim();
      if (!first || !last) throw phoneError('Please enter your first and last name.');
      if (!String(address || '').trim()) throw phoneError('Please enter your home address.');
      const ageProblem = birthdayProblem(birthday, today());
      if (ageProblem) throw phoneError(ageProblem);
      if (!String(gender || '').trim()) throw phoneError('Please select your gender.');
      const fullName = [first, String(middleName || '').trim(), last, String(suffix || '').trim()].filter(Boolean).join(' ');
      const problem = passwordProblem(password, { name: fullName });
      if (problem) throw phoneError(problem);
      if (!/^\d{6}$/.test(String(code || '').trim())) throw phoneError('Please enter the 6-digit code we sent.');

      const check = await otp.verifyOtp(otpKey('signup', phone), String(code));
      if (!check.valid) throw phoneError(check.reason || 'Invalid verification code.');
      // Someone may have taken the number while this family typed the code
      if (!(await lookup.isPhoneAvailable(phone))) {
        throw phoneError('An account with this mobile number already exists. Please sign in instead.', 409);
      }

      const loginEmail = `p.${crypto.randomBytes(9).toString('hex')}@${INTERNAL_EMAIL_DOMAIN}`;
      const user = await auth.createUser({ email: loginEmail, emailVerified: true, password, displayName: fullName });
      try {
        await db.collection('users').doc(user.uid).set({
          uid: user.uid,
          firstName: first,
          middleName: String(middleName || '').trim(),
          lastName: last,
          suffix: String(suffix || '').trim(),
          fullName,
          email: '',
          loginEmail,
          phone,
          phoneVerified: true,
          signUpMethod: 'phone',
          address: String(address).trim(),
          ...(readAddressParts(addressParts) ? { addressParts: readAddressParts(addressParts) } : {}),
          gender: String(gender || '').trim(),
          birthday: String(birthday),
          photoURL: '',
          role: 'user',
          status: 'active',
          emailVerified: false,
          createdAt: new Date(now()),
          updatedAt: new Date(now()),
        });
      } catch (err) {
        // No half-made accounts: without its record the family couldn't use the app
        await auth.deleteUser(user.uid).catch(() => {});
        throw err;
      }
      await otp.clearOtp(otpKey('signup', phone));
      return { uid: user.uid };
    },

    /** Checks a reset code and returns a single-use token for the new password. */
    async verifyResetCode({ phone: rawPhone, otp: code }) {
      const phone = readPhone(rawPhone);
      if (!/^\d{6}$/.test(String(code || '').trim())) throw phoneError('Please enter the 6-digit code we sent.');
      const check = await otp.verifyOtp(otpKey('reset', phone), String(code));
      if (!check.valid) throw phoneError(check.reason || 'Invalid verification code.');
      return { resetToken: await resetTokens.issueResetToken(otpKey('reset', phone)) };
    },

    /** Sets the new password with the token from verifyResetCode; other devices are signed out. */
    async resetPassword({ phone: rawPhone, token, newPassword }) {
      const phone = readPhone(rawPhone);
      const loginEmail = await lookup.resolveLoginEmail(phone);
      if (!loginEmail) throw phoneError('No account found with this mobile number.', 404);
      const user = await auth.getUserByEmail(loginEmail);
      const problem = passwordProblem(newPassword, { email: isInternalEmail(loginEmail) ? '' : loginEmail, name: user.displayName });
      if (problem) throw phoneError(problem);

      const result = await resetTokens.verifyAndConsumeResetToken(otpKey('reset', phone), String(token || ''));
      if (!result.valid) throw phoneError(result.reason || 'Your reset session expired. Please ask for a new code.');
      await auth.updateUser(user.uid, { password: newPassword });
      await auth.revokeRefreshTokens(user.uid);
      await otp.clearOtp(otpKey('reset', phone));
    },
  };
}

module.exports = {
  createPhoneAccounts,
  isInternalEmail,
  birthdayProblem,
  INTERNAL_EMAIL_DOMAIN,
  RESEND_COOLDOWN_MS,
  MAX_CODES_PER_NUMBER_PER_DAY,
  DEFAULT_DAILY_SMS_LIMIT,
};
