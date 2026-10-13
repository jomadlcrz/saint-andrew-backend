/**
 * Walk-ins are signed on paper now (admin-web no longer takes a drawn signature), so this removes
 * the drawn signatures older walk-ins still carry: `contractSignature` is cleared on the walk-in's
 * request (`transactions`), its case (`pre_plans`) and its saved copy (`idempotency_keys`), and the
 * signature files in Storage are deleted once no record uses them. The case page then reads
 * "Signed on paper" like any new walk-in. Family requests (website and app) keep theirs.
 *
 *   node scripts/remove-walk-in-signatures.js                       look only (default)
 *   node scripts/remove-walk-in-signatures.js --apply --backup=FILE  do it (FILE: today's backup)
 */
const fs = require('fs');
const path = require('path');
const { admin, db, isFirebaseInitialized } = require('../src/config/firebase.config');

const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'saint-andrew-funeral-home.firebasestorage.app';
const STORAGE_LINK = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[\w.-]+\/o\/([\w%.~-]+)\?alt=media/;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const BACKUP = (args.find((a) => a.startsWith('--backup=')) || '').slice('--backup='.length);

/** The Storage file a signature value points at, or '' (an image kept on the record, or nothing). */
function fileOf(signature) {
  const value = typeof signature === 'string' ? signature : signature?.imageDataUrl;
  const m = typeof value === 'string' ? STORAGE_LINK.exec(value.trim()) : null;
  return m ? decodeURIComponent(m[1]) : '';
}

const hasSignature = (s) => !!s && (typeof s === 'string' ? s.trim() !== '' : typeof s === 'object');

async function main() {
  if (!isFirebaseInitialized || !db) throw new Error('Firebase is not configured (service-account.json or FIREBASE_SERVICE_ACCOUNT_JSON).');
  if (APPLY) {
    if (!BACKUP || !fs.existsSync(BACKUP)) throw new Error('Make a backup first (node scripts/backup-firestore.js), then pass it: --backup=FILE');
    const ageHours = (Date.now() - fs.statSync(BACKUP).mtimeMs) / 3_600_000;
    if (ageHours > 24) throw new Error(`${path.basename(BACKUP)} is ${Math.round(ageHours)} hours old. Make a fresh backup first.`);
  }

  // Walk-in records with a drawn signature: field to clear, and the file it uses
  const targets = [];
  for (const name of ['transactions', 'pre_plans']) {
    const snap = await db.collection(name).where('isWalkIn', '==', true).get();
    for (const doc of snap.docs) {
      const sig = doc.data().contractSignature;
      if (hasSignature(sig)) targets.push({ ref: doc.ref, field: new admin.firestore.FieldPath('contractSignature'), label: `${doc.ref.path} (${doc.data().referenceCode || ''})`, file: fileOf(sig) });
    }
  }
  const keys = await db.collection('idempotency_keys').where('type', '==', 'walkInArrangement').get();
  for (const doc of keys.docs) {
    const sig = doc.data().cachedPayload?.contractSignature;
    if (hasSignature(sig)) targets.push({ ref: doc.ref, field: new admin.firestore.FieldPath('cachedPayload', 'contractSignature'), label: `${doc.ref.path} (${doc.data().referenceCode || ''})`, file: fileOf(sig) });
  }
  const files = [...new Set(targets.map((t) => t.file).filter(Boolean))];

  for (const t of targets) console.log(`  ${t.label}  ${t.file || '(image on the record)'}`);
  console.log(`\n${targets.length} walk-in record(s) with a drawn signature; ${files.length} signature file(s) in Storage.`);
  if (!APPLY) {
    console.log('Look only: nothing changed. Run with --apply --backup=FILE to remove them.');
    return;
  }

  for (const t of targets) await t.ref.update(t.field, null);
  console.log(`Cleared the signature on ${targets.length} record(s).`);

  // A file is deleted only when no record anywhere still links to it (e.g. a family request)
  const stillUsed = new Set();
  for (const name of ['transactions', 'pre_plans', 'idempotency_keys']) {
    const snap = await db.collection(name).get();
    for (const doc of snap.docs) {
      const text = JSON.stringify(doc.data());
      for (const file of files) if (text.includes(encodeURIComponent(file))) stillUsed.add(file);
    }
  }
  const bucket = admin.storage().bucket(BUCKET);
  let deleted = 0;
  for (const file of files) {
    if (stillUsed.has(file)) {
      console.log(`  kept (still used by a record): ${file}`);
      continue;
    }
    await bucket.file(file).delete({ ignoreNotFound: true });
    deleted += 1;
  }
  console.log(`Deleted ${deleted} signature file(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
