/**
 * Arrangement Tracking & Claim Routes
 */

const express = require('express');
const router = express.Router();
const arrangementController = require('../controllers/arrangement.controller');
const { verifyFirebaseAuth } = require('../middleware/auth.middleware');
const { arrangementLookupLimiter } = require('../middleware/rate-limit.middleware');

router.post('/track-arrangement', arrangementLookupLimiter, arrangementController.trackArrangement);
router.post('/claim-arrangement', arrangementLookupLimiter, verifyFirebaseAuth, arrangementController.claimArrangement);

module.exports = router;
