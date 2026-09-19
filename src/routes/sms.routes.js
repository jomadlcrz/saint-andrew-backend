/**
 * SMS Routes
 */

const express = require('express');
const router = express.Router();
const smsController = require('../controllers/sms.controller');
const { verifyFirebaseAuth } = require('../middleware/auth.middleware');

router.post('/send-balance-sms', verifyFirebaseAuth, smsController.sendBalanceSms);

module.exports = router;
