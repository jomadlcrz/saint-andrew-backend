/**
 * Adds the day each older payment was received to its share of an installment
 * (pre_plans/{id}.paymentSchedule[].paymentParts[].at), so the dashboard counts revenue by the day
 * it came in. The day comes from the payment's own record, pre_plans/{id}/idempotency_keys/{paymentId}
 * (createdAt). Additive only: parts that already have `at`, or have no record, are left as they are.
 *
 *   node scripts/backfill-payment-dates.js          (dry run: shows what would change)
 *   node scripts/backfill-payment-dates.js --apply  (writes; take a backup first)
 */
const { db, isFirebaseInitialized } = require('../src/config/firebase.config');

async function main() {
  if (!isFirebaseInitialized || !db) throw new Error('Firebase is not configured.');
  const apply = process.argv.includes('--apply');
  const plans = await db.collection('pre_plans').get();
  let partsDated = 0;
  let partsLeft = 0;
  let casesChanged = 0;

  for (const plan of plans.docs) {
    const schedule = Array.isArray(plan.data().paymentSchedule) ? plan.data().paymentSchedule : [];
    if (!schedule.some((p) => (p.paymentParts || []).some((x) => x && !x.at))) continue;
    const records = await plan.ref.collection('idempotency_keys').get();
    const dayOf = new Map(records.docs.map((d) => [d.id, d.data().createdAt]));
    let changed = false;
    const next = schedule.map((period) => {
      if (!Array.isArray(period.paymentParts)) return period;
      return {
        ...period,
        paymentParts: period.paymentParts.map((part) => {
          if (!part || part.at) return part;
          const at = dayOf.get(part.paymentId);
          if (!at) {
            partsLeft += 1;
            return part;
          }
          partsDated += 1;
          changed = true;
          return { ...part, at };
        }),
      };
    });
    if (!changed) continue;
    casesChanged += 1;
    console.log(`${apply ? 'dated' : 'would date'}: pre_plans/${plan.id}`);
    if (apply) {
      // Read again inside a transaction: a payment recorded meanwhile is kept, only `at` is added
      await db.runTransaction(async (t) => {
        const fresh = await t.get(plan.ref);
        const current = Array.isArray(fresh.data().paymentSchedule) ? fresh.data().paymentSchedule : [];
        const dated = current.map((period) =>
          Array.isArray(period.paymentParts)
            ? { ...period, paymentParts: period.paymentParts.map((part) => (part && !part.at && dayOf.get(part.paymentId) ? { ...part, at: dayOf.get(part.paymentId) } : part)) }
            : period
        );
        t.update(plan.ref, { paymentSchedule: dated });
      });
    }
  }

  console.log(`${apply ? 'Done' : 'Dry run'}: ${partsDated} payment part(s) dated on ${casesChanged} case(s); ${partsLeft} without a record left as they are.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
