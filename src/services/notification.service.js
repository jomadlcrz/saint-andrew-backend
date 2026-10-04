/**
 * User Notification Service
 * Saves an in-app notification to users/{uid}/notifications and pushes it to the user's devices.
 * The saved notification is the source of truth: a failed push never loses it.
 */

const { admin, db, isFirebaseInitialized } = require('../config/firebase.config');
const config = require('../config/env.config');
const pushService = require('./push.service');
const brevoService = require('./brevo.service');
const { getFamilyNoticeEmailTemplate } = require('../templates/email.templates');

const NOTIFICATION_TYPES = ['chat_reply', 'request_status', 'preplan_status', 'payment', 'payment_reminder', 'testimonial'];

/**
 * An address we can email: a real one. Accounts made with a mobile number sign in with an internal
 * address under the reserved ".invalid" domain, which can never receive mail.
 */
function isDeliverableEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && !/\.invalid$/i.test(email.trim());
}

/** The website address for an in-app route ("/(app)/arrangements" → "<site>/arrangements"). */
function webLink(baseUrl, route) {
  if (!baseUrl) return '';
  const path = (route || '').replace(/\/\([^/)]+\)/g, '') || '/';
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Factory so tests can inject a fake Firestore, push and email senders.
 * @param {{
 *   db: any,
 *   FieldValue: any,
 *   sendPush: (messages: object[]) => Promise<{ sent: number, invalidTokens: string[] }>,
 *   sendEmail?: (email: { to: string, name: string, subject: string, html: string, attachments: { name: string, content: string }[] }) => Promise<unknown>,
 *   webUrl?: string,
 * }} deps
 */
function createNotifier({ db: firestore, FieldValue, sendPush, sendEmail, webUrl = '' }) {
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
   * Also emails the family when asked: to their account's own address (never one the caller
   * chooses), with an optional PDF. Accounts without a real address (signed up with a mobile
   * number) get no email; the result says why.
   */
  async function emailUser(user, { title, body, route, attachment }) {
    if (user.status === 'inactive' || user.status === 'suspended') return { emailed: false, emailReason: `user-${user.status}` };
    if (!isDeliverableEmail(user.email)) return { emailed: false, emailReason: 'no-email' };
    if (!sendEmail) return { emailed: false, emailReason: 'email-unavailable' };
    try {
      await sendEmail({
        to: user.email.trim(),
        name: typeof user.fullName === 'string' ? user.fullName : '',
        subject: title,
        html: getFamilyNoticeEmailTemplate({
          title,
          body,
          link: webLink(webUrl, route),
          attachmentNote: attachment ? `A copy is attached (${attachment.name}).` : '',
        }),
        attachments: attachment ? [attachment] : [],
      });
      return { emailed: true };
    } catch (err) {
      console.warn(`⚠️ [Notify] Email failed for user:`, err.message);
      return { emailed: false, emailReason: 'email-failed' };
    }
  }

  /**
   * @param {{ userId: string, type: string, title: string, body: string, route?: string, refId?: string,
   *   email?: boolean, attachment?: { name: string, content: string } | null }} input
   *   refId: the arrangement/pre-plan this is about, so admin-web can show whether the family read it.
   *   email: also email the account's address; attachment: a PDF (base64) to attach to it.
   * @returns {Promise<{ saved: boolean, pushed: number, reason?: string, emailed?: boolean, emailReason?: string }>}
   */
  return async function notifyUser({ userId, type, title, body, route = '', refId = '', email = false, attachment = null }) {
    const result = await notifyAndPush({ userId, type, title, body, route, refId });
    if (!email || !result.user) return withoutUser(result, email);
    return { ...withoutUser(result, false), ...(await emailUser(result.user, { title, body, route, attachment })) };
  };

  /** The result without the account it was read from (kept only to email it). */
  function withoutUser({ user, ...rest }, emailAsked) {
    return emailAsked ? { ...rest, emailed: false, emailReason: rest.reason || 'user-not-found' } : rest;
  }

  async function notifyAndPush({ userId, type, title, body, route, refId }) {
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
    if (user.status === 'inactive' || user.status === 'suspended') {
      return { saved: true, pushed: 0, reason: `user-${user.status}`, user };
    }
    const tokens = Array.isArray(user.pushTokens) ? user.pushTokens : [];
    if (user.pushEnabled === false || tokens.length === 0) {
      return { saved: true, pushed: 0, reason: user.pushEnabled === false ? 'push-disabled' : 'no-devices', user };
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
      return { saved: true, pushed: 0, reason: 'no-devices', user };
    }

    try {
      const { sent, invalidTokens } = await sendPush(messages);
      // Uninstalled apps / expired tokens: stop sending to them
      if (invalidTokens.length > 0) {
        await userRef.update({ pushTokens: FieldValue.arrayRemove(...invalidTokens) }).catch(() => {});
      }
      return { saved: true, pushed: sent, user };
    } catch (err) {
      console.warn(`⚠️ [Notify] Push failed for user ${userId}:`, err.message);
      return { saved: true, pushed: 0, reason: 'push-failed', user };
    }
  }
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
    sendEmail: config.brevo.isConfigured
      ? ({ to, name, subject, html, attachments }) =>
          brevoService.sendTransactionalEmail({ to: [{ email: to, name: name || to }], subject, htmlContent: html, attachments })
      : undefined,
    webUrl: config.publicWebUrl,
  });
  return notifier(input);
}

module.exports = {
  NOTIFICATION_TYPES,
  createNotifier,
  isDeliverableEmail,
  webLink,
  notifyUser,
};
