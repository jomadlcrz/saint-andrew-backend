/**
 * One-off backfill: give existing customer bookings an owner `userId`.
 *
 * The Firestore rules only let a family read `transactions` / `pre_plans` whose `userId` is
 * their uid. Records saved before that change may have no owner:
 *   - saint-andrew-user-web pre_plans were written without a `userId` field
 *   - saint-andrew-user-web transactions could fall back to userId 'web-client'
 *
 * For each unowned record this assigns an owner only when it can be established safely:
 *   1. its mirror document (pre-plan <-> transaction, same reference) already has a real owner, or
 *   2. its client/contact email matches exactly one customer account.
 * Everything else is reported and left for the family to claim with reference code + phone.
 * Staff walk-ins (userId 'walk-in') are never touched.
 *
 * Usage (needs the same Firebase credentials as the server):
 *   node scripts/backfill-owner-ids.js           # dry run: prints the plan
 *   node scripts/backfill-owner-ids.js --apply   # writes the planned updates
 */

const { isUnowned } = require('../src/services/arrangement.service');

/** Guest/placeholder owners worth resolving; 'walk-in' is deliberately excluded. */
function needsOwner(userId) {
  return isUnowned(userId) && userId !== 'walk-in';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Builds the update plan without writing anything.
 * @param {{ db: any }} deps
 * @returns {Promise<{ updates: Array<{ collection: string, id: string, userId: string, reason: string }>, unresolved: Array<{ collection: string, id: string, reason: string }> }>}
 */
async function planOwnerBackfill({ db }) {
  const [usersSnap, transactionsSnap, prePlansSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('transactions').get(),
    db.collection('pre_plans').get(),
  ]);

  // Customer accounts by email; an email shared by several accounts is ambiguous and never used
  const usersByEmail = new Map();
  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    if (data.role === 'admin') continue;
    const email = normalizeEmail(data.email);
    if (!email) continue;
    usersByEmail.set(email, usersByEmail.has(email) ? null : userDoc.id);
  }

  // Real owners by booking reference, from both sides of the mirror
  const ownerByReference = new Map();
  for (const d of transactionsSnap.docs) {
    const data = d.data();
    if (needsOwner(data.userId) || data.userId === 'walk-in') continue;
    for (const ref of [data.referenceCode, data.trackingId]) {
      if (ref) ownerByReference.set(ref, data.userId);
    }
  }
  for (const d of prePlansSnap.docs) {
    const data = d.data();
    if (!needsOwner(data.userId) && data.referenceNumber) {
      ownerByReference.set(data.referenceNumber, data.userId);
    }
  }

  const updates = [];
  const unresolved = [];

  function resolve(collectionName, docSnap, references, email) {
    const data = docSnap.data();
    if (!needsOwner(data.userId)) return;

    const mirrorOwner = references.map((ref) => ownerByReference.get(ref)).find(Boolean);
    if (mirrorOwner) {
      updates.push({ collection: collectionName, id: docSnap.id, userId: mirrorOwner, reason: 'mirror owner' });
      return;
    }
    const emailOwner = usersByEmail.get(normalizeEmail(email));
    if (emailOwner) {
      updates.push({ collection: collectionName, id: docSnap.id, userId: emailOwner, reason: 'email match' });
      return;
    }
    unresolved.push({
      collection: collectionName,
      id: docSnap.id,
      reason: usersByEmail.get(normalizeEmail(email)) === null ? 'email shared by several accounts' : 'no owner found',
    });
  }

  for (const d of transactionsSnap.docs) {
    const data = d.data();
    resolve('transactions', d, [data.referenceCode, data.trackingId].filter(Boolean), data.clientEmail);
  }
  for (const d of prePlansSnap.docs) {
    const data = d.data();
    resolve('pre_plans', d, [data.referenceNumber].filter(Boolean), data.contactEmail);
  }

  return { updates, unresolved };
}

/** Writes the plan in batches of up to 400 updates. */
async function applyOwnerBackfill({ db, updates, serverTimestamp }) {
  for (let i = 0; i < updates.length; i += 400) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + 400)) {
      batch.update(db.collection(u.collection).doc(u.id), { userId: u.userId, updatedAt: serverTimestamp() });
    }
    await batch.commit();
  }
}

async function main() {
  const { admin, db, isFirebaseInitialized } = require('../src/config/firebase.config');
  if (!isFirebaseInitialized || !db) {
    console.error('Firebase Admin is not configured (FIREBASE_SERVICE_ACCOUNT_JSON or service-account.json).');
    process.exit(1);
  }

  const apply = process.argv.includes('--apply');
  const { updates, unresolved } = await planOwnerBackfill({ db });

  console.log(`\nOwner backfill ${apply ? '(APPLY)' : '(dry run)'}`);
  for (const u of updates) console.log(`  set  ${u.collection}/${u.id}  userId=${u.userId}  [${u.reason}]`);
  for (const u of unresolved) console.log(`  skip ${u.collection}/${u.id}  [${u.reason}]`);
  console.log(`\n${updates.length} to update, ${unresolved.length} left for the family to claim.`);

  if (apply && updates.length > 0) {
    await applyOwnerBackfill({ db, updates, serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp() });
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

module.exports = {
  planOwnerBackfill,
  applyOwnerBackfill,
};
