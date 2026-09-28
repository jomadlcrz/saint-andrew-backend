/**
 * Full Firestore backup to one JSON file: every collection and sub-collection, plus the sign-in
 * accounts (no passwords). Timestamps are kept as { _ts: ms } so a restore can rebuild them.
 *
 *   node scripts/backup-firestore.js [outFile]   (default: firestore-backup-YYYY-MM-DD.json)
 *
 * Run daily by .github/workflows/firestore-backup.yml, which encrypts the file before storing it.
 */
const fs = require('fs');
const path = require('path');
const { admin, db, isFirebaseInitialized } = require('../src/config/firebase.config');

function serialize(value) {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof admin.firestore.Timestamp) return { _ts: value.toMillis() };
  if (value instanceof admin.firestore.DocumentReference) return { _ref: value.path };
  if (value instanceof admin.firestore.GeoPoint) return { _geo: [value.latitude, value.longitude] };
  if (Buffer.isBuffer(value)) return { _bytes: value.toString('base64') };
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  return value;
}

async function dumpCollection(ref, counts) {
  const out = {};
  const snap = await ref.get();
  counts.docs += snap.size;
  for (const doc of snap.docs) {
    const subs = {};
    for (const sub of await doc.ref.listCollections()) subs[sub.id] = await dumpCollection(sub, counts);
    out[doc.id] = { data: serialize(doc.data()), ...(Object.keys(subs).length ? { collections: subs } : {}) };
  }
  return out;
}

async function main() {
  if (!isFirebaseInitialized || !db) throw new Error('Firebase is not configured (service-account.json or FIREBASE_SERVICE_ACCOUNT_JSON).');
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const outFile = path.resolve(process.argv[2] || `firestore-backup-${day}.json`);
  const counts = { docs: 0 };

  const collections = {};
  for (const col of await db.listCollections()) collections[col.id] = await dumpCollection(col, counts);

  const accounts = [];
  let pageToken;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    page.users.forEach((u) =>
      accounts.push({
        uid: u.uid,
        email: u.email || null,
        emailVerified: u.emailVerified,
        displayName: u.displayName || null,
        phoneNumber: u.phoneNumber || null,
        disabled: u.disabled,
        createdAt: u.metadata.creationTime,
      })
    );
    pageToken = page.pageToken;
  } while (pageToken);

  fs.writeFileSync(outFile, JSON.stringify({ takenAt: new Date().toISOString(), project: process.env.GCLOUD_PROJECT || null, collections, accounts }));
  const mb = (fs.statSync(outFile).size / 1e6).toFixed(2);
  console.log(`Backup written: ${outFile} (${counts.docs} documents, ${accounts.length} accounts, ${mb} MB)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backup failed:', err.message);
    process.exit(1);
  });
