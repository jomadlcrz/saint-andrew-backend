/**
 * One-off backfill: bring Pre-Need applications made in the app in step with their case.
 *
 * The app saves an application twice: the case in `pre_plans` and a request in `transactions`,
 * linked only by reference number (transaction `referenceCode` = case `referenceNumber`). Before
 * admin-web kept them in step, staff worked on the case alone, so the linked request may still:
 *   - say "pending" although the case was accepted (or declined),
 *   - show an old paid amount / balance (payments were recorded on the case only),
 *   - miss the "Claimed" mark after the plan holder was marked deceased.
 * Contracts & Billing, Funeral Plan Records and the family's app read the request, so this copies
 * those fields from the case. Walk-ins and online requests share the case's id and are skipped.
 *
 * Usage (needs the same Firebase credentials as the server):
 *   node scripts/backfill-linked-contracts.js           # dry run: prints the plan
 *   node scripts/backfill-linked-contracts.js --apply   # writes the planned updates
 */

function paymentStatusFor(total, paid) {
  if (total > 0 && paid >= total) return 'paid';
  return paid > 0 ? 'partial' : 'unpaid';
}

/** The request status that matches the case's decision, or null to leave it as is. */
function statusForCase(caseStatus, currentStatus) {
  const current = String(currentStatus || 'pending').toLowerCase();
  if (current !== 'pending') return null; // staff already moved it on
  if (caseStatus === 'Accepted') return 'in_progress';
  if (caseStatus === 'Declined') return 'cancelled';
  return null;
}

/**
 * Builds the update plan without writing anything.
 * @param {{ plans: Array<{ id: string, data: object }>, contracts: Array<{ id: string, data: object }> }} input
 * @returns {Array<{ id: string, planId: string, fields: object, changes: string[] }>}
 */
function planLinkedContractBackfill({ plans, contracts }) {
  const contractsByRef = new Map();
  for (const c of contracts) {
    const ref = String(c.data.referenceCode || '').trim();
    if (!ref) continue;
    if (!contractsByRef.has(ref)) contractsByRef.set(ref, []);
    contractsByRef.get(ref).push(c);
  }

  const updates = [];
  for (const plan of plans) {
    const ref = String(plan.data.referenceNumber || '').trim();
    if (!ref) continue;
    const total = Number(plan.data.totalAmount ?? plan.data.totalPrice ?? 0) || 0;
    const paid = Number(plan.data.amountPaid || 0);

    for (const contract of contractsByRef.get(ref) || []) {
      if (contract.id === plan.id) continue; // same id: already kept in step
      const c = contract.data;
      const fields = {};
      const changes = [];

      if (Number(c.amountPaid || 0) !== paid || Number(c.totalPrice || 0) !== total) {
        fields.amountPaid = paid;
        fields.totalPrice = total;
        fields.balance = Math.max(0, total - paid);
        fields.paymentStatus = paymentStatusFor(total, paid);
        changes.push(`paid ${Number(c.amountPaid || 0)} → ${paid} of ${total}`);
      }
      const status = statusForCase(plan.data.requestStatus, c.status);
      if (status) {
        fields.status = status;
        changes.push(`status pending → ${status}`);
      }
      if (plan.data.lifecycleStatus === 'Claimed' && c.lifecycleStatus !== 'Claimed') {
        fields.lifecycleStatus = 'Claimed';
        changes.push('claimed');
      }
      if (changes.length > 0) updates.push({ id: contract.id, planId: plan.id, fields, changes });
    }
  }
  return updates;
}

async function main() {
  const { admin, db, isFirebaseInitialized } = require('../src/config/firebase.config');
  if (!isFirebaseInitialized || !db) {
    console.error('Firebase Admin is not configured (FIREBASE_SERVICE_ACCOUNT_JSON or service-account.json).');
    process.exit(1);
  }

  const apply = process.argv.includes('--apply');
  const [plansSnap, contractsSnap] = await Promise.all([db.collection('pre_plans').get(), db.collection('transactions').get()]);
  const toList = (snap) => snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  const updates = planLinkedContractBackfill({ plans: toList(plansSnap), contracts: toList(contractsSnap) });

  console.log(`\nLinked contract backfill ${apply ? '(APPLY)' : '(dry run)'}`);
  for (const u of updates) console.log(`  transactions/${u.id}  (case ${u.planId})  ${u.changes.join('; ')}`);
  console.log(`\n${updates.length} to update.`);

  if (apply && updates.length > 0) {
    for (let i = 0; i < updates.length; i += 400) {
      const batch = db.batch();
      for (const u of updates.slice(i, i + 400)) {
        batch.update(db.collection('transactions').doc(u.id), {
          ...u.fields,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
    console.log('Done.');
  } else if (!apply) {
    console.log('Re-run with --apply to write these changes.');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { planLinkedContractBackfill };
