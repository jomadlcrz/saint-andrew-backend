/**
 * Staff email alerts
 *
 * The admin bell only alerts staff who have admin-web open. Every 5 minutes this sweep emails the
 * staff inbox about what families sent since the last email: new arrangement requests, receipts to
 * check, and burial details change requests. Each record is stamped (`staffAlerts`) so the same
 * item is never emailed twice; a new receipt or a new change request on the same record alerts again.
 */

const cron = require('node-cron');
const { admin, db, isFirebaseInitialized } = require('../config/firebase.config');
const config = require('../config/env.config');
const brevoService = require('./brevo.service');
const { getStaffAlertEmailTemplate } = require('../templates/email.templates');

function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function text(...values) {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
}

/** "Juan Dela Cruz" from the record's saved name or name parts. */
function deceasedNameOf(data) {
  const info = data.deceasedInfo || {};
  return (
    text(data.deceasedName) ||
    [info.firstName, info.middleName, info.lastName].map((p) => text(p)).filter(Boolean).join(' ') ||
    'Memorial arrangement'
  );
}

/**
 * What on this record staff haven't been emailed about yet. Pure: `stamps` are the record's
 * `staffAlerts` (ms of what was last emailed per kind).
 * @returns {{ kind: 'request'|'receipt'|'schedule', at: number, title: string, detail: string }[]}
 */
function pendingAlerts(data) {
  const stamps = data.staffAlerts || {};
  const who = text(data.clientName, 'A family');
  const name = deceasedNameOf(data);
  const ref = text(data.referenceCode, data.trackingId);
  const alerts = [];

  const status = String(data.status || '').toLowerCase();
  const createdAt = millis(data.createdAt);
  if (status === 'pending' && !data.isWalkIn && createdAt && stamps.request !== createdAt) {
    alerts.push({ kind: 'request', at: createdAt, title: `New request: ${name}`, detail: `${who}${ref ? ` · ${ref}` : ''} · waiting for review` });
  }

  const sentAt = millis(data.proofSubmittedAt);
  const reviewedAt = millis(data.proofReviewedAt);
  if (text(data.proofOfPaymentUrl) && sentAt && sentAt > reviewedAt && stamps.receipt !== sentAt) {
    const period = typeof data.proofPeriodIndex === 'number' ? ` for Period ${data.proofPeriodIndex}` : '';
    alerts.push({ kind: 'receipt', at: sentAt, title: `Receipt to check${period}: ${name}`, detail: `${who} sent a GCash receipt` });
  }

  const request = data.scheduleChangeRequest;
  const requestedAt = request && request.status === 'pending' ? millis(request.requestedAt) : 0;
  if (requestedAt && stamps.schedule !== requestedAt) {
    alerts.push({
      kind: 'schedule',
      at: requestedAt,
      title: `Burial details change: ${name}`,
      detail: `${text(request.requestedByName, who)} asked to change the burial details`,
    });
  }
  return alerts;
}

/** Where alerts go: STAFF_ALERT_EMAILS (comma-separated), else the support inbox. */
function staffRecipients() {
  const list = (process.env.STAFF_ALERT_EMAILS || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  const emails = list.length > 0 ? list : [config.brevo.senderEmail];
  return emails.map((email) => ({ email, name: 'St. Andrew Staff' }));
}

let running = false;

/** One sweep: email anything new, then stamp it. Never throws. */
async function sendStaffAlerts() {
  if (running || !isFirebaseInitialized || !db || !brevoService.isConfigured()) return { sent: 0 };
  running = true;
  try {
    const snap = await db.collection('transactions').where('status', 'in', ['pending', 'in_progress', 'accepted', 'approved']).get();
    const found = [];
    snap.docs.forEach((doc) => {
      pendingAlerts(doc.data()).forEach((alert) => found.push({ ...alert, id: doc.id, ref: doc.ref }));
    });
    if (found.length === 0) return { sent: 0 };

    found.sort((a, b) => a.at - b.at);
    const adminUrl = (process.env.ADMIN_WEB_URL || '').replace(/\/+$/, '');
    await brevoService.sendTransactionalEmail({
      to: staffRecipients(),
      subject:
        found.length === 1
          ? `St. Andrew: ${found[0].title}`
          : `St. Andrew: ${found.length} new items from families need your attention`,
      htmlContent: getStaffAlertEmailTemplate({ items: found, adminUrl }),
      senderName: "St. Andrew's Funeral Home",
    });

    // Stamp only after the email went out, so a failed send is retried next sweep
    await Promise.all(
      found.map((alert) =>
        alert.ref.update({ [`staffAlerts.${alert.kind}`]: alert.at, 'staffAlerts.emailedAt': admin.firestore.FieldValue.serverTimestamp() })
      )
    );
    console.log(`📧 [Staff Alerts] Emailed staff about ${found.length} item(s).`);
    return { sent: found.length };
  } catch (err) {
    console.error('⚠️ [Staff Alerts] Sweep failed:', err.message);
    return { sent: 0, error: err.message };
  } finally {
    running = false;
  }
}

function initializeStaffAlertCron() {
  cron.schedule('*/5 * * * *', () => {
    void sendStaffAlerts();
  });
  // Catch up right away after a restart (e.g. the server was asleep)
  setTimeout(() => void sendStaffAlerts(), 15_000);
  console.log('⏰ [Cron] Staff email alerts every 5 minutes (*/5 * * * *).');
}

module.exports = {
  pendingAlerts,
  deceasedNameOf,
  staffRecipients,
  sendStaffAlerts,
  initializeStaffAlertCron,
};
