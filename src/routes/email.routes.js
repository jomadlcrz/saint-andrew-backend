/**
 * Email Routes
 */

const express = require('express');
const router = express.Router();
const emailController = require('../controllers/email.controller');

router.post('/send-support-email', emailController.sendSupportEmail);

module.exports = router;
