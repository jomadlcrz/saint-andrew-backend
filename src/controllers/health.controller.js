/**
 * Health & Diagnostics Controller
 */

const brevoService = require('../services/brevo.service');

/**
 * Basic health check endpoint
 * GET /
 */
function getHealth(req, res) {
  // If request specifically accepts plain text, respond with standard 'ok' for pingers
  if (req.headers.accept && !req.headers.accept.includes('application/json') && req.headers.accept.includes('text/plain')) {
    return res.status(200).send('ok');
  }

  return res.status(200).json({
    status: 'online',
    service: 'Saint Andrew Funeral Home Backend Microservice',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Brevo Account API Diagnostics
 * GET /test-brevo
 */
async function testBrevo(req, res, next) {
  try {
    const result = await brevoService.testConnection();
    return res.status(result.status).json(result.data);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getHealth,
  testBrevo,
};
