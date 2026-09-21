/**
 * Password Reset Token Service
 * Issues and validates short-lived, single-use tokens that authorize a
 * password change after OTP verification. Mirrors the dual-layer
 * (Firestore + in-memory fallback) storage pattern used by otp.service.js.
 */

const crypto = require('crypto');
const { db, isFirebaseInitialized } = require('../config/firebase.config');

const RESET_TOKEN_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const memoryTokenStore = new Map();

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Issues a new single-use reset token for the given email, invalidating any
 * previously issued token. Only the SHA-256 hash of the token is persisted;
 * the raw token is returned once and never stored.
 *
 * @param {string} email
 * @returns {Promise<string>} raw reset token
 */
async function issueResetToken(email) {
  const normalizedEmail = email.toLowerCase().trim();
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const now = new Date();

  memoryTokenStore.set(normalizedEmail, {
    tokenHash,
    createdAt: now.getTime(),
    used: false,
  });

  if (isFirebaseInitialized && db) {
    await db.collection('password_reset_tokens').doc(normalizedEmail).set({
      tokenHash,
      createdAt: now,
      used: false,
    });
  }

  return token;
}

/**
 * Validates a candidate reset token and, if valid, atomically marks it as
 * used so it cannot be replayed.
 *
 * @param {string} email
 * @param {string} candidateToken
 * @returns {Promise<{ valid: boolean, reason?: string }>}
 */
async function verifyAndConsumeResetToken(email, candidateToken) {
  const normalizedEmail = email.toLowerCase().trim();
  const candidateHash = hashToken(String(candidateToken || '').trim());

  let tokenData = null;

  if (isFirebaseInitialized && db) {
    const docRef = db.collection('password_reset_tokens').doc(normalizedEmail);
    const doc = await docRef.get();

    if (doc.exists) {
      const data = doc.data();
      const createdAtMs = data.createdAt?.toDate
        ? data.createdAt.toDate().getTime()
        : new Date(data.createdAt).getTime();

      tokenData = {
        tokenHash: String(data.tokenHash || ''),
        createdAt: createdAtMs,
        used: Boolean(data.used),
        docRef,
      };
    }
  }

  if (!tokenData && memoryTokenStore.has(normalizedEmail)) {
    tokenData = memoryTokenStore.get(normalizedEmail);
  }

  if (!tokenData) {
    return { valid: false, reason: 'Reset session expired or invalid. Please verify your code again.' };
  }

  if (tokenData.used) {
    return { valid: false, reason: 'This reset session has already been used. Please start over.' };
  }

  const age = Date.now() - tokenData.createdAt;
  if (age > RESET_TOKEN_EXPIRY_MS) {
    if (tokenData.docRef) {
      await tokenData.docRef.delete().catch(() => {});
    }
    memoryTokenStore.delete(normalizedEmail);
    return { valid: false, reason: 'Reset session has expired. Please verify your code again.' };
  }

  const storedHashBuf = Buffer.from(tokenData.tokenHash, 'hex');
  const candidateHashBuf = Buffer.from(candidateHash, 'hex');
  const matches =
    storedHashBuf.length === candidateHashBuf.length &&
    crypto.timingSafeEqual(storedHashBuf, candidateHashBuf);

  if (!matches) {
    return { valid: false, reason: 'Invalid or expired reset session. Please verify your code again.' };
  }

  // Mark as used immediately to prevent reuse, even if the caller's
  // subsequent operation (e.g. the password update) later fails.
  if (tokenData.docRef) {
    await tokenData.docRef.update({ used: true, usedAt: new Date() }).catch(() => {});
  }
  if (memoryTokenStore.has(normalizedEmail)) {
    memoryTokenStore.get(normalizedEmail).used = true;
  }

  return { valid: true };
}

/**
 * Removes any reset token record for the given email (e.g. after a
 * successful password reset).
 * @param {string} email
 * @returns {Promise<void>}
 */
async function clearResetToken(email) {
  const normalizedEmail = email.toLowerCase().trim();
  if (isFirebaseInitialized && db) {
    await db.collection('password_reset_tokens').doc(normalizedEmail).delete().catch(() => {});
  }
  memoryTokenStore.delete(normalizedEmail);
}

module.exports = {
  issueResetToken,
  verifyAndConsumeResetToken,
  clearResetToken,
  RESET_TOKEN_EXPIRY_MS,
};
