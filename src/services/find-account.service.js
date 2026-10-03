/**
 * Find Account Service
 * Forgot password starts with one "Email or mobile number" field (like Facebook's "Find your
 * account"): this says whether an account uses it, so the apps can offer "No account found"
 * instead of a code screen that would never get a code. Rate-limited per IP (findAccountLimiter).
 */

const { normalizePhilippinePhone, isValidPhilippinePhone } = require('../utils/phone.util');
const { isInternalEmail } = require('./phone-account.service');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVALID_CONTACT = 'Please enter a valid email address or mobile number.';

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/**
 * @param {{ auth: { getUserByEmail: Function }, lookup: { isPhoneAvailable: Function } }} deps
 * @returns {(contact: string) => Promise<{ found: boolean, kind: 'email' | 'phone' }>}
 */
function createFindAccount({ auth, lookup }) {
  return async function findAccount(rawContact) {
    const contact = String(rawContact || '').trim();
    if (!contact) throw badRequest('Please enter your email or mobile number.');

    if (contact.includes('@')) {
      const email = contact.toLowerCase();
      // A number account's internal sign-in email is never something a family types
      if (!EMAIL_REGEX.test(email) || isInternalEmail(email)) throw badRequest(INVALID_CONTACT);
      try {
        await auth.getUserByEmail(email);
        return { found: true, kind: 'email' };
      } catch (err) {
        if (err && err.code === 'auth/user-not-found') return { found: false, kind: 'email' };
        throw err;
      }
    }

    const phone = normalizePhilippinePhone(contact.replace(/[\s-]/g, ''));
    if (!isValidPhilippinePhone(phone)) throw badRequest(INVALID_CONTACT);
    return { found: !(await lookup.isPhoneAvailable(phone)), kind: 'phone' };
  };
}

module.exports = { createFindAccount };
