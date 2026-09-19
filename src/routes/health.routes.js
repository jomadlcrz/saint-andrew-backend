/**
 * Health & Diagnostics Routes
 */

const express = require('express');
const router = express.Router();
const healthController = require('../controllers/health.controller');

router.get('/', healthController.getHealth);
router.get('/health', healthController.getHealth);
router.get('/test-brevo', healthController.testBrevo);

module.exports = router;
