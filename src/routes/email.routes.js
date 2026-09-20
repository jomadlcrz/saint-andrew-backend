/**
 * Email Routes
 */

const express = require('express');
const router = express.Router();
const emailController = require('../controllers/email.controller');
const { supportEmailLimiter } = require('../middleware/rate-limit.middleware');

router.post('/send-support-email', supportEmailLimiter, emailController.sendSupportEmail);

module.exports = router;
