/**
 * SMS Routes
 */

const express = require('express');
const router = express.Router();
const smsController = require('../controllers/sms.controller');
const { verifyFirebaseAuth, requireAdminRole } = require('../middleware/auth.middleware');
const { smsLimiter } = require('../middleware/rate-limit.middleware');

router.post('/send-balance-sms', smsLimiter, verifyFirebaseAuth, requireAdminRole, smsController.sendBalanceSms);

module.exports = router;
