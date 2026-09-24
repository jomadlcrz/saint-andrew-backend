/**
 * Expo Push Service
 * Sends mobile push notifications through Expo's push API (https://docs.expo.dev/push-notifications/sending-notifications/).
 * Uses Node's built-in fetch — no SDK dependency.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Must match the Android channel the mobile app creates (src/services/notifications.service.ts)
const ANDROID_CHANNEL_ID = 'st-andrew-updates';

// Expo accepts at most 100 messages per request
const EXPO_BATCH_SIZE = 100;

/**
 * @param {string} token
 * @returns {boolean} True for Expo push tokens (ExponentPushToken[...] / ExpoPushToken[...]).
 */
function isExpoPushToken(token) {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(token);
}

/**
 * Builds one Expo message per device token.
 * @param {string[]} tokens
 * @param {{ title: string, body: string, route?: string, type?: string, notificationId?: string, badge?: number }} notification
 */
function buildExpoMessages(tokens, notification) {
  return tokens.filter(isExpoPushToken).map((to) => ({
    // App icon badge (unread total); omitted when unknown so the icon keeps its last value
    ...(typeof notification.badge === 'number' ? { badge: notification.badge } : {}),
    to,
    title: notification.title,
    body: notification.body,
    sound: 'default',
    channelId: ANDROID_CHANNEL_ID,
    priority: 'high',
    data: {
      route: notification.route || '',
      type: notification.type || '',
      notificationId: notification.notificationId || '',
    },
  }));
}

/**
 * Reads Expo's per-message tickets (same order as the messages sent).
 * @returns {{ sent: number, invalidTokens: string[] }} invalidTokens are devices Expo says no longer exist.
 */
function parseExpoTickets(messages, tickets) {
  let sent = 0;
  const invalidTokens = [];
  (tickets || []).forEach((ticket, index) => {
    if (ticket?.status === 'ok') {
      sent += 1;
    } else if (ticket?.details?.error === 'DeviceNotRegistered' && messages[index]) {
      invalidTokens.push(messages[index].to);
    }
  });
  return { sent, invalidTokens };
}

/**
 * Sends messages to Expo in batches.
 * @param {object[]} messages
 * @param {typeof fetch} [fetchImpl] Injectable for tests.
 * @returns {Promise<{ sent: number, invalidTokens: string[] }>}
 */
async function sendExpoPush(messages, fetchImpl = fetch) {
  const result = { sent: 0, invalidTokens: [] };

  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
    const res = await fetchImpl(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload?.errors?.[0]?.message || `Expo push request failed (Status ${res.status})`);
    }

    const parsed = parseExpoTickets(batch, payload.data);
    result.sent += parsed.sent;
    result.invalidTokens.push(...parsed.invalidTokens);
  }

  return result;
}

module.exports = {
  ANDROID_CHANNEL_ID,
  isExpoPushToken,
  buildExpoMessages,
  parseExpoTickets,
  sendExpoPush,
};
