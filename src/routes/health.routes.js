/**
 * Health & Diagnostics Routes
 */

const express = require('express');
const router = express.Router();
const healthController = require('../controllers/health.controller');
const { verifyFirebaseAuth, requireAdminRole } = require('../middleware/auth.middleware');

router.get('/', healthController.getRoot);
router.get('/health', healthController.getHealth);
router.get('/test-brevo', verifyFirebaseAuth, requireAdminRole, healthController.testBrevo);

module.exports = router;
