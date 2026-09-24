/**
 * Pre-Planning Scheduled Payment Reminders Service
 *
 * Runs as a daily node-cron sweep at 9:00 AM.
 * Scans active Pre-Planning contracts in Firestore (`pre_plans` collection)
 * and dispatches payment reminders for installments due within 3 days.
 */

const cron = require('node-cron');
const { admin, db, isFirebaseInitialized } = require('../config/firebase.config');
const semaphoreService = require('./semaphore.service');
const { notifyUser } = require('./notification.service');
const { formatPaymentReminder } = require('../templates/sms.templates');
const { normalizePhilippinePhone, isValidPhilippinePhone } = require('../utils/phone.util');

const REMINDER_WINDOW_DAYS = 3;

/**
 * Which reminder channels still need to go out for a schedule period.
 * SMS applies when the plan has a valid phone, the in-app notification when it has a userId.
 */
function pendingReminderChannels(period, { canSms, userId }) {
  return {
    needsSms: Boolean(canSms) && !period.smsReminderSentAt,
    needsNotification: Boolean(userId) && !period.notificationReminderSentAt,
  };
}

/**
 * Stamps the channels that just succeeded on the period. `reminderSentAt` is set only once
 * every applicable channel has succeeded, so the sweep stops reminding for this period.
 */
function applyReminderResult(period, { canSms, userId, smsSent, notificationDone, now }) {
  const next = { ...period };
  if (smsSent) next.smsReminderSentAt = now;
  if (notificationDone) next.notificationReminderSentAt = now;
  const { needsSms, needsNotification } = pendingReminderChannels(next, { canSms, userId });
  if (!needsSms && !needsNotification) next.reminderSentAt = now;
  return next;
}

/**
 * Sweep pre_plans collection and send SMS reminders for upcoming due dates.
 */
