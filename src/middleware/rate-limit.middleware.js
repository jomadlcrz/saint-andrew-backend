/**
 * Rate Limiting Middleware
 * Throttles abuse-prone public endpoints (OTP, email, SMS dispatch).
 */

const rateLimit = require('express-rate-limit');

const jsonRateLimitHandler = (message) => (req, res) => {
  res.status(429).json({ error: message });
};

// OTP request: an attacker who can trigger unlimited OTP emails can also
// flood the recipient's inbox and spend Brevo send quota.
const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Too many OTP requests from this address. Please try again in 15 minutes.'),
});

// OTP verification: a 6-digit code is only 1,000,000 combinations, so this
// limiter is the defense-in-depth layer alongside the per-email attempt
// lockout enforced in otp.service.js.
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Too many verification attempts. Please request a new OTP.'),
});

const resetLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Too many reset link requests. Please try again in 15 minutes.'),
});

// Password reset: bounds attempts to redeem a reset token against a wrong
// or brute-forced value.
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Too many password reset attempts. Please try again in 15 minutes.'),
});

const supportEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Too many support requests from this address. Please try again later.'),
});

const smsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Too many SMS requests. Please try again later.'),
});

// Admin → family notifications: one per admin action, generous for busy days
const notifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler('Too many notification requests. Please try again shortly.'),
});

module.exports = {
  notifyLimiter,
  otpRequestLimiter,
  otpVerifyLimiter,
  resetLinkLimiter,
  resetPasswordLimiter,
  supportEmailLimiter,
  smsLimiter,
};
