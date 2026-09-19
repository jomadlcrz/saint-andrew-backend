/**
 * Semaphore SMS Service
 * Manages outgoing SMS delivery via Semaphore PH Gateway with development fallback.
 */

const config = require('../config/env.config');

const SEMAPHORE_API_URL = 'https://api.semaphore.co/api/v4/messages';

/**
 * Dispatches an SMS message.
 * If SEMAPHORE_API_KEY is unset or empty, operates in simulated mode.
 *
 * @param {Object} params
 * @param {string} params.number - Normalized 11-digit PH phone number (09XXXXXXXXX)
 * @param {string} params.message - SMS message text
 * @returns {Promise<{ messageId: string, simulated: boolean, raw?: any }>}
 */
async function sendSms({ number, message }) {
  const apiKey = config.semaphore.apiKey;

  // Development / fallback simulation
  if (!apiKey) {
    const simulatedId = `sim_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    console.log(`📱 [SMS Simulated] To: ${number} | Content: "${message.substring(0, 60)}..."`);
    console.log(`ℹ️ [SMS Simulated] SEMAPHORE_API_KEY not configured. Dispatched simulated message ID: ${simulatedId}`);
    return {
      messageId: simulatedId,
      simulated: true,
    };
  }

  console.log(`📤 [SMS Semaphore] Dispatching real SMS to ${number}...`);

  const response = await fetch(SEMAPHORE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      apikey: apiKey,
      number: number,
      message: message,
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error(`❌ [SMS Semaphore] HTTP ${response.status}: ${responseText}`);
    const err = new Error(`Semaphore API rejected request (${response.status}): ${responseText}`);
    err.status = response.status;
    throw err;
  }

  let parsedData = null;
  try {
    parsedData = JSON.parse(responseText);
  } catch {
    parsedData = { raw: responseText };
  }

  const messageId = Array.isArray(parsedData)
    ? parsedData[0]?.message_id || parsedData[0]?.id
    : parsedData?.message_id || parsedData?.id || `sem_${Date.now()}`;

  console.log(`✅ [SMS Semaphore] Message successfully dispatched. Message ID: ${messageId}`);

  return {
    messageId: String(messageId),
    simulated: false,
    raw: parsedData,
  };
}

module.exports = {
  sendSms,
  isConfigured: () => config.semaphore.isConfigured,
};
