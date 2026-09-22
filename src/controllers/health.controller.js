/**
 * Health & Diagnostics Controller
 */

const brevoService = require('../services/brevo.service');
const { getHomePageHtml } = require('../templates/home.template');

/**
 * Root landing page
 * GET /
 * Serves the classic minimalist HTML home page from saint-andrew-user-web.
 * If caller explicitly requests JSON or plain text without HTML, falls back to health info.
 */
function getRoot(req, res) {
  const accept = req.headers.accept || '';

  if ((accept.includes('application/json') && !accept.includes('text/html')) || accept.includes('text/plain')) {
    return getHealth(req, res);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(getHomePageHtml());
}

/**
 * Basic health check endpoint
 * GET /health
 */
function getHealth(req, res) {
  // If request specifically accepts plain text, respond with standard 'ok' for pingers
  if (req.headers.accept && !req.headers.accept.includes('application/json') && req.headers.accept.includes('text/plain')) {
    return res.status(200).send('ok');
  }

  return res.status(200).json({
    status: 'online',
    service: 'Saint Andrew Funeral Home',
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
  getRoot,
  getHealth,
  testBrevo,
};
