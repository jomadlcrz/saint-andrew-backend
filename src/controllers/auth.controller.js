/**
 * Authentication & Password Reset Controller
 * Handles OTP dispatch, OTP verification, and password reset link generation.
 */

const { admin, isFirebaseInitialized } = require('../config/firebase.config');
const otpService = require('../services/otp.service');
const resetTokenService = require('../services/reset-token.service');
const brevoService = require('../services/brevo.service');
const { getOtpEmailTemplate, getResetLinkEmailTemplate } = require('../templates/email.templates');
const config = require('../config/env.config');
const { passwordProblem, isCurrentPassword, SAME_PASSWORD_MESSAGE } = require('../utils/password-policy');

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

    // Issue a short-lived, single-use token authorizing the password change
    // that must follow. The OTP itself is now consumed and cannot be reused.
    const resetToken = await resetTokenService.issueResetToken(email);

    console.log(`✅ [Auth] OTP verified successfully for ${email}`);

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully.',
      resetToken,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * Resets the admin's password after OTP verification, using the single-use
 * reset token issued by verifyOtp. Passwords are hashed and stored by
 * Firebase Auth via the Admin SDK — the project's existing auth store.
 * POST /reset-password
 */
async function resetPassword(req, res, next) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.newPassword || '');
    const confirmPassword = String(req.body?.confirmPassword || '');

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        error: 'A valid email address is required.',
      });
    }

    if (!token) {
      return res.status(400).json({
        error: 'A valid reset session is required. Please verify your code again.',
      });
    }

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        error: 'Please enter and confirm your new password.',
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        error: 'Passwords do not match.',
      });
    }

    if (!isFirebaseInitialized || !admin) {
      return res.status(503).json({
        error: 'Authentication service is not available on the server.',
      });
    }

    // Checked before the reset session is used up, so a weak password doesn't cost a new code
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch {
      userRecord = null;
    }
    const problem = passwordProblem(newPassword, { email, name: userRecord?.displayName });
    if (problem) {
      return res.status(400).json({ error: problem });
    }
    if (await isCurrentPassword(email, newPassword, config.firebase.webApiKey)) {
      return res.status(400).json({ error: SAME_PASSWORD_MESSAGE });
    }

    const tokenResult = await resetTokenService.verifyAndConsumeResetToken(email, token);
    if (!tokenResult.valid) {
      return res.status(400).json({
        error: tokenResult.reason || 'Invalid or expired reset session. Please verify your code again.',
      });
    }

    try {
      if (!userRecord) throw new Error('No account for this email.');
      await admin.auth().updateUser(userRecord.uid, { password: newPassword });
      // Anyone signed in with the old password (e.g. on a lost phone) is signed out
      await admin.auth().revokeRefreshTokens(userRecord.uid);
    } catch (err) {
      console.error(`❌ [Auth] Error updating password for ${email}:`, err.message);
      return res.status(400).json({
        error: 'Unable to reset password. Please try again.',
      });
    }

    // Clean up any lingering OTP session now that the password has changed.
    await otpService.clearOtp(email);

    console.log(`✅ [Auth] Password reset successfully for ${email}`);

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully.',
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

/**
 * Changes the signed-in family's password (Change Password in the app, not Forgot Password).
 * The app signs in again with the current password first (Firebase re-authentication), so the ID
 * token here must be fresh. Other devices are signed out; the app signs itself back in with the new
 * password, so the family stays on the page.
 * POST /change-password   Authorization: Bearer <Firebase ID token>
 * Body: { currentPassword, newPassword }
 */
const RECENT_SIGN_IN_SECONDS = 5 * 60;

async function changePassword(req, res, next) {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Please enter your current and new password.' });
    }
    if (!isFirebaseInitialized || !admin) {
      return res.status(503).json({ error: 'Authentication service is not available on the server.' });
    }

    const uid = req.user?.uid;
    const authTime = Number(req.user?.auth_time || 0);
    if (!uid) return res.status(401).json({ error: 'Please sign in again.' });
    // The app re-checked the current password just now; an older sign-in isn't enough
    if (!authTime || Date.now() / 1000 - authTime > RECENT_SIGN_IN_SECONDS) {
      return res.status(401).json({ error: 'For your security, please enter your current password again.' });
    }

    if (newPassword === currentPassword) {
      return res.status(400).json({ error: SAME_PASSWORD_MESSAGE });
    }
    const userRecord = await admin.auth().getUser(uid);
    const problem = passwordProblem(newPassword, { email: userRecord.email, name: userRecord.displayName });
    if (problem) return res.status(400).json({ error: problem });

    await admin.auth().updateUser(uid, { password: newPassword });
    await admin.auth().revokeRefreshTokens(uid);
    console.log(`✅ [Auth] Password changed for ${uid}`);
    return res.status(200).json({ success: true, message: 'Password changed.' });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  sendOtpEmail,
  verifyOtp,
  resetPassword,
  sendResetLink,
  changePassword,
  RECENT_SIGN_IN_SECONDS,
};
