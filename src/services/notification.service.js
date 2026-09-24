/**
 * User Notification Service
 * Saves an in-app notification to users/{uid}/notifications and pushes it to the user's devices.
 * The saved notification is the source of truth: a failed push never loses it.
 */

const { admin, db, isFirebaseInitialized } = require('../config/firebase.config');
const pushService = require('./push.service');

const NOTIFICATION_TYPES = ['chat_reply', 'booking_status', 'preplan_status', 'payment', 'payment_reminder'];

/**
 * Factory so tests can inject a fake Firestore and push sender.
 * @param {{ db: any, FieldValue: any, sendPush: (messages: object[]) => Promise<{ sent: number, invalidTokens: string[] }> }} deps
 */
function createNotifier({ db: firestore, FieldValue, sendPush }) {
  /** Unread total for the app icon badge; undefined if the count query isn't available. */
  async function countUnread(userRef) {
    try {
      const snap = await userRef.collection('notifications').where('read', '==', false).count().get();
      return snap.data().count;
    } catch {
      return undefined;
    }
  }

  /**
   * @param {{ userId: string, type: string, title: string, body: string, route?: string, refId?: string }} input
   *   refId: the booking/pre-plan this is about, so admin-web can show whether the family read it.
   * @returns {Promise<{ saved: boolean, pushed: number, reason?: string }>}
   */
  return async function notifyUser({ userId, type, title, body, route = '', refId = '' }) {
    const userRef = firestore.collection('users').doc(userId);
    const userSnap = await userRef.get();
    // Walk-in clients and deleted accounts have no user document: nothing to notify
    if (!userSnap.exists) {
      return { saved: false, pushed: 0, reason: 'user-not-found' };
    }

    const notificationRef = await userRef.collection('notifications').add({
      type,
      title,
      body,
      route,
      refId,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    const user = userSnap.data() || {};
    const tokens = Array.isArray(user.pushTokens) ? user.pushTokens : [];
    if (user.pushEnabled === false || tokens.length === 0) {
      return { saved: true, pushed: 0, reason: user.pushEnabled === false ? 'push-disabled' : 'no-devices' };
    }

    const messages = pushService.buildExpoMessages(tokens, {
      title,
      body,
      route,
      type,
      notificationId: notificationRef.id,
      badge: await countUnread(userRef),
    });
    if (messages.length === 0) {
      return { saved: true, pushed: 0, reason: 'no-devices' };
    }

    try {
      const { sent, invalidTokens } = await sendPush(messages);
      // Uninstalled apps / expired tokens: stop sending to them
      if (invalidTokens.length > 0) {
        await userRef.update({ pushTokens: FieldValue.arrayRemove(...invalidTokens) }).catch(() => {});
      }
      return { saved: true, pushed: sent };
    } catch (err) {
      console.warn(`⚠️ [Notify] Push failed for user ${userId}:`, err.message);
      return { saved: true, pushed: 0, reason: 'push-failed' };
    }
  };
}

/**
 * Production notifier bound to the Admin SDK. Logs instead of sending when Firebase isn't configured.
 */
async function notifyUser(input) {
  if (!isFirebaseInitialized || !db || !admin) {
    console.log(`ℹ️ [Notify] (dev, Firebase not initialized) ${input.type} → ${input.userId}: ${input.title}`);
    return { saved: false, pushed: 0, reason: 'firebase-unavailable' };
  }
  const notifier = createNotifier({
    db,
    FieldValue: admin.firestore.FieldValue,
    sendPush: (messages) => pushService.sendExpoPush(messages),
  });
  return notifier(input);
}

module.exports = {
  NOTIFICATION_TYPES,
  createNotifier,
  notifyUser,
};
