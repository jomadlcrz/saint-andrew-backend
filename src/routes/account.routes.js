/**
 * Account Lookup Routes
 */

const express = require('express');
const router = express.Router();
const accountController = require('../controllers/account.controller');
const { optionalFirebaseAuth } = require('../middleware/auth.middleware');
const { phoneLookupLimiter } = require('../middleware/rate-limit.middleware');

router.post('/resolve-login-phone', phoneLookupLimiter, accountController.resolveLoginPhone);
router.post('/check-phone-available', phoneLookupLimiter, optionalFirebaseAuth, accountController.checkPhoneAvailable);

module.exports = router;
