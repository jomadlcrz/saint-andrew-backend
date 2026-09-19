/**
 * Brevo Transactional Email Service
 * Handles transactional emails via Brevo REST API v3.
 */

const config = require('../config/env.config');

const BREVO_SMTP_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_ACCOUNT_URL = 'https://api.brevo.com/v3/account';

/**
 * Sends a transactional email through Brevo SMTP API.
 *
 * @param {Object} params
 * @param {Array<{ email: string, name?: string }> | string} params.to - Recipient(s)
 * @param {string} params.subject - Subject line
 * @param {string} params.htmlContent - HTML body
 * @param {{ email: string, name?: string }} [params.replyTo] - Reply-to recipient
 * @param {string} [params.senderName] - Display name for sender
 * @returns {Promise<any>}
 */
async function sendTransactionalEmail({ to, subject, htmlContent, replyTo, senderName }) {
  if (!config.brevo.isConfigured) {
    const error = new Error('BREVO_API_KEY is not configured on the backend.');
    error.status = 503;
    throw error;
  }

  const recipients = Array.isArray(to)
    ? to
    : [{ email: to, name: to }];

  const payload = {
    sender: {
      name: senderName || "St. Andrew's Funeral Home",
      email: config.brevo.senderEmail,
    },
    to: recipients,
    subject: subject,
    htmlContent: htmlContent,
  };

  if (replyTo && replyTo.email) {
    payload.replyTo = {
      email: replyTo.email,
      name: replyTo.name || replyTo.email,
    };
  }

  console.log(`📧 [Brevo] Sending email to: ${recipients.map((r) => r.email).join(', ')} | Subject: "${subject}"`);

  const response = await fetch(BREVO_SMTP_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': config.brevo.apiKey,
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error(`❌ [Brevo] Dispatch error (Status ${response.status}): ${responseText}`);
    const error = new Error(`Brevo HTTP ${response.status}: ${responseText}`);
    error.status = response.status === 401 ? 502 : response.status;
    throw error;
  }

  try {
    return responseText ? JSON.parse(responseText) : { success: true };
  } catch {
    return { response: responseText };
  }
}

/**
 * Tests connection to Brevo account API.
 * @returns {Promise<{ status: number, data: any }>}
 */
async function testConnection() {
  if (!config.brevo.isConfigured) {
    const error = new Error('BREVO_API_KEY is not configured.');
    error.status = 503;
    throw error;
  }

  const response = await fetch(BREVO_ACCOUNT_URL, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'api-key': config.brevo.apiKey,
    },
  });

  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return {
    status: response.status,
    data: data,
  };
}

module.exports = {
  sendTransactionalEmail,
  testConnection,
  isConfigured: () => config.brevo.isConfigured,
};
