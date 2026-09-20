/**
 * Authentication & Password Reset Routes
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { otpRequestLimiter, otpVerifyLimiter, resetLinkLimiter } = require('../middleware/rate-limit.middleware');

router.post('/send-otp-email', otpRequestLimiter, authController.sendOtpEmail);
router.post('/verify-otp', otpVerifyLimiter, authController.verifyOtp);
router.post('/send-reset-link', resetLinkLimiter, authController.sendResetLink);

module.exports = router;
