/**
 * Authentication & Password Reset Routes
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

router.post('/send-otp-email', authController.sendOtpEmail);
router.post('/verify-otp', authController.verifyOtp);
router.post('/send-reset-link', authController.sendResetLink);

module.exports = router;
