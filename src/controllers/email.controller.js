/**
 * Email Controller
 * Handles customer support inquiries and contact form submissions.
 */

const brevoService = require('../services/brevo.service');
const { getSupportEmailTemplate } = require('../templates/email.templates');
const config = require('../config/env.config');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Handles incoming support inquiry submission.
 * POST /send-support-email
 */
async function sendSupportEmail(req, res, next) {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const subject = String(req.body?.subject || '').trim() || `New Support Inquiry from ${name}`;
    const message = String(req.body?.message || '').trim();

    // 1. Validate payload
    if (!name || !email || !message) {
      return res.status(400).json({
        error: 'Name, email, and message are all required.',
      });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        error: 'A valid email address is required.',
      });
    }

    if (name.length > 120 || email.length > 254 || message.length > 5000) {
      return res.status(400).json({
        error: 'Support message exceeds maximum character limits.',
      });
    }

    // 2. Check Brevo service availability
    if (!brevoService.isConfigured()) {
      return res.status(503).json({
        error: 'Email service is not configured on this server.',
      });
    }

    // 3. Render template and dispatch via Brevo
    const html = getSupportEmailTemplate({ name, email, message });

    await brevoService.sendTransactionalEmail({
      to: [{ email: config.brevo.senderEmail, name: 'St. Andrew Support Desk' }],
      replyTo: { email, name },
      subject: subject,
      htmlContent: html,
      senderName: "St. Andrew's Funeral Home",
    });

    return res.status(201).json({
      success: true,
      message: 'Support inquiry sent successfully.',
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  sendSupportEmail,
};
