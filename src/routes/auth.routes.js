/**
 * Authentication & Password Reset Routes
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const phoneAccountController = require('../controllers/phone-account.controller');
const { verifyFirebaseAuth } = require('../middleware/auth.middleware');
const {
  otpRequestLimiter,
  otpVerifyLimiter,
  resetLinkLimiter,
  resetPasswordLimiter,
  smsCodeLimiter,
  findAccountLimiter,
} = require('../middleware/rate-limit.middleware');

router.post('/send-otp-email', otpRequestLimiter, authController.sendOtpEmail);
router.post('/verify-otp', otpVerifyLimiter, authController.verifyOtp);
router.post('/reset-password', resetPasswordLimiter, authController.resetPassword);
router.post('/send-reset-link', resetLinkLimiter, authController.sendResetLink);
router.post('/change-password', resetPasswordLimiter, verifyFirebaseAuth, authController.changePassword);

// Accounts that use a mobile number instead of an email (SMS code)
router.post('/send-otp-sms', smsCodeLimiter, phoneAccountController.sendOtpSms);
router.post('/register-phone', otpVerifyLimiter, phoneAccountController.registerPhone);
router.post('/verify-otp-sms', otpVerifyLimiter, phoneAccountController.verifyOtpSms);
router.post('/reset-password-phone', resetPasswordLimiter, phoneAccountController.resetPasswordPhone);

// Forgot password: is there an account with this email or number?
router.post('/find-account', findAccountLimiter, phoneAccountController.findAccount);

module.exports = router;