async function sendPrePlanPaymentReminders() {
  if (!isFirebaseInitialized || !admin || !db) {
    console.log('⚠️ [PrePlan Reminder] Skipped — Firebase Admin SDK not initialized.');
    return;
  }

  console.log('⏰ [PrePlan Reminder] Running Pre-Planning payment reminder sweep...');

  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  let snapshot;
  try {
    snapshot = await db
      .collection('pre_plans')
      .where('requestStatus', '==', 'Accepted')
      .where('isCompleted', '==', false)
      .get();
  } catch (error) {
    console.warn('⚠️ [PrePlan Reminder] Failed to query pre_plans:', error.message);
    return;
  }

  let remindersSent = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const schedule = Array.isArray(data.paymentSchedule) ? data.paymentSchedule : [];
    // Prefer the Authorized Family Representative's phone (the living contact) once present;
    // fall back to the legacy contactPhone field for documents written before representativeInfo
    // was mandatory. See preplan.types.ts / plan Phase A1.
    const phone = normalizePhilippinePhone(data.representativeInfo?.phone || data.contactPhone || '');
    const canSms = isValidPhilippinePhone(phone);
    // Plans submitted from the mobile app carry the family's account, so they also get a push.
    // Web/admin-created plans have no userId and stay SMS-only.
    const userId = typeof data.userId === 'string' ? data.userId : '';
    if (!canSms && !userId) continue;

    // Fall back to `totalPrice` (the `transactions`-collection field name) for walk-in-mirrored
    // pre_plans documents written before the mirror explicitly set `totalAmount` — mirrors
    // getPrePlanTotalAmount() in admin-web/src/services/preplan.service.ts.
    const totalAmount = Number(data.totalAmount ?? data.totalPrice ?? 0);
    const amountPaid = Number(data.amountPaid || 0);
    const remainingBalance = totalAmount - amountPaid;

    // paymentPlanKind distinguishes Pre-Need's Long-term Installment from At-Need's Short-term
    // Payment (spec 3.5). Documents written before this field existed fall back to the older
    // planKind/planType-based guess, matching getPrePlanPaymentPlanKind() in admin-web.
    const paymentPlanKind =
      data.paymentPlanKind ||
      (data.planType === 'full' ? 'full' : data.planKind === 'atNeed' ? 'shortTerm' : 'longTermInstallment');
    const installmentCadence = data.installmentCadence || 'monthly';

    let scheduleChanged = false;

    for (let i = 0; i < schedule.length; i++) {
      const period = schedule[i];
      if (!period || period.status === 'Paid') continue;
      if (period.reminderSentAt) continue; // Every channel already reminded for this period

      let dueDate = null;
      if (period.dueDate && typeof period.dueDate.toDate === 'function') {
        dueDate = period.dueDate.toDate();
      } else if (period.dueDate) {
        dueDate = new Date(period.dueDate);
      }

      if (!dueDate || isNaN(dueDate.getTime()) || dueDate > windowEnd) continue;

      const amountDue = Number(period.amountDue || 0) - Number(period.amountPaid || 0);
      const dueDateLabel = dueDate.toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      const reminder = formatPaymentReminder({
        paymentPlanKind,
        installmentCadence,
        periodIndex: period.periodIndex,
        amountDue,
        remainingBalance,
        dueDateLabel,
      });

      // Each channel is stamped on its own success, so a failed SMS is retried on the next sweep
      // without sending the in-app notification again
      const { needsSms, needsNotification } = pendingReminderChannels(period, { canSms, userId });

      let smsSent = false;
      if (needsSms) {
        try {
          const result = await semaphoreService.sendSms({ number: phone, message: reminder.sms });
          const messageId = result?.messageId || 'n/a';
          smsSent = true;

          await doc.ref.collection('logs').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            adminUid: 'system',
            adminEmail: 'saint_andrew_backend (scheduled)',
            action: 'SMS Sent',
            description: `${reminder.sms} (Message ID: ${messageId})`,
          });
        } catch (error) {
          console.warn(`⚠️ [PrePlan Reminder] SMS failed for plan ${doc.id}:`, error.message);
          try {
            await doc.ref.collection('logs').add({
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              adminUid: 'system',
              adminEmail: 'saint_andrew_backend (scheduled)',
              action: 'SMS Failed',
              description: error.message,
            });
          } catch (logErr) {
            // Ignore secondary log failures
          }
        }
      }

      let notificationDone = false;
      if (needsNotification) {
        try {
          const result = await notifyUser({
            userId,
            type: 'payment_reminder',
            title: reminder.title,
            body: reminder.body,
            route: '/(app)/arrangements',
            refId: doc.id,
          });
          // A userId with no account can never be notified, so don't retry it every day
          notificationDone = result.saved || result.reason === 'user-not-found';
        } catch (error) {
          console.warn(`⚠️ [PrePlan Reminder] Push failed for plan ${doc.id}:`, error.message);
        }
      }

      if (smsSent || notificationDone) {
        schedule[i] = applyReminderResult(period, {
          canSms,
          userId,
          smsSent,
          notificationDone,
          now: admin.firestore.Timestamp.now(),
        });
        scheduleChanged = true;
        remindersSent += 1;
      }

      // Only remind for the earliest qualifying unpaid period per sweep
      break;
    }

    if (scheduleChanged) {
      try {
        await doc.ref.update({ paymentSchedule: schedule });
      } catch (error) {
        console.warn(`⚠️ [PrePlan Reminder] Failed to update schedule for plan ${doc.id}:`, error.message);
      }
    }
  }

  console.log(`✅ [PrePlan Reminder] Sweep complete — ${remindersSent} reminder(s) sent.`);
}

/**
 * Initializes the cron schedule. Runs once a day at 9:00 AM server time.
 */
function initializeReminderCron() {
  cron.schedule('0 9 * * *', () => {
    sendPrePlanPaymentReminders().catch((err) => {
      console.error('⚠️ [PrePlan Reminder] Sweep encountered an unhandled error:', err.message);
    });
  });

  console.log('⏰ [Cron] Daily Pre-Planning payment reminder scheduled (0 9 * * *).');
}

module.exports = {
  sendPrePlanPaymentReminders,
  initializeReminderCron,
  pendingReminderChannels,
  applyReminderResult,
};
