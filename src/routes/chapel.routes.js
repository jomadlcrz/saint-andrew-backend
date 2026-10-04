/**
 * St. Andrew Chapel Routes
 */

const express = require('express');
const router = express.Router();
const chapelController = require('../controllers/chapel.controller');
const { chapelLimiter } = require('../middleware/rate-limit.middleware');

router.get('/chapel-availability', chapelLimiter, chapelController.getChapelAvailability);

module.exports = router;
