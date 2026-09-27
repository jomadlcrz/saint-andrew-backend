/**
 * Authentication & Password Reset Routes
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verifyFirebaseAuth } = require('../middleware/auth.middleware');
const {
  otpRequestLimiter,
  otpVerifyLimiter,
  resetLinkLimiter,
  resetPasswordLimiter,
} = require('../middleware/rate-limit.middleware');

router.post('/send-otp-email', otpRequestLimiter, authController.sendOtpEmail);
router.post('/verify-otp', otpVerifyLimiter, authController.verifyOtp);
router.post('/reset-password', resetPasswordLimiter, authController.resetPassword);
router.post('/send-reset-link', resetLinkLimiter, authController.sendResetLink);
router.post('/change-password', resetPasswordLimiter, verifyFirebaseAuth, authController.changePassword);

module.exports = router;
