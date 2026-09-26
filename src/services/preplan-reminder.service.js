/**
 * Pre-Planning Scheduled Payment Reminders Service
 *
 * Runs as a daily node-cron sweep at 9:00 AM.
 * Scans active Pre-Planning contracts in Firestore (`pre_plans` collection)
 * and dispatches payment reminders for installments due within 3 days, plus an in-app/push
 * "due today" notice on the due date itself.
 */

const cron = require('node-cron');
const { admin, db, isFirebaseInitialized } = require('../config/firebase.config');
const semaphoreService = require('./semaphore.service');
const { notifyUser } = require('./notification.service');
const { formatPaymentReminder } = require('../templates/sms.templates');
const { normalizePhilippinePhone, isValidPhilippinePhone } = require('../utils/phone.util');

const REMINDER_WINDOW_DAYS = 3;
// Due dates are Philippine calendar days, whatever the server's timezone is
const BUSINESS_TIME_ZONE = 'Asia/Manila';

/** The family's payment breakdown screen in the app (installments + receipt upload). */
function paymentBreakdownRoute(planId) {
  return `/payments/${planId}`;
}

function toDate(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function manilaDay(date) {
  return date.toLocaleDateString('en-CA', { timeZone: BUSINESS_TIME_ZONE });
}

/** Whether an unpaid period falls due today (Manila) and still needs its due-day notice. */
function needsDueDayNotice(period, now) {
  if (!period || period.status === 'Paid' || period.dueDayNotifiedAt) return false;
  const dueDate = toDate(period.dueDate);
  if (!dueDate || manilaDay(dueDate) !== manilaDay(now)) return false;
  // The heads-up reminder already reached the family today (a schedule set up on its due date)
  const headsUpAt = toDate(period.notificationReminderSentAt);
  return !(headsUpAt && manilaDay(headsUpAt) === manilaDay(now));
}

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

      const dueDate = toDate(period.dueDate);
      if (!dueDate || dueDate > windowEnd) continue;

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
            route: paymentBreakdownRoute(doc.id),
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

    // On the due date itself: a short in-app/push notice (the SMS already went out days before)
    if (userId) {
      for (let i = 0; i < schedule.length; i++) {
        const period = schedule[i];
        if (!needsDueDayNotice(period, now)) continue;
        const amountDue = Number(period.amountDue || 0) - Number(period.amountPaid || 0);
        try {
          const result = await notifyUser({
            userId,
            type: 'payment_reminder',
            title: 'Payment due today',
            body: `Your installment ${period.periodIndex ?? i + 1} of ₱${amountDue.toLocaleString('en-PH')} is due today. Pay via GCash and attach your receipt in the app, or pay at our office.`,
            route: paymentBreakdownRoute(doc.id),
            refId: doc.id,
          });
          if (result.saved || result.reason === 'user-not-found') {
            schedule[i] = { ...period, dueDayNotifiedAt: admin.firestore.Timestamp.now() };
            scheduleChanged = true;
            remindersSent += 1;
          }
        } catch (error) {
          console.warn(`⚠️ [PrePlan Reminder] Due-day push failed for plan ${doc.id}:`, error.message);
        }
      }
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
  needsDueDayNotice,
  paymentBreakdownRoute,
};
