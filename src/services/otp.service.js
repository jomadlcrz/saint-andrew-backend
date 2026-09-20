/**
 * One-Time Password (OTP) Service
 * Manages OTP lifecycle with dual-layer storage (Firestore + In-Memory fallback).
 */

const crypto = require('crypto');
const { db, isFirebaseInitialized } = require('../config/firebase.config');

const OTP_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const MAX_VERIFY_ATTEMPTS = 5;
const memoryOtpStore = new Map();

/**
 * Constant-time string comparison to avoid leaking match-length information
 * through response timing. Both inputs are fixed 6-digit codes.
 */
function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates a cryptographically random 6-digit OTP string.
 * @returns {string}
 */
function generateOtp() {
  const num = crypto.randomInt(100000, 1000000);
  return String(num);
}

/**
 * Stores generated OTP for the specified email.
 * Writes to Firestore collection `password_reset` and updates in-memory cache.
 *
 * @param {string} email
 * @param {string} otp
 * @returns {Promise<void>}
 */
async function storeOtp(email, otp) {
  const normalizedEmail = email.toLowerCase().trim();
  const now = new Date();

  // Save to in-memory store
  memoryOtpStore.set(normalizedEmail, {
    otp,
    createdAt: now.getTime(),
    verified: false,
    attempts: 0,
  });

  // Save to Firestore if available
  if (isFirebaseInitialized && db) {
    await db.collection('password_reset').doc(normalizedEmail).set({
      otp,
      createdAt: now,
      verified: false,
      attempts: 0,
    });
  }
}

/**
 * Validates a submitted OTP against Firestore (or memory store fallback).
 *
 * @param {string} email
 * @param {string} candidateOtp
 * @returns {Promise<{ valid: boolean, reason?: string }>}
 */
async function verifyOtp(email, candidateOtp) {
  const normalizedEmail = email.toLowerCase().trim();
  const trimmedOtp = candidateOtp.trim();

  let otpData = null;

  // 1. Try reading from Firestore
  if (isFirebaseInitialized && db) {
    const docRef = db.collection('password_reset').doc(normalizedEmail);
    const doc = await docRef.get();

    if (doc.exists) {
      const data = doc.data();
      const createdAtMs = data.createdAt?.toDate
        ? data.createdAt.toDate().getTime()
        : new Date(data.createdAt).getTime();

      otpData = {
        otp: String(data.otp).trim(),
        createdAt: createdAtMs,
        verified: Boolean(data.verified),
        attempts: Number(data.attempts) || 0,
        docRef: docRef,
      };
    }
  }

  // 2. Fallback to memory store if not found in Firestore
  if (!otpData && memoryOtpStore.has(normalizedEmail)) {
    otpData = memoryOtpStore.get(normalizedEmail);
  }

  if (!otpData) {
    return { valid: false, reason: 'OTP expired or invalid. Please request a new OTP.' };
  }

  if (otpData.verified === true) {
    return { valid: false, reason: 'OTP has already been verified. Please request a new OTP.' };
  }

  const age = Date.now() - otpData.createdAt;
  if (age > OTP_EXPIRY_MS) {
    // Delete expired record
    if (otpData.docRef) {
      await otpData.docRef.delete().catch(() => {});
    }
    memoryOtpStore.delete(normalizedEmail);
    return { valid: false, reason: 'OTP has expired. Please request a new OTP.' };
  }

  if ((otpData.attempts || 0) >= MAX_VERIFY_ATTEMPTS) {
    if (otpData.docRef) {
      await otpData.docRef.delete().catch(() => {});
    }
    memoryOtpStore.delete(normalizedEmail);
    return { valid: false, reason: 'Too many failed attempts. Please request a new OTP.' };
  }

  if (!timingSafeEqual(otpData.otp, trimmedOtp)) {
    const nextAttempts = (otpData.attempts || 0) + 1;
    if (otpData.docRef) {
      await otpData.docRef.update({ attempts: nextAttempts }).catch(() => {});
    }
    if (memoryOtpStore.has(normalizedEmail)) {
      memoryOtpStore.get(normalizedEmail).attempts = nextAttempts;
    }
    return { valid: false, reason: 'Invalid verification code. Please check and try again.' };
  }

  // Mark as verified to prevent reuse
  if (otpData.docRef) {
    await otpData.docRef.update({
      verified: true,
      verifiedAt: new Date(),
    });
  }

  if (memoryOtpStore.has(normalizedEmail)) {
    const mem = memoryOtpStore.get(normalizedEmail);
    mem.verified = true;
    mem.verifiedAt = Date.now();
  }

  return { valid: true };
}

/**
 * Removes OTP record after reset link is successfully dispatched.
 * @param {string} email
 * @returns {Promise<void>}
 */
async function clearOtp(email) {
  const normalizedEmail = email.toLowerCase().trim();
  if (isFirebaseInitialized && db) {
    await db.collection('password_reset').doc(normalizedEmail).delete().catch(() => {});
  }
  memoryOtpStore.delete(normalizedEmail);
}

module.exports = {
  generateOtp,
  storeOtp,
  verifyOtp,
  clearOtp,
  OTP_EXPIRY_MS,
};
