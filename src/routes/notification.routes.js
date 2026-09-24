/**
 * Notification Routes
 */

const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { verifyFirebaseAuth, requireAdminRole } = require('../middleware/auth.middleware');
const { notifyLimiter } = require('../middleware/rate-limit.middleware');

router.post('/notify-user', notifyLimiter, verifyFirebaseAuth, requireAdminRole, notificationController.notifyUserHandler);

module.exports = router;
