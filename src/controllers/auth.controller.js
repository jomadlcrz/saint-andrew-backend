/**
 * Authentication & Password Reset Controller
 * Handles OTP dispatch, OTP verification, and password reset link generation.
 */

const { admin, isFirebaseInitialized } = require('../config/firebase.config');
const otpService = require('../services/otp.service');
const brevoService = require('../services/brevo.service');
const { getOtpEmailTemplate, getResetLinkEmailTemplate } = require('../templates/email.templates');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Generates and emails a 6-digit OTP code to the requested address.
 * POST /send-otp-email
 */
async function sendOtpEmail(req, res, next) {
  const email = String(req.body?.email || '').trim().toLowerCase();

  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({
      error: 'A valid email address is required.',
    });
  }

  if (!brevoService.isConfigured()) {
    return res.status(503).json({
      error: 'Email service is not configured on the backend.',
    });
  }

  const otp = otpService.generateOtp();

  try {
    // 1. Store OTP in database/memory
    await otpService.storeOtp(email, otp);

    // 2. Dispatch OTP via Brevo
    const html = getOtpEmailTemplate({ otp, expiryMinutes: 15 });
    await brevoService.sendTransactionalEmail({
      to: email,
      subject: 'Password Reset OTP - St. Andrew Funeral Home',
      htmlContent: html,
      senderName: "St. Andrew's Funeral Home",
    });

    console.log(`🔐 [Auth] Dispatched 6-digit OTP to ${email}`);

    return res.status(201).json({
      success: true,
      message: 'OTP sent successfully.',
    });
  } catch (err) {
    console.error(`❌ [Auth] Error sending OTP to ${email}:`, err.message);
    return res.status(err.status || 500).json({
      error: 'Unable to send OTP email.',
    });
  }
}

/**
 * Validates the 6-digit OTP provided by the user.
 * POST /verify-otp
 */
async function verifyOtp(req, res, next) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').trim();

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        error: 'A valid email address is required.',
      });
    }

    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        error: 'OTP must be a 6-digit code.',
      });
    }

    const verificationResult = await otpService.verifyOtp(email, otp);

    if (!verificationResult.valid) {
      return res.status(400).json({
        error: verificationResult.reason || 'Invalid verification code.',
      });
    }

    console.log(`✅ [Auth] OTP verified successfully for ${email}`);

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully.',
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * Generates an official Firebase password reset link and dispatches it via Brevo.
 * POST /send-reset-link
 */
async function sendResetLink(req, res, next) {
  const email = String(req.body?.email || '').trim().toLowerCase();

  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({
      error: 'A valid email address is required.',
    });
  }

  if (!isFirebaseInitialized || !admin) {
    return res.status(503).json({
      error: 'Firebase is not available on the server.',
    });
  }

  if (!brevoService.isConfigured()) {
    return res.status(503).json({
      error: 'Email service is not configured on the backend.',
    });
  }

  try {
    const db = admin.firestore();
    const otpRef = db.collection('password_reset').doc(email);
    const otpDoc = await otpRef.get();

    if (!otpDoc.exists) {
      return res.status(400).json({
        error: 'Session expired. Please request an OTP again.',
      });
    }

    const otpData = otpDoc.data();
    if (otpData?.verified !== true) {
      return res.status(400).json({
        error: 'Please verify the OTP before requesting the reset link.',
      });
    }

    // Generate password reset link via Firebase Admin SDK
    const resetLink = await admin.auth().generatePasswordResetLink(email);

    // Email reset link to customer via Brevo
    const html = getResetLinkEmailTemplate({ resetLink, expiryHours: 1 });
    await brevoService.sendTransactionalEmail({
      to: email,
      subject: 'Password Reset Link - St. Andrew Funeral Home',
      htmlContent: html,
      senderName: "St. Andrew's Funeral Home",
    });

    // Clean up OTP session
    await otpService.clearOtp(email);

    console.log(`✅ [Auth] Password reset link sent to ${email}`);

    return res.status(200).json({
      success: true,
      message: 'Password reset link sent successfully.',
    });
  } catch (err) {
    console.error('❌ [Auth] Error generating reset link:', err.message);
    return res.status(err.status || 500).json({
      error: 'Unable to send password reset link.',
    });
  }
}

module.exports = {
  sendOtpEmail,
  verifyOtp,
  sendResetLink,
};
