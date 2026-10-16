/**
 * Receipt Reports shows who recorded each payment. Payments recorded since then keep it
 * (`paymentParts[].recordedBy`); older ones don't. This finds each older payment's "Payment Added"
 * entry in the case's Audit Trail (`pre_plans/{id}/logs`: same amount, written within a few
 * minutes) and saves that staff member's name on the payment. A deposit paid when the case was made
 * (no payment date) gets whoever made the case. Payments with neither are left blank and listed.
 *
 *   node scripts/backfill-payment-recorders.js                       look only (default)
 *   node scripts/backfill-payment-recorders.js --apply --backup=FILE  save the names (FILE: today's backup)
 */
const fs = require('fs');
const path = require('path');
const { admin, db, isFirebaseInitialized } = require('../src/config/firebase.config');
const { fullNameFrom } = require('../src/utils/person-name.util');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const BACKUP = (args.find((a) => a.startsWith('--backup=')) || '').slice('--backup='.length);
/** How far apart the payment and its Audit Trail entry may be. */
const WINDOW_MS = 5 * 60_000;

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const cents = (n) => Math.round((Number(n) || 0) * 100);
const millis = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) || 0 : 0);

/** "₱5,000.00 Cash payment recorded…" → 500000 (centavos). */
function amountInLog(description) {
  const m = /₱\s?([\d,]+(?:\.\d+)?)/.exec(description || '');
  return m ? cents(m[1].replace(/,/g, '')) : null;
}

/**
 * The case's payments with no recorder yet: those recorded one by one (by paymentId), and amounts
 * saved before that (one per installment). Each knows where its name goes.
 */
function paymentsWithoutRecorder(schedule) {
  const byId = new Map();
  const older = [];
  schedule.forEach((period, i) => {
    let kept = 0;
    (period.paymentParts || []).forEach((part, j) => {
      kept += cents(part.amount);
      if (str(part.recordedBy)) return;
      const id = str(part.paymentId) || `${i}-${j}`;
      const p = byId.get(id) || { at: millis(part.at) || millis(period.paidAt), amount: 0, places: [] };
      p.amount += cents(part.amount);
      p.places.push({ i, j });
      byId.set(id, p);
    });
    const rest = cents(period.amountPaid) - kept;
    if (rest > 0 && !str(period.recordedBy)) older.push({ at: millis(period.paidAt), amount: rest, places: [{ i }] });
  });
  return [...byId.values(), ...older];
}

async function main() {
  if (!isFirebaseInitialized || !db) throw new Error('Firebase is not configured (service-account.json or FIREBASE_SERVICE_ACCOUNT_JSON).');
  if (APPLY) {
    if (!BACKUP || !fs.existsSync(BACKUP)) throw new Error('Make a backup first (node scripts/backup-firestore.js), then pass it: --backup=FILE');
    const ageHours = (Date.now() - fs.statSync(BACKUP).mtimeMs) / 3_600_000;
    if (ageHours > 24) throw new Error(`${path.basename(BACKUP)} is ${Math.round(ageHours)} hours old. Make a fresh backup first.`);
  }
  const names = new Map();
  for (const u of (await db.collection('users').get()).docs) names.set(u.id, fullNameFrom(u.data()) || str(u.data().email));

  let found = 0;
  const unmatched = [];
  for (const doc of (await db.collection('pre_plans').get()).docs) {
    const plan = doc.data();
    const label = str(plan.referenceNumber) || doc.id;
    const schedule = Array.isArray(plan.paymentSchedule) ? plan.paymentSchedule.map((p) => ({ ...p, paymentParts: (p.paymentParts || []).map((x) => ({ ...x })) })) : [];
    const payments = paymentsWithoutRecorder(schedule);
    if (payments.length === 0) continue;
    const logs = (await doc.ref.collection('logs').where('action', '==', 'Payment Added').get()).docs.map((l) => ({
      at: millis(l.data().timestamp),
      amount: amountInLog(l.data().description),
      who: names.get(str(l.data().adminUid)) || str(l.data().adminEmail),
      used: false,
    }));
    let changed = false;
    for (const pay of payments) {
      const log = logs
        .filter((l) => !l.used && l.amount === pay.amount && l.who && Math.abs(l.at - pay.at) <= WINDOW_MS)
        .sort((a, b) => Math.abs(a.at - pay.at) - Math.abs(b.at - pay.at))[0];
      const when = pay.at ? new Date(pay.at).toISOString() : 'no date';
      // A deposit paid when the case was made: whoever made the case took it
      const maker = !pay.at ? names.get(str(plan.createdByAdminUid)) || str(plan.createdByAdminEmail) : '';
      if (!log && maker) {
        found++;
        changed = true;
        console.log(`${label}  ₱${(pay.amount / 100).toLocaleString()}  deposit  ← ${maker} (made the case)`);
        for (const { i, j } of pay.places) {
          if (j === undefined) schedule[i].recordedBy = maker;
          else schedule[i].paymentParts[j].recordedBy = maker;
        }
        continue;
      }
      if (!log) {
        unmatched.push(`${label} ₱${(pay.amount / 100).toLocaleString()} (${when})`);
        continue;
      }
      log.used = true;
      found++;
      changed = true;
      console.log(`${label}  ₱${(pay.amount / 100).toLocaleString()}  ${when}  ← ${log.who}`);
      for (const { i, j } of pay.places) {
        if (j === undefined) schedule[i].recordedBy = log.who;
        else schedule[i].paymentParts[j].recordedBy = log.who;
      }
    }
    if (APPLY && changed) await doc.ref.update({ paymentSchedule: schedule });
  }
  if (unmatched.length) console.log(`\nNo Audit Trail entry found (left blank): ${unmatched.length}\n  ${unmatched.join('\n  ')}`);
  console.log(`\n${APPLY ? 'Saved' : 'Would save'} who recorded ${found} payment(s).`);
  if (!APPLY) console.log('Look only: nothing changed. Run with --apply --backup=FILE to save them.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });

void admin;
