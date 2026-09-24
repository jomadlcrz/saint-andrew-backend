/**
 * Root API Router
 * Aggregates all route modules.
 */

const express = require('express');
const router = express.Router();

const healthRoutes = require('./health.routes');
const smsRoutes = require('./sms.routes');
const emailRoutes = require('./email.routes');
const authRoutes = require('./auth.routes');
const notificationRoutes = require('./notification.routes');
const accountRoutes = require('./account.routes');
const arrangementRoutes = require('./arrangement.routes');

// Mount routes
router.use('/', healthRoutes);
router.use('/', smsRoutes);
router.use('/', emailRoutes);
router.use('/', authRoutes);
router.use('/', notificationRoutes);
router.use('/', accountRoutes);
router.use('/', arrangementRoutes);

module.exports = router;
