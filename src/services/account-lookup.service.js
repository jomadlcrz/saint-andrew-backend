/**
 * Account Lookup Service
 * Answers the two phone-number questions the customer apps need before a user is signed in
 * (which email to sign in with, and whether a number is already registered) without letting
 * clients query the `users` collection directly.
 */

const { db, isFirebaseInitialized } = require('../config/firebase.config');
const { normalizePhilippinePhone } = require('../utils/phone.util');

/**
 * The forms a Philippine mobile number may be stored in on `users.phone`.
 * Both apps normalize +63 to 0 before saving, but older records may still carry +63.
 * @param {string} phone canonical 09XXXXXXXXX
 * @returns {string[]}
 */
function storedPhoneVariants(phone) {
  return [phone, `+63${phone.slice(1)}`];
}

/**
 * Factory so tests can inject a fake Firestore.
 * @param {{ db: any }} deps
 */
function createAccountLookup({ db: firestore }) {
  async function findUsersByPhone(rawPhone, max) {
    const phone = normalizePhilippinePhone(rawPhone);
    const snap = await firestore
      .collection('users')
      .where('phone', 'in', storedPhoneVariants(phone))
      .limit(max)
      .get();
    return snap.docs;
  }

  return {
    /**
     * @param {string} phone
     * @returns {Promise<string | null>} the account email, or null when no account uses this number
     */
    async resolveLoginEmail(phone) {
      const [userDoc] = await findUsersByPhone(phone, 1);
      const email = userDoc?.data()?.email;
      return typeof email === 'string' && email ? email : null;
    },

    /**
     * @param {string} phone
     * @param {string} [excludeUid] the caller's own uid, so editing a profile doesn't clash with itself
     * @returns {Promise<boolean>}
     */
    async isPhoneAvailable(phone, excludeUid) {
      const docs = await findUsersByPhone(phone, 2);
      return docs.every((d) => excludeUid && d.id === excludeUid);
    },
  };
}

function getAccountLookup() {
  if (!isFirebaseInitialized || !db) {
    const err = new Error('Account lookup is not available on the server.');
    err.status = 503;
    throw err;
  }
  return createAccountLookup({ db });
}

module.exports = {
  createAccountLookup,
  getAccountLookup,
};
